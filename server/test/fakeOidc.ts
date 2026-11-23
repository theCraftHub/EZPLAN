/**
 * A stand-in OpenID Connect provider for tests: discovery, signing keys and a token endpoint that
 * checks the client secret, the one-time code, the redirect address and PKCE, then signs a real
 * ID token. `authorize` plays the person signing in, optionally producing a bad token on purpose.
 */
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import type { OidcProvider } from "../src/ports";

export interface FakeClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export interface Tamper {
  nonce?: string;
  audience?: string;
  issuer?: string;
  /** Seconds relative to now for "exp" (negative = already expired). */
  expiresIn?: number;
  /** Sign with a key the provider never published. */
  foreignKey?: boolean;
}

interface CodeGrant {
  claims: FakeClaims;
  nonce: string;
  challenge: string;
  redirectUri: string;
  tamper: Tamper;
}

export class FakeOidc {
  readonly issuer = "https://id.test";
  readonly clientId = "client-1";
  readonly clientSecret = "secret-1";
  private readonly codes = new Map<string, CodeGrant>();
  /** Every request the provider received, for assertions. */
  readonly requests: string[] = [];

  private constructor(
    private readonly key: CryptoKey,
    private readonly jwk: JWK,
    private readonly foreignKey: CryptoKey,
    private readonly nowSeconds: () => number,
  ) {}

  static async create(nowMs: () => number): Promise<FakeOidc> {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const foreign = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    return new FakeOidc(privateKey, jwk, foreign.privateKey, () => Math.floor(nowMs() / 1000));
  }

  provider(extra: Partial<OidcProvider> = {}): OidcProvider {
    return { id: "test-id", label: "Test ID", issuer: this.issuer, clientId: this.clientId, clientSecret: this.clientSecret, ...extra };
  }

  /** Plays the person approving sign-in; returns the callback path the browser is sent to. */
  authorize(loginUrl: string, claims: FakeClaims, tamper: Tamper = {}): string {
    const u = new URL(loginUrl);
    const q = u.searchParams;
    if (u.origin !== this.issuer || q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256") throw new Error("unexpected login URL");
    const code = crypto.randomUUID();
    this.codes.set(code, { claims, nonce: q.get("nonce")!, challenge: q.get("code_challenge")!, redirectUri: q.get("redirect_uri")!, tamper });
    const redirect = new URL(q.get("redirect_uri")!);
    return `${redirect.pathname}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(q.get("state")!)}`;
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.requests.push(`${request.method} ${url.pathname}`);
    if (url.pathname === "/.well-known/openid-configuration") {
      return Response.json({ issuer: this.issuer, authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks` });
    }
    if (url.pathname === "/jwks") return Response.json({ keys: [this.jwk] });
    if (url.pathname === "/token" && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      if (form.get("client_id") !== this.clientId || form.get("client_secret") !== this.clientSecret) return Response.json({ error: "invalid_client" }, { status: 401 });
      const grant = this.codes.get(form.get("code") ?? "");
      this.codes.delete(form.get("code") ?? "");
      if (!grant) return Response.json({ error: "invalid_grant" }, { status: 400 });
      if (form.get("redirect_uri") !== grant.redirectUri) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.get("code_verifier") ?? "")));
      const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      if (challenge !== grant.challenge) return Response.json({ error: "invalid_grant", error_description: "PKCE" }, { status: 400 });
      const now = this.nowSeconds();
      const t = grant.tamper;
      const idToken = await new SignJWT({ ...grant.claims, nonce: t.nonce ?? grant.nonce })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(t.issuer ?? this.issuer)
        .setAudience(t.audience ?? this.clientId)
        .setSubject(grant.claims.sub)
        .setIssuedAt(now)
        .setExpirationTime(now + (t.expiresIn ?? 600))
        .sign(t.foreignKey ? this.foreignKey : this.key);
      return Response.json({ access_token: "unused", token_type: "Bearer", id_token: idToken });
    }
    return new Response("not found", { status: 404 });
  }
}
