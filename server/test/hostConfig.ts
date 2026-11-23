/** Server settings and outbound HTTP the test hosts use (both hosts, same values). */
import type { HttpFetch, ServerConfig } from "../src/ports";
import { DEFAULT_WORK_WEEK } from "@ezplan/shared";
import type { FakeOidc } from "./fakeOidc";
import { ALLOWED, PUBLIC_URL } from "./signin.contract";

export function testConfig(fake?: FakeOidc): ServerConfig {
  return { defaultWorkWeek: DEFAULT_WORK_WEEK, publicUrl: PUBLIC_URL, providers: fake ? [fake.provider()] : [], allowedEmails: ALLOWED, secureCookies: true };
}

/** The same settings as Worker variables (cloud). */
export function testEnv(fake?: FakeOidc): Record<string, string> {
  return { PUBLIC_URL, ALLOWED_EMAILS: ALLOWED.join(","), ...(fake ? { OIDC_PROVIDERS: JSON.stringify([fake.provider()]) } : {}) };
}

export function testHttp(fake?: FakeOidc): HttpFetch {
  return async (req) => {
    if (fake && new URL(req.url).origin === fake.issuer) return fake.handle(req);
    return new Response("Tests don't reach the internet.", { status: 599 });
  };
}
