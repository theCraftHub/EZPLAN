/**
 * Server-side sessions. The browser holds a random token in an HttpOnly cookie; the database keeps
 * only its SHA-256 hash, so a leaked database can't be used to sign in. Deleting rows ends
 * sessions at once ("sign out everywhere", deactivation, offboarding).
 */
import type { Clock, Db, User } from "./ports";

export const SESSION_COOKIE = "session";
const DAY = 86_400_000;
export const SESSION_DAYS = 30;
/** Refresh last-seen and expiry at most this often, so busy sessions don't write on every request. */
const TOUCH_EVERY = 10 * 60_000;

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64url(b);
}

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/** Creates a session and returns the token for the cookie. */
export async function createSession(db: Db, clock: Clock, userId: string, userAgent: string | null): Promise<string> {
  const token = randomToken();
  const now = clock.now();
  await db.run(`INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)`, [
    await sha256(token),
    userId,
    now,
    now,
    now + SESSION_DAYS * DAY,
    userAgent ? userAgent.slice(0, 300) : null,
  ]);
  return token;
}

/** The signed-in person for a session token, or null. Sliding expiry: active sessions stay alive. */
export async function userForSession(db: Db, clock: Clock, token: string | undefined): Promise<User | null> {
  if (!token || token.length > 100) return null;
  const hash = await sha256(token);
  const row = await db.first<{ id: string; name: string; email: string; expires_at: number; last_seen_at: number }>(
    `SELECT u.id, u.name, u.email, s.expires_at, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.suspended_at IS NULL`,
    [hash],
  );
  if (!row) return null;
  const now = clock.now();
  if (Number(row.expires_at) <= now) {
    await db.run(`DELETE FROM sessions WHERE token_hash = ?`, [hash]);
    return null;
  }
  if (now - Number(row.last_seen_at) > TOUCH_EVERY) {
    await db.run(`UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?`, [now, now + SESSION_DAYS * DAY, hash]);
  }
  return { id: row.id, name: row.name, email: row.email };
}

export async function endSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.run(`DELETE FROM sessions WHERE token_hash = ?`, [await sha256(token)]);
}

export async function endAllSessions(db: Db, userId: string): Promise<number> {
  return (await db.run(`DELETE FROM sessions WHERE user_id = ?`, [userId])).changes;
}
