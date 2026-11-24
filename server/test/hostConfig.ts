/** Server settings and outbound HTTP the test hosts use (both hosts, same values). */
import type { HttpFetch, ServerConfig } from "../src/ports";
import { DEFAULT_WORK_WEEK } from "@ezplan/shared";
import type { FakeOidc } from "./fakeOidc";
import { ALLOWED, PUBLIC_URL } from "./signin.contract";

/** The owner's team in tests, and small AI limits so running out is easy to test. */
export const PLATFORM_ADMIN = "owner@example.com";
/** The inbound-email webhook's secret in tests (replies by email). */
export const INBOUND_SECRET = "test-inbound-secret";
export const TEST_AI_LIMITS = { checksPerPerson: 4, reportsPerPerson: 3, poolChecks: 6, poolReports: 50, poolMax: 60 };

export function testConfig(fake?: FakeOidc): ServerConfig {
  return { defaultWorkWeek: DEFAULT_WORK_WEEK, publicUrl: PUBLIC_URL, providers: fake ? [fake.provider()] : [], allowedEmails: ALLOWED, secureCookies: true, platformAdmins: [PLATFORM_ADMIN], aiLimits: TEST_AI_LIMITS, email: { inboundSecret: INBOUND_SECRET } };
}

/** The same settings as Worker variables (cloud). */
export function testEnv(fake?: FakeOidc): Record<string, string> {
  return {
    PUBLIC_URL,
    ALLOWED_EMAILS: ALLOWED.join(","),
    PLATFORM_ADMINS: PLATFORM_ADMIN,
    INBOUND_EMAIL_SECRET: INBOUND_SECRET,
    AI_MONTHLY_CHECKS: String(TEST_AI_LIMITS.checksPerPerson),
    AI_MONTHLY_REPORTS: String(TEST_AI_LIMITS.reportsPerPerson),
    AI_POOL_CHECKS: String(TEST_AI_LIMITS.poolChecks),
    AI_POOL_REPORTS: String(TEST_AI_LIMITS.poolReports),
    AI_POOL_MAX: String(TEST_AI_LIMITS.poolMax),
    ...(fake ? { OIDC_PROVIDERS: JSON.stringify([fake.provider()]) } : {}),
  };
}

export function testHttp(fake?: FakeOidc): HttpFetch {
  return async (req) => {
    if (fake && new URL(req.url).origin === fake.issuer) return fake.handle(req);
    return new Response("Tests don't reach the internet.", { status: 599 });
  };
}
