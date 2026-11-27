/**
 * Hardening shared by both hosts (step S1): rate limits kept in the database (so they hold across
 * Cloudflare isolates and restarts), the client's network address, constant-time secret checks,
 * per-install secrets, and the guard that keeps test sign-in away from real addresses.
 */
import type { Db } from "./ports";

// ---------------------------------------------------------------- rate limits

export interface RateRule { max: number; windowMs: number }
export const RATE_RULES = {
  /** Starting or finishing a sign-in, per network address. */
  signIn: { max: 60, windowMs: 10 * 60_000 },
  /** Opening share links (no sign-in), per network address. */
  shareView: { max: 300, windowMs: 10 * 60_000 },
  /** Any change through the API, per person. */
  write: { max: 600, windowMs: 60_000 },
  /** Making a company, per person. */
  orgCreate: { max: 20, windowMs: 60 * 60_000 },
  /** Inviting people (company invites, plan invites, resends, Go live), per person. */
  invites: { max: 120, windowMs: 60 * 60_000 },
  /** Adding and checking domains, per person (each check makes a DNS lookup). */
  domains: { max: 30, windowMs: 10 * 60_000 },
  /** Help requests and safety reports, per person. */
  support: { max: 20, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateRule>;
export type RateName = keyof typeof RATE_RULES;
export type RateOverrides = Partial<Record<RateName, RateRule>>;

export const TOO_MANY = "Too many tries. Wait a minute, then try again.";

/** Counts one hit; returns how many seconds to wait when over the limit, else null. */
export async function hit(db: Db, now: number, name: RateName, subject: string, overrides: RateOverrides = {}): Promise<number | null> {
  const rule = overrides[name] ?? RATE_RULES[name];
  const start = Math.floor(now / rule.windowMs) * rule.windowMs;
  const key = `${name}:${subject}`;
  await db.run(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT (key) DO UPDATE SET count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END, window_start = excluded.window_start`,
    [key, start],
  );
  const row = await db.first<{ count: number }>(`SELECT count FROM rate_limits WHERE key = ?`, [key]);
  // Now and then, old windows are cleared away.
  if (Math.random() < 0.01) await db.run(`DELETE FROM rate_limits WHERE window_start < ?`, [now - 24 * 60 * 60_000]);
  return Number(row?.count ?? 0) > rule.max ? Math.max(1, Math.ceil((start + rule.windowMs - now) / 1000)) : null;
}

/** Which limit a request falls under, beyond the general one for changes. */
export function ruleFor(method: string, path: string): RateName | null {
  if (method !== "POST" && method !== "PUT") return null;
  if (path === "/api/orgs") return "orgCreate";
  if (/^\/api\/orgs\/[^/]+\/(invites|golive)$/.test(path) || /^\/api\/plans\/[^/]+\/invites$/.test(path) || /^\/api\/orgs\/[^/]+\/people\/bulk$/.test(path)) return "invites";
  if (/^\/api\/orgs\/[^/]+\/domains(\/[^/]+\/check)?$/.test(path)) return "domains";
  if (path === "/api/support/tickets") return "support";
  return null;
}

/**
 * The client's network address. On Cloudflare, `cf-connecting-ip` is set by Cloudflare itself. The
 * self-hosted server sets `x-app-client-ip` from the connection (and removes both headers
 * from what the client sent), so neither can be faked.
 */
export const CLIENT_IP_HEADER = "x-app-client-ip";
export const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") ?? req.headers.get(CLIENT_IP_HEADER) ?? "unknown";

// ---------------------------------------------------------------- secrets

/** Compares two strings in time that doesn't depend on where they differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** A per-install secret (made on first use, kept in the database), as an HMAC key. */
export async function serverKey(db: Db, name: string): Promise<CryptoKey> {
  let row = await db.first<{ value: string }>(`SELECT value FROM server_secrets WHERE name = ?`, [name]);
  if (!row) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    await db.run(`INSERT OR IGNORE INTO server_secrets (name, value) VALUES (?, ?)`, [name, [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")]);
    row = (await db.first<{ value: string }>(`SELECT value FROM server_secrets WHERE name = ?`, [name]))!;
  }
  return crypto.subtle.importKey("raw", new TextEncoder().encode(row.value), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function hmacHex(key: CryptoKey, text: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- test sign-in guard

/**
 * Test sign-in (the x-test-user header) lets anyone be anyone, so it only works on addresses that
 * can't be a real site: localhost, 127.0.0.1, and the reserved .test, .localhost and .example names.
 */
export function isTestAddress(publicUrl: string): boolean {
  const host = new URL(publicUrl).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || /\.(test|localhost|example)$/.test(host);
}

/** Text safe to put in an email header: no line breaks (which could add headers), trimmed. */
export const headerSafe = (s: string) => s.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
