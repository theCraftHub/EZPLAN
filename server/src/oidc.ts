/**
 * OpenID Connect sign-in (authorization code flow with PKCE), the same on both hosts.
 * Every check that keeps sign-in safe lives here: one-time state, nonce, PKCE, issuer,
 * audience, signature, expiry, and a verified (or trusted) email address.
 */
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";
import { base64url, randomToken } from "./sessions";
import type { Clock, Db, HttpFetch, OidcProvider, ServerConfig } from "./ports";

const ATTEMPT_MINUTES = 10;

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export class SignInError extends Error {}

/** Cached per process/isolate: discovery documents and signing keys rarely change. */
const discoveryCache = new Map<string, Discovery>();
const keysCache = new Map<string, JSONWebKeySet>();

async function getJson<T>(http: HttpFetch, url: string, init?: RequestInit): Promise<T> {
  const res = await http(new Request(url, init));
  if (!res.ok) throw new SignInError(`The sign-in service answered ${res.status}.`);
  return (await res.json()) as T;
}

async function discover(http: HttpFetch, p: OidcProvider): Promise<Discovery> {
  const cached = discoveryCache.get(p.issuer);
  if (cached) return cached;
  const d = await getJson<Discovery>(http, `${p.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  // The document must describe the issuer we were configured with (mix-up protection).
  if (d.issuer.replace(/\/$/, "") !== p.issuer.replace(/\/$/, "")) throw new SignInError("The sign-in service's settings don't match its address.");
  discoveryCache.set(p.issuer, d);
  return d;
}

/** Only relative paths on this site, so sign-in can't be used to send people elsewhere. */
export function safeReturnTo(value: string | undefined | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.length > 500) return "/";
  return /[\r\n]/.test(value) ? "/" : value;
}

export function redirectUri(config: ServerConfig): string {
  return `${config.publicUrl.replace(/\/$/, "")}/auth/callback`;
}

/** Step 1: where to send the browser, and the one-time attempt saved for the callback. */
export async function startLogin(db: Db, http: HttpFetch, clock: Clock, config: ServerConfig, providerId: string, returnTo: string | undefined): Promise<string> {
  const p = config.providers.find((x) => x.id === providerId);
  if (!p) throw new SignInError("That sign-in option isn't set up.");
  const d = await discover(http, p);
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const now = clock.now();
  await db.batch([
    { sql: `DELETE FROM login_attempts WHERE expires_at < ?`, params: [now] },
    { sql: `INSERT INTO login_attempts (state, provider, nonce, verifier, return_to, expires_at) VALUES (?, ?, ?, ?, ?, ?)`, params: [state, p.id, nonce, verifier, safeReturnTo(returnTo), now + ATTEMPT_MINUTES * 60_000] },
  ]);
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: redirectUri(config),
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export interface SignedIn {
  provider: string;
  subject: string;
  email: string;
  name: string;
  returnTo: string;
}

/** Step 2: the provider sent the browser back. Checks everything, or throws SignInError. */
export async function finishLogin(db: Db, http: HttpFetch, clock: Clock, config: ServerConfig, params: URLSearchParams): Promise<SignedIn> {
  if (params.get("error")) throw new SignInError("Sign-in was cancelled or refused by the sign-in service.");
  const state = params.get("state");
  const code = params.get("code");
  if (!state || !code) throw new SignInError("This sign-in link is incomplete. Start again.");
  // One-time: the attempt is deleted as it's used, so a replayed callback fails.
  const attempt = await db.first<{ provider: string; nonce: string; verifier: string; return_to: string; expires_at: number }>(`SELECT provider, nonce, verifier, return_to, expires_at FROM login_attempts WHERE state = ?`, [state]);
  if (!attempt) throw new SignInError("This sign-in link has expired or was already used. Start again.");
  await db.run(`DELETE FROM login_attempts WHERE state = ?`, [state]);
  if (Number(attempt.expires_at) < clock.now()) throw new SignInError("This sign-in link has expired. Start again.");
  const p = config.providers.find((x) => x.id === attempt.provider);
  if (!p) throw new SignInError("That sign-in option isn't set up any more.");
  const d = await discover(http, p);

  const tokens = await getJson<{ id_token?: string }>(http, d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(config),
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code_verifier: attempt.verifier,
    }).toString(),
  });
  if (!tokens.id_token) throw new SignInError("The sign-in service didn't say who you are.");

  const claims = await verifyIdToken(http, p, d, tokens.id_token, clock);
  if (claims.nonce !== attempt.nonce) throw new SignInError("This sign-in doesn't match the one you started. Start again.");
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email) throw new SignInError("The sign-in service didn't share your email address.");
  if (claims.email_verified !== true && !p.trustEmail) throw new SignInError("Your email address isn't verified with the sign-in service.");
  if (config.allowedEmails && !config.allowedEmails.map((e) => e.toLowerCase()).includes(email)) throw new SignInError("This account isn't allowed to sign in here.");
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 120) : email.split("@")[0]!;
  return { provider: p.id, subject: String(claims.sub), email, name, returnTo: attempt.return_to };
}

async function verifyIdToken(http: HttpFetch, p: OidcProvider, d: Discovery, token: string, clock: Clock): Promise<JWTPayload> {
  const verify = async (refresh: boolean) => {
    let keys = keysCache.get(d.jwks_uri);
    if (!keys || refresh) {
      keys = await getJson<JSONWebKeySet>(http, d.jwks_uri);
      keysCache.set(d.jwks_uri, keys);
    }
    return jwtVerify(token, createLocalJWKSet(keys), {
      issuer: d.issuer,
      audience: p.clientId,
      currentDate: new Date(clock.now()),
      clockTolerance: 60,
      algorithms: ["RS256", "ES256", "PS256", "EdDSA"],
    });
  };
  try {
    return (await verify(false)).payload;
  } catch (e) {
    // The provider may have rotated its keys since we cached them: fetch once more.
    if ((e as { code?: string }).code === "ERR_JWKS_NO_MATCHING_KEY") {
      try {
        return (await verify(true)).payload;
      } catch {
        throw new SignInError("We couldn't confirm this sign-in. Start again.");
      }
    }
    throw new SignInError("We couldn't confirm this sign-in. Start again.");
  }
}

/** Finds or creates the person for a confirmed sign-in. People keep one id even if their email changes. */
export async function userForSignIn(db: Db, clock: Clock, s: SignedIn): Promise<{ id: string; name: string; email: string; isNew: boolean }> {
  const now = clock.now();
  const linked = await db.first<{ id: string; name: string; email: string }>(
    `SELECT u.id, u.name, u.email FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?`,
    [s.provider, s.subject],
  );
  if (linked) {
    await db.run(`UPDATE identities SET email = ?, last_login_at = ? WHERE provider = ? AND subject = ?`, [s.email, now, s.provider, s.subject]);
    return { ...linked, isNew: false };
  }
  // A verified email that matches an existing person links this new sign-in method to them.
  const byEmail = await db.first<{ id: string; name: string; email: string }>(`SELECT id, name, email FROM users WHERE email = ?`, [s.email]);
  if (byEmail) {
    await db.run(`INSERT INTO identities (provider, subject, user_id, email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)`, [s.provider, s.subject, byEmail.id, s.email, now, now]);
    return { ...byEmail, isNew: false };
  }
  const id = crypto.randomUUID();
  await db.batch([
    { sql: `INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)`, params: [id, s.name, s.email, now] },
    { sql: `INSERT INTO identities (provider, subject, user_id, email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)`, params: [s.provider, s.subject, id, s.email, now, now] },
  ]);
  return { id, name: s.name, email: s.email, isNew: true };
}
