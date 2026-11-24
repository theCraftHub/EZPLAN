/**
 * Email, host-neutral. Every email is written to the outbox table first; a Mailer (Resend in the
 * cloud, SMTP self-hosted) sends it when one is configured. Without one, sending is off and the
 * outbox shows what would have gone out. Replies come back through POST /inbound/email.
 *
 * Reply addresses carry a signed token per case and recipient (`case-<id>-<token>@<reply domain>`),
 * so a reply is accepted only from the address it was sent to, and only into that case.
 */
import type { Clock, Db, ServerConfig } from "./ports";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  replyTo: string;
  /** Threading: Message-ID, In-Reply-To, References. */
  headers: Record<string, string>;
}

/** A way to actually send email; absent means sending is off (emails stay in the outbox). */
export interface Mailer {
  send(from: string, email: OutgoingEmail): Promise<void>;
}

export interface MailSettings {
  from: string;
  replyDomain: string;
  /** Shared secret the inbound-email webhook must present; inbound is off without it. */
  inboundSecret?: string;
}

/** Defaults from the site's address, so threads and reply addresses work before email is set up. */
export function mailSettings(config: ServerConfig, brandName: string): MailSettings {
  const host = new URL(config.publicUrl).hostname;
  return {
    from: config.email?.from ?? `${brandName} safety team <safety@${host}>`,
    replyDomain: config.email?.replyDomain ?? `reply.${host}`,
    ...(config.email?.inboundSecret ? { inboundSecret: config.email.inboundSecret } : {}),
  };
}

/** A per-install secret for signing reply addresses, made on first use and kept in the database. */
async function signingKey(db: Db): Promise<CryptoKey> {
  let row = await db.first<{ value: string }>(`SELECT value FROM server_secrets WHERE name = 'mail'`);
  if (!row) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const value = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    await db.run(`INSERT OR IGNORE INTO server_secrets (name, value) VALUES ('mail', ?)`, [value]);
    row = (await db.first<{ value: string }>(`SELECT value FROM server_secrets WHERE name = 'mail'`))!;
  }
  return crypto.subtle.importKey("raw", new TextEncoder().encode(row.value), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(db: Db, text: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(db), new TextEncoder().encode(text)));
  return [...mac.slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The reply address for one recipient of one case. */
export async function replyAddress(db: Db, settings: MailSettings, caseId: string, recipient: string): Promise<string> {
  return `case-${caseId}-${await sign(db, `${caseId}:${recipient.toLowerCase()}`)}@${settings.replyDomain}`;
}

/** Reads a reply address back: the case, if the token matches the sender. */
export async function caseFromReply(db: Db, settings: MailSettings, to: string[], sender: string): Promise<string | null> {
  for (const raw of to) {
    const addr = bareAddress(raw);
    const m = /^case-([0-9a-f-]{36})-([0-9a-f]{20})@(.+)$/.exec(addr);
    if (!m || m[3] !== settings.replyDomain.toLowerCase()) continue;
    if ((await sign(db, `${m[1]}:${sender}`)) === m[2]) return m[1]!;
  }
  return null;
}

/** "Ana Diaz <Ana@Example.com>" → "ana@example.com". */
export function bareAddress(raw: string): string {
  const m = /<([^>]+)>/.exec(raw);
  return (m ? m[1]! : raw).trim().toLowerCase();
}

export const REPLY_MARKER = "## Reply above this line ##";

/** The new part of an emailed reply: above our marker, above "On … wrote:", without quoted lines or a signature. */
export function replyText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.includes(REPLY_MARKER.slice(3, -3).trim())) break;
    if (/^On .+wrote:$/.test(t) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(t) || /^From: .+/.test(t) && out.length > 0) break;
    if (t === "--" || t === "-- ") break;
    if (t.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim().slice(0, 5000);
}

/** Records an email in the outbox and sends it when a mailer is set up. Returns its status. */
export async function sendEmail(db: Db, clock: Clock, settings: MailSettings, mailer: Mailer | undefined, email: OutgoingEmail, caseId: string | null, messageId: string | null): Promise<"off" | "sent" | "failed"> {
  let status: "off" | "sent" | "failed" = "off";
  if (mailer) {
    try {
      await mailer.send(settings.from, email);
      status = "sent";
    } catch {
      status = "failed";
    }
  }
  await db.run(
    `INSERT INTO email_outbox (id, to_addr, subject, body, reply_to, headers, case_id, message_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), email.to, email.subject, email.text, email.replyTo, JSON.stringify(email.headers), caseId, messageId, status, clock.now()],
  );
  return status;
}
