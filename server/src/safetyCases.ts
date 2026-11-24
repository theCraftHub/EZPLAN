/**
 * Safety cases: when someone reports abuse, each company they belong to gets a follow-up case that
 * the owner's safety team (PLATFORM_ADMINS) and that company's managers share, in the app and by
 * email. A case never shows who reported or what they wrote, and the reporter can't open it.
 * Owner decisions, Nov 24: notice wording, email thread from day one, replies by email.
 */
import type { Hono } from "hono";
import { BRAND } from "@ezplan/shared";
import type { Clock, Db, ServerConfig, User } from "./ports";
import { notify } from "./notify";
import { isPlatformAdmin } from "./safety";
import { bareAddress, caseFromReply, mailSettings, REPLY_MARKER, replyAddress, replyText, sendEmail, type Mailer } from "./mail";

export interface CaseDeps { db: Db; clock: Clock; config: ServerConfig; mail?: Mailer }

export const CASE_NOTICE = `Our system flagged behavior within your workspace that requires follow-up by ${BRAND.name}'s safety team. Further communication will follow in this thread if your company needs to take any steps.`;
const TEAM = `${BRAND.name} safety team`;

type CaseRow = { id: string; workspace_id: string; report_id: string; reporter_id: string; status: string; created_at: number; updated_at: number };

/** Managers of a case's company who may see it: never the reporter. */
const caseManagers = (db: Db, c: CaseRow) =>
  db.all<{ id: string; name: string; email: string }>(
    `SELECT u.id, u.name, u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'manager' AND u.id != ? AND u.suspended_at IS NULL`,
    [c.workspace_id, c.reporter_id],
  );

/** The safety team's accounts (for the bell); their emails come from PLATFORM_ADMINS. */
const staffUsers = (db: Db, config: ServerConfig) => {
  const emails = config.platformAdmins ?? [];
  return emails.length ? db.all<{ id: string; email: string }>(`SELECT id, email FROM users WHERE lower(email) IN (${emails.map(() => "?").join(", ")})`, emails) : Promise.resolve([]);
};

