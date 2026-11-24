/**
 * Reads server settings from environment variables (self-hosted) or Worker variables and secrets
 * (cloud), the same way on both:
 *   PUBLIC_URL       the site's address, e.g. https://plans.example.com (required)
 *   OIDC_PROVIDERS   JSON list of sign-in providers: [{ id, label, issuer, clientId, clientSecret, trustEmail? }]
 *   ALLOWED_EMAILS   optional comma-separated list; only these people may sign in
 *   SECURE_COOKIES   "0" only for plain-http local testing; anything else keeps cookies Secure
 *   PLATFORM_ADMINS  comma-separated emails of the owner's team (safety review queue, support inbox)
 *   AI_MONTHLY_CHECKS, AI_MONTHLY_REPORTS  per-person monthly AI allowance (default 100 and 30)
 *   AI_POOL_CHECKS, AI_POOL_REPORTS, AI_POOL_MAX  per-workspace monthly pool and top-up ceiling
 *   MAIL_FROM, MAIL_REPLY_DOMAIN  email sender and the domain replies come back to (default: from PUBLIC_URL)
 *   INBOUND_EMAIL_SECRET      turns on replies by email: the email provider posts received mail to /inbound/email with it
 *   ANTHROPIC_API_KEY, AI_MODEL, AI_REPORT_MODEL  the built-in AI (read by each host; AI is off without a key)
 */
import { DEFAULT_WORK_WEEK } from "@ezplan/shared";
import { DEFAULT_AI_LIMITS, type OidcProvider, type ServerConfig } from "./ports";

const num = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);

export function configFromEnv(env: Record<string, string | undefined>): ServerConfig {
  const publicUrl = env.PUBLIC_URL?.trim();
  if (!publicUrl || !/^https?:\/\/[^/]+/.test(publicUrl)) throw new Error("Set PUBLIC_URL to the site's address, for example https://plans.example.com.");
  let providers: OidcProvider[] = [];
  if (env.OIDC_PROVIDERS) {
    let raw: unknown;
    try {
      raw = JSON.parse(env.OIDC_PROVIDERS);
    } catch {
      throw new Error("OIDC_PROVIDERS must be a JSON list of sign-in providers.");
    }
    if (!Array.isArray(raw)) throw new Error("OIDC_PROVIDERS must be a JSON list of sign-in providers.");
    providers = raw.map((p: Record<string, unknown>, i) => {
      for (const k of ["id", "label", "issuer", "clientId", "clientSecret"]) if (typeof p[k] !== "string" || !p[k]) throw new Error(`Sign-in provider ${i + 1} is missing "${k}".`);
      if (!/^[a-z0-9-]{1,32}$/.test(String(p.id))) throw new Error(`Sign-in provider id "${String(p.id)}" must be lowercase letters, digits or dashes.`);
      if (!String(p.issuer).startsWith("https://")) throw new Error(`Sign-in provider "${String(p.id)}" must use an https:// issuer.`);
      return { id: String(p.id), label: String(p.label), issuer: String(p.issuer), clientId: String(p.clientId), clientSecret: String(p.clientSecret), trustEmail: p.trustEmail === true };
    });
  }
  const allowed = env.ALLOWED_EMAILS?.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return {
    defaultWorkWeek: DEFAULT_WORK_WEEK,
    publicUrl: publicUrl.replace(/\/$/, ""),
    providers,
    ...(allowed && allowed.length ? { allowedEmails: allowed } : {}),
    secureCookies: env.SECURE_COOKIES !== "0",
    ...(env.MAIL_FROM || env.MAIL_REPLY_DOMAIN || env.INBOUND_EMAIL_SECRET
      ? { email: { ...(env.MAIL_FROM ? { from: env.MAIL_FROM.trim() } : {}), ...(env.MAIL_REPLY_DOMAIN ? { replyDomain: env.MAIL_REPLY_DOMAIN.trim().toLowerCase() } : {}), ...(env.INBOUND_EMAIL_SECRET ? { inboundSecret: env.INBOUND_EMAIL_SECRET.trim() } : {}) } }
      : {}),
    ...(env.PLATFORM_ADMINS ? { platformAdmins: env.PLATFORM_ADMINS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean) } : {}),
    aiLimits: {
      checksPerPerson: num(env.AI_MONTHLY_CHECKS, DEFAULT_AI_LIMITS.checksPerPerson),
      reportsPerPerson: num(env.AI_MONTHLY_REPORTS, DEFAULT_AI_LIMITS.reportsPerPerson),
      poolChecks: num(env.AI_POOL_CHECKS, DEFAULT_AI_LIMITS.poolChecks),
      poolReports: num(env.AI_POOL_REPORTS, DEFAULT_AI_LIMITS.poolReports),
      poolMax: num(env.AI_POOL_MAX, DEFAULT_AI_LIMITS.poolMax),
    },
  };
}
