/**
 * Who is making a request. Real sign-in is OpenID Connect + server-side sessions (oidc.ts,
 * sessions.ts). The x-test-user header exists only for tests and is off unless a host sets
 * the test flag explicitly (TEST_AUTH=1); a test checks it is off by default on both hosts.
 */
import type { User } from "./ports";

export function userFromTestHeader(request: Request): User | null {
  const raw = request.headers.get("x-test-user");
  if (!raw) return null;
  const [id, name, email] = raw.split("|");
  if (!id || !name || !email) return null;
  return { id, name, email };
}

export function testAuthEnabled(flag: string | undefined): boolean {
  return flag === "1";
}
