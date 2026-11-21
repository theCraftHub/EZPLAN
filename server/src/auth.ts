/**
 * Sign-in connectors that both hosts share. Real sign-in (Cloudflare Access during the private
 * build, then our own accounts, or a company's Microsoft / Google / OIDC / SAML when self-hosted)
 * implements the same Auth port in a later step.
 */
import type { Auth, User } from "./ports";

/** No sign-in configured yet: every request is anonymous, so the API answers 401. */
export const noAuth: Auth = {
  async getUser() {
    return null;
  },
};

/**
 * TESTS ONLY. Trusts an "x-test-user: id|Name|email" header. Hosts enable it only when a test
 * flag is set explicitly (TEST_AUTH=1); a test checks it is off by default on both.
 */
export const testAuth: Auth = {
  async getUser(request: Request): Promise<User | null> {
    const raw = request.headers.get("x-test-user");
    if (!raw) return null;
    const [id, name, email] = raw.split("|");
    if (!id || !name || !email) return null;
    return { id, name, email };
  },
};

export function authFor(testFlag: string | undefined): Auth {
  return testFlag === "1" ? testAuth : noAuth;
}
