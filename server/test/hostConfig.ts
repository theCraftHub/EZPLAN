/** Server settings and outbound HTTP the test hosts use (both hosts, same values). */
import type { HttpFetch, ServerConfig } from "../src/ports";
import { DEFAULT_WORK_WEEK } from "@rakuplan/shared";
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

/** TXT records tests publish for domain checks (answered as Cloudflare DNS-over-HTTPS would). */
export const FAKE_DNS: Record<string, string[]> = {};
/** Calendar files the fake calendar service serves, by path (step N3). */
export const FAKE_ICS: Record<string, string> = {};

export function testHttp(fake?: FakeOidc): HttpFetch {
  return async (req) => {
    const u = new URL(req.url);
    if (u.hostname === "cloudflare-dns.com") {
      const records = FAKE_DNS[u.searchParams.get("name") ?? ""] ?? [];
      return Response.json({ Status: 0, Answer: records.map((r) => ({ type: 16, data: `"${r}"` })) });
    }
    if (u.hostname === "calendar.google.com") {
      const body = FAKE_ICS[u.pathname];
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { headers: { "content-type": "text/calendar" } });
    }
    if (fake && new URL(req.url).origin === fake.issuer) return fake.handle(req);
    return new Response("Tests don't reach the internet.", { status: 599 });
  };
}