/** Adds a message, then tells the other side in the app and by email (threaded, with a reply address each). */
async function post(d: CaseDeps, c: CaseRow, m: { authorId: string | null; authorName: string; fromStaff: boolean; via: "app" | "email" | "system"; body: string }) {
  const { db, clock, config } = d;
  const now = clock.now();
  const id = crypto.randomUUID();
  await db.batch([
    { sql: `INSERT INTO safety_case_messages (id, case_id, author_id, author_name, from_staff, via, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, params: [id, c.id, m.authorId, m.authorName, m.fromStaff ? 1 : 0, m.via, m.body, now] },
    { sql: `UPDATE safety_cases SET updated_at = ?, status = 'open', closed_at = NULL WHERE id = ?`, params: [now, c.id] },
  ]);
  const ws = (await db.first<{ name: string }>(`SELECT name FROM workspaces WHERE id = ?`, [c.workspace_id]))?.name ?? "your workspace";
  const settings = mailSettings(config, BRAND.name);
  const managers = await caseManagers(db, c);
  const link = `${config.publicUrl}/help/cases/${c.id}`;
  // Managers hear from the team and from each other; the team hears from managers.
  const toManagers = managers.filter((p) => p.id !== m.authorId);
  const staffEmails = m.fromStaff ? [] : (config.platformAdmins ?? []);
  const shown = m.fromStaff ? TEAM : m.authorName;
  const subject = `${BRAND.name} safety follow-up: ${ws} (case ${c.id.slice(0, 8)})`;
  const root = `<case-${c.id}@${settings.replyDomain}>`;
  const first = !(await db.first(`SELECT 1 AS x FROM email_outbox WHERE case_id = ?`, [c.id]));
  const headers: Record<string, string> = first ? { "Message-ID": root } : { "Message-ID": `<case-${c.id}.${id}@${settings.replyDomain}>`, "In-Reply-To": root, References: root };
  for (const to of [...toManagers.map((p) => ({ email: p.email, staff: false })), ...staffEmails.map((e) => ({ email: e, staff: true }))]) {
    const text = [
      REPLY_MARKER,
      "",
      `${shown} wrote:`,
      m.body,
      "",
      `Reply to this email, or open the case: ${link}`,
      to.staff ? `Original report (safety team only): ${config.publicUrl}/help/requests/${c.report_id}` : `You're getting this because you manage ${ws} on ${BRAND.name}. The case doesn't say who reported it or what they wrote.`,
    ].join("\n");
    await sendEmail(db, clock, settings, d.mail, { to: to.email, subject, text, replyTo: await replyAddress(db, settings, c.id, to.email), headers }, c.id, id);
  }
  for (const p of toManagers) await notify(db, now, { userId: p.id, kind: "safety", text: m.via === "system" ? m.body : `${shown} wrote in a safety case for ${ws}`, link: `/help/cases/${c.id}` }, m.authorId ?? undefined);
  if (!m.fromStaff) for (const s of await staffUsers(db, config)) await notify(db, now, { userId: s.id, kind: "safety", text: `${m.authorName} (${ws}) replied in a safety case`, link: `/help/cases/${c.id}` }, m.authorId ?? undefined);
}

/** Opens a case for each company the reporter belongs to that has another manager. Returns the case ids. */
export async function openCases(d: CaseDeps, reportId: string, reporterId: string, workspaceIds: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const ws of workspaceIds) {
    const others = await d.db.first(`SELECT 1 AS x FROM members WHERE workspace_id = ? AND role = 'manager' AND user_id != ?`, [ws, reporterId]);
    if (!others) continue; // a private workspace: nobody else to tell
    const now = d.clock.now();
    const c: CaseRow = { id: crypto.randomUUID(), workspace_id: ws, report_id: reportId, reporter_id: reporterId, status: "open", created_at: now, updated_at: now };
    await d.db.run(`INSERT INTO safety_cases (id, workspace_id, report_id, reporter_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?)`, [c.id, ws, reportId, reporterId, now, now]);
    await post(d, c, { authorId: null, authorName: TEAM, fromStaff: true, via: "system", body: CASE_NOTICE });
    ids.push(c.id);
  }
  return ids;
}

export function registerSafetyCaseRoutes(app: Hono<{ Variables: { user: User } }>, d: CaseDeps) {
  const { db, config } = d;
  const notFound = { error: "This case doesn't exist or you can't open it." };
  const load = (id: string) => db.first<CaseRow>(`SELECT * FROM safety_cases WHERE id = ?`, [id]);
  /** "staff", "manager" (of that company, not the reporter), or nobody. */
  const roleIn = async (c: CaseRow, user: User): Promise<"staff" | "manager" | null> => {
    if (isPlatformAdmin(config, user)) return "staff";
    if (user.id === c.reporter_id) return null;
    return (await db.first(`SELECT 1 AS x FROM members WHERE workspace_id = ? AND user_id = ? AND role = 'manager'`, [c.workspace_id, user.id])) ? "manager" : null;
  };

  app.get("/api/safety-cases", async (c) => {
    const user = c.get("user");
    const staff = isPlatformAdmin(config, user);
    const rows = await db.all<CaseRow & { ws: string; last: string | null; last_staff: number | null }>(
      `SELECT sc.*, w.name AS ws,
         (SELECT author_name FROM safety_case_messages WHERE case_id = sc.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last,
         (SELECT from_staff FROM safety_case_messages WHERE case_id = sc.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_staff
       FROM safety_cases sc JOIN workspaces w ON w.id = sc.workspace_id
       WHERE ${staff ? "1 = 1" : "sc.reporter_id != ? AND sc.workspace_id IN (SELECT workspace_id FROM members WHERE user_id = ? AND role = 'manager')"}
       ORDER BY (sc.status = 'open') DESC, sc.updated_at DESC LIMIT 100`,
      staff ? [] : [user.id, user.id],
    );
    return c.json({ items: rows.map((r) => ({ id: r.id, workspace: r.ws, status: r.status, lastFrom: r.last_staff && !staff ? TEAM : r.last, updatedAt: Number(r.updated_at) })) });
  });

  app.get("/api/safety-cases/:id", async (c) => {
    const user = c.get("user");
    const sc = await load(c.req.param("id"));
    const as = sc && (await roleIn(sc, user));
    if (!sc || !as) return c.json(notFound, 404);
    const ws = (await db.first<{ name: string }>(`SELECT name FROM workspaces WHERE id = ?`, [sc.workspace_id]))?.name ?? "";
    const msgs = await db.all<{ id: string; author_name: string; from_staff: number; via: string; body: string; created_at: number }>(`SELECT id, author_name, from_staff, via, body, created_at FROM safety_case_messages WHERE case_id = ? ORDER BY created_at, rowid`, [sc.id]);
    const sent = as === "staff" ? await db.all<{ message_id: string; to_addr: string; status: string }>(`SELECT message_id, to_addr, status FROM email_outbox WHERE case_id = ? ORDER BY created_at, rowid`, [sc.id]) : [];
    return c.json({
      as,
      case: { id: sc.id, workspace: ws, status: sc.status, createdAt: Number(sc.created_at), reportId: as === "staff" ? sc.report_id : null },
      messages: msgs.map((m) => ({ id: m.id, author: m.from_staff && as !== "staff" ? TEAM : m.author_name, fromStaff: !!m.from_staff, via: m.via, body: m.body, createdAt: Number(m.created_at), emails: as === "staff" ? sent.filter((e) => e.message_id === m.id).map((e) => ({ to: e.to_addr, status: e.status })) : undefined })),
      emailOff: !d.mail,
    });
  });

  app.post("/api/safety-cases/:id/messages", async (c) => {
    const user = c.get("user");
    const sc = await load(c.req.param("id"));
    const as = sc && (await roleIn(sc, user));
    if (!sc || !as) return c.json(notFound, 404);
    const b = await c.req.json<{ body?: unknown }>().catch(() => null);
    const body = typeof b?.body === "string" ? b.body.replace(/\r\n/g, "\n").trim().slice(0, 5000) : "";
    if (!body) return c.json({ error: "Write something first." }, 400);
    await post(d, sc, { authorId: user.id, authorName: user.name, fromStaff: as === "staff", via: "app", body });
    return c.json({ ok: true });
  });

  app.post("/api/safety-cases/:id/status", async (c) => {
    const user = c.get("user");
    const sc = await load(c.req.param("id"));
    if (!sc || (await roleIn(sc, user)) !== "staff") return c.json(notFound, 404);
    const b = await c.req.json<{ status?: unknown }>().catch(() => null);
    if (b?.status !== "open" && b?.status !== "closed") return c.json({ error: "Choose open or closed." }, 400);
    const now = d.clock.now();
    await db.run(`UPDATE safety_cases SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?`, [b.status, b.status === "closed" ? now : null, now, sc.id]);
    return c.json({ ok: true });
  });
}

/**
 * Replies by email. Any provider that can POST received mail as JSON works (Resend inbound,
 * Postmark, Mailgun, a Cloudflare Email Worker): { from, to, subject?, text }. Off until
 * INBOUND_EMAIL_SECRET is set; the provider sends it as "Authorization: Bearer <secret>".
 * Mounted before sign-in, since the caller is the email provider, not a person.
 */
export function registerInboundEmail(app: Hono, d: CaseDeps, ready: () => Promise<unknown>) {
  const { db, config } = d;
  app.post("/inbound/email", async (c) => {
    await ready();
    const settings = mailSettings(config, BRAND.name);
    if (!settings.inboundSecret) return c.json({ error: "Not found." }, 404);
    if (c.req.header("authorization") !== `Bearer ${settings.inboundSecret}`) return c.json({ error: "Not allowed." }, 401);
    const b = await c.req.json<{ from?: unknown; to?: unknown; text?: unknown }>().catch(() => null);
    const from = typeof b?.from === "string" ? bareAddress(b.from) : "";
    const to = (Array.isArray(b?.to) ? b!.to : [b?.to]).filter((x): x is string => typeof x === "string");
    // Unknown or forged replies are accepted and dropped, so the provider doesn't retry them.
    const caseId = from && (await caseFromReply(db, settings, to, from));
    if (!caseId) return c.json({ ok: true, accepted: false }, 202);
    const sc = await db.first<CaseRow>(`SELECT * FROM safety_cases WHERE id = ?`, [caseId]);
    if (!sc) return c.json({ ok: true, accepted: false }, 202);
    const body = replyText(typeof b?.text === "string" ? b.text : "");
    if (!body) return c.json({ ok: true, accepted: false }, 202);
    if ((config.platformAdmins ?? []).includes(from)) {
      const u = await db.first<{ id: string; name: string }>(`SELECT id, name FROM users WHERE lower(email) = ?`, [from]);
      await post(d, sc, { authorId: u?.id ?? null, authorName: u?.name ?? TEAM, fromStaff: true, via: "email", body });
      return c.json({ ok: true, accepted: true });
    }
    // Still a manager of that company (not the reporter) at the time of the reply.
    const u = (await caseManagers(db, sc)).find((p) => p.email.toLowerCase() === from);
    if (!u) return c.json({ ok: true, accepted: false }, 202);
    await post(d, sc, { authorId: u.id, authorName: u.name, fromStaff: false, via: "email", body });
    return c.json({ ok: true, accepted: true });
  });
}
