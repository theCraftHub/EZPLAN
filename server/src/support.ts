/**
 * Getting help: a company's own support contact, requests to our support team, and our team's
 * inbox. Our staff can't see customer plans unless the person granted 7 days of access to one
 * plan on that request; every view is logged and the grant can be revoked at any time.
 */
import type { Hono } from "hono";
import { exportPlan, freeModeration } from "@ezplan/shared";
import { openCases } from "./safetyCases";
import type { Mailer } from "./mail";
import type { Clock, Db, ServerConfig, User } from "./ports";
import { notify } from "./notify";
import { loadRoom } from "./room";
import { isPlatformAdmin } from "./safety";
import type { Role } from "./roles";

const TOPICS = ["problem", "question", "billing", "account", "safety"] as const;
type Topic = (typeof TOPICS)[number];
const STATUSES = ["open", "waiting", "solved"] as const;
const GRANT_DAYS = 7;
const DAY = 86_400_000;
const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;

export interface SupportDeps {
  db: Db;
  clock: Clock;
  config: ServerConfig;
  mail?: Mailer;
  access: (planId: string, userId: string) => Promise<{ role: Role; workspace_id: string; title: string } | null>;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

export function registerSupportRoutes(app: Hono<{ Variables: { user: User } }>, d: SupportDeps) {
  const { db, clock } = d;
  const staff = (u: User) => isPlatformAdmin(d.config, u);
  const wsRole = async (ws: string, userId: string) => (await db.first<{ role: Role }>(`SELECT role FROM members WHERE workspace_id = ? AND user_id = ?`, [ws, userId]))?.role ?? null;
  /** Workspaces whose support contact this person may see: their own, and those of plans shared with them. */
  const myWorkspaces = (userId: string) =>
    db.all<{ id: string; name: string; role: Role | null }>(
      `SELECT w.id, w.name, m.role FROM workspaces w JOIN members m ON m.workspace_id = w.id AND m.user_id = ?
       UNION SELECT w.id, w.name, NULL FROM plan_members pm JOIN plans p ON p.id = pm.plan_id JOIN workspaces w ON w.id = p.workspace_id WHERE pm.user_id = ?`,
      [userId, userId],
    );
  type ContactRow = { workspace_id: string; team: string; email: string | null; phone: string | null; url: string | null; hours: string | null; note: string | null; route: string };
  const contactOf = (r: ContactRow | null) => (r ? { team: r.team, email: r.email, phone: r.phone, url: r.url, hours: r.hours, note: r.note, route: r.route as "direct" | "it_only" } : null);

  // ------------------------------------------------------------ company contact

  app.get("/api/help", async (c) => {
    const user = c.get("user");
    const wss = await myWorkspaces(user.id);
    const out = [];
    for (const w of wss) {
      const r = await db.first<ContactRow>(`SELECT * FROM support_contacts WHERE workspace_id = ?`, [w.id]);
      out.push({ workspaceId: w.id, name: w.name, canManage: w.role === "manager", contact: contactOf(r) });
    }
    return c.json({ workspaces: out, staff: staff(user) });
  });

  app.put("/api/workspaces/:ws/support-contact", async (c) => {
    const user = c.get("user");
    const ws = c.req.param("ws");
    if ((await wsRole(ws, user.id)) !== "manager") return c.json({ error: "Only workspace managers can set the support contact." }, 403);
    const b = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (b?.clear === true) {
      await db.run(`DELETE FROM support_contacts WHERE workspace_id = ?`, [ws]);
      return c.json({ ok: true });
    }
    const team = clean(b?.team, 80);
    const email = clean(b?.email, 254);
    const phone = clean(b?.phone, 40);
    const url = clean(b?.url, 500);
    const hours = clean(b?.hours, 120);
    const note = clean(b?.note, 300);
    const route = b?.route === "it_only" ? "it_only" : "direct";
    if (!team) return c.json({ error: "Give the team a name, like \"IT help desk\"." }, 400);
    if (!email && !phone && !url) return c.json({ error: "Add at least one way to reach them: email, phone or a help-desk link." }, 400);
    if (email && !EMAIL.test(email)) return c.json({ error: "Enter a full email address, like help@example.com." }, 400);
    if (phone && !/^[+\d][\d\s().-]{4,38}$/.test(phone)) return c.json({ error: "Enter the phone number with digits, spaces or dashes." }, 400);
    if (url) {
      let ok = false;
      try { ok = ["http:", "https:"].includes(new URL(url).protocol); } catch { ok = false; }
      if (!ok) return c.json({ error: "The help-desk link must start with https:// (or http://)." }, 400);
    }
    await db.run(
      `INSERT INTO support_contacts (workspace_id, team, email, phone, url, hours, note, route, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id) DO UPDATE SET team = excluded.team, email = excluded.email, phone = excluded.phone, url = excluded.url, hours = excluded.hours, note = excluded.note, route = excluded.route, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [ws, team, email || null, phone || null, url || null, hours || null, note || null, route, user.id, clock.now()],
    );
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ requests

  type TicketRow = { id: string; user_id: string; workspace_id: string | null; topic: string; subject: string; status: string; via: string; context: string; created_at: number; updated_at: number };
  /** Who may read a request: its author, our staff (once it reaches us), or the company's managers while it's with them. */
  async function canSee(t: TicketRow, user: User): Promise<"author" | "staff" | "it" | null> {
    if (t.user_id === user.id) return "author";
    if (t.via === "direct" && staff(user)) return "staff";
    if (t.via === "it" && t.workspace_id && (await wsRole(t.workspace_id, user.id)) === "manager") return "it";
    return null;
  }
  const ticket = (id: string) => db.first<TicketRow>(`SELECT * FROM support_tickets WHERE id = ?`, [id]);
  const nameOf = async (id: string) => (await db.first<{ name: string }>(`SELECT name FROM users WHERE id = ?`, [id]))?.name ?? "Someone";
  const liveGrant = (ticketId: string) => db.first<{ id: string; plan_id: string; expires_at: number }>(`SELECT id, plan_id, expires_at FROM support_access_grants WHERE ticket_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1`, [ticketId, clock.now()]);

  app.post("/api/support/tickets", async (c) => {
    const user = c.get("user");
    const b = await c.req.json<Record<string, unknown>>().catch(() => null);
    const topic = TOPICS.includes(b?.topic as Topic) ? (b!.topic as Topic) : null;
    const subject = clean(b?.subject, 150);
    const body = clean(b?.body, 5000);
    if (!topic) return c.json({ error: "Choose what it's about." }, 400);
    if (!subject || !body) return c.json({ error: "Add a short subject and describe what happened." }, 400);
    // Abuse reports may quote what they report; everything else is screened like comments.
    if (topic !== "safety" && freeModeration(`${subject}\n${body}`).verdict !== "allow") return c.json({ error: "This request can't be sent because it may break the Acceptable Use Policy." }, 422);
    const planId = typeof b?.planId === "string" && b.planId ? b.planId : null;
    const plan = planId ? await d.access(planId, user.id) : null;
    if (planId && !plan) return c.json({ error: "That plan doesn't exist or you don't have access to it." }, 404);
    const wsId = plan?.workspace_id ?? (await myWorkspaces(user.id)).find((w) => w.role)?.id ?? null;
    const route = wsId ? (await db.first<{ route: string }>(`SELECT route FROM support_contacts WHERE workspace_id = ?`, [wsId]))?.route : null;
    // Safety reports always reach us directly, whatever the company's routing.
    const via = route === "it_only" && topic !== "safety" ? "it" : "direct";
    const ctx = b?.context && typeof b.context === "object" ? b.context as Record<string, unknown> : {};
    const context = JSON.stringify({ page: clean(ctx.page, 200), browser: clean(ctx.browser, 300), version: clean(ctx.version, 40), errors: Array.isArray(ctx.errors) ? ctx.errors.slice(0, 10).map((e) => clean(e, 300)) : [] });
    const id = crypto.randomUUID();
    const now = clock.now();
    await db.batch([
      { sql: `INSERT INTO support_tickets (id, user_id, workspace_id, topic, subject, status, via, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`, params: [id, user.id, wsId, topic, subject, via, context, now, now] },
      { sql: `INSERT INTO support_messages (id, ticket_id, author_id, from_staff, body, created_at) VALUES (?, ?, ?, 0, ?, ?)`, params: [crypto.randomUUID(), id, user.id, body, now] },
      ...(planId && b?.sharePlan === true ? [{ sql: `INSERT INTO support_access_grants (id, ticket_id, plan_id, granted_by, expires_at) VALUES (?, ?, ?, ?, ?)`, params: [crypto.randomUUID(), id, planId, user.id, now + GRANT_DAYS * DAY] }] : []),
    ]);
    if (topic === "safety") {
      // The reporter's own company gets a follow-up case (app + email) that never says who reported or what (owner, Nov 24).
      // Only workspaces the reporter belongs to: a guest reporting another company's plan never alerts that company.
      // A report about a plan in one of their workspaces goes to that one; otherwise to each workspace they belong to.
      const homes = (await myWorkspaces(user.id)).filter((w) => w.role).map((w) => w.id);
      await openCases({ db, clock, config: d.config, ...(d.mail ? { mail: d.mail } : {}) }, id, user.id, plan && homes.includes(plan.workspace_id) ? [plan.workspace_id] : homes);
      await db.run(`INSERT INTO safety_holds (id, plan_id, user_id, feature, category, excerpt, status, created_at) VALUES (?, NULL, ?, 'abuse', 'abuse report', ?, 'held', ?)`, [crypto.randomUUID(), user.id, `${subject}\n${body}`.slice(0, 600), now]);
    }
    if (via === "it" && wsId) {
      const managers = await db.all<{ user_id: string }>(`SELECT user_id FROM members WHERE workspace_id = ? AND role = 'manager'`, [wsId]);
      for (const m of managers) await notify(db, now, { userId: m.user_id, kind: "support", text: `${user.name} asked for help: ${subject}`, link: `/help/requests/${id}` }, user.id);
    }
    return c.json({ id, via }, 201);
  });

  app.get("/api/support/tickets", async (c) => {
    const user = c.get("user");
    const mine = await db.all<TicketRow>(`SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`, [user.id]);
    const company = await db.all<TicketRow & { name: string }>(
      `SELECT t.*, u.name FROM support_tickets t JOIN users u ON u.id = t.user_id JOIN members m ON m.workspace_id = t.workspace_id AND m.user_id = ? AND m.role = 'manager'
       WHERE t.via = 'it' AND t.user_id != ? ORDER BY t.updated_at DESC LIMIT 100`,
      [user.id, user.id],
    );
    const row = (t: TicketRow & { name?: string }) => ({ id: t.id, topic: t.topic, subject: t.subject, status: t.status, via: t.via, from: t.name ?? null, updatedAt: Number(t.updated_at) });
    return c.json({ mine: mine.map(row), company: company.map(row) });
  });

  app.get("/api/support/tickets/:tid", async (c) => {
    const user = c.get("user");
    const t = await ticket(c.req.param("tid"));
    const as = t ? await canSee(t, user) : null;
    if (!t || !as) return c.json({ error: "That request doesn't exist." }, 404);
    const msgs = await db.all<{ id: string; name: string; from_staff: number; body: string; created_at: number }>(
      `SELECT m.id, u.name, m.from_staff, m.body, m.created_at FROM support_messages m JOIN users u ON u.id = m.author_id WHERE m.ticket_id = ? ORDER BY m.created_at, m.rowid`,
      [t.id],
    );
    const grants = await db.all<{ id: string; plan_id: string; title: string | null; expires_at: number; revoked_at: number | null }>(
      `SELECT g.id, g.plan_id, p.title, g.expires_at, g.revoked_at FROM support_access_grants g LEFT JOIN plans p ON p.id = g.plan_id WHERE g.ticket_id = ?`,
      [t.id],
    );
    const views = await db.all<{ name: string; viewed_at: number }>(`SELECT u.name, l.viewed_at FROM support_access_log l JOIN support_access_grants g ON g.id = l.grant_id JOIN users u ON u.id = l.staff_id WHERE g.ticket_id = ? ORDER BY l.viewed_at DESC`, [t.id]);
    return c.json({
      as,
      ticket: { id: t.id, topic: t.topic, subject: t.subject, status: t.status, via: t.via, from: await nameOf(t.user_id), createdAt: Number(t.created_at), context: as === "author" ? null : JSON.parse(t.context) },
      messages: msgs.map((m) => ({ id: m.id, author: m.name, fromStaff: !!m.from_staff, body: m.body, createdAt: Number(m.created_at) })),
      grants: grants.map((g) => ({ id: g.id, planId: g.plan_id, planTitle: g.title, expiresAt: Number(g.expires_at), active: !g.revoked_at && Number(g.expires_at) > clock.now() })),
      views: views.map((v) => ({ by: v.name, at: Number(v.viewed_at) })),
    });
  });

  app.post("/api/support/tickets/:tid/messages", async (c) => {
    const user = c.get("user");
    const t = await ticket(c.req.param("tid"));
    const as = t ? await canSee(t, user) : null;
    if (!t || !as) return c.json({ error: "That request doesn't exist." }, 404);
    const body = clean((await c.req.json<{ body?: unknown }>().catch(() => null))?.body, 5000);
    if (!body) return c.json({ error: "Write a reply first." }, 400);
    const now = clock.now();
    const status = as === "author" ? "open" : "waiting";
    await db.batch([
      { sql: `INSERT INTO support_messages (id, ticket_id, author_id, from_staff, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`, params: [crypto.randomUUID(), t.id, user.id, as === "author" ? 0 : 1, body, now] },
      { sql: `UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?`, params: [status, now, t.id] },
    ]);
    if (as !== "author") await notify(db, now, { userId: t.user_id, kind: "support", text: `${as === "staff" ? "Support" : await nameOf(user.id)} replied: ${t.subject}`, link: `/help/requests/${t.id}` }, user.id);
    return c.json({ ok: true, status });
  });

  app.post("/api/support/tickets/:tid/status", async (c) => {
    const user = c.get("user");
    const t = await ticket(c.req.param("tid"));
    const as = t ? await canSee(t, user) : null;
    if (!t || !as) return c.json({ error: "That request doesn't exist." }, 404);
    const status = (await c.req.json<{ status?: unknown }>().catch(() => null))?.status;
    if (!STATUSES.includes(status as (typeof STATUSES)[number])) return c.json({ error: "Choose open, waiting or solved." }, 400);
    if (as === "author" && status === "waiting") return c.json({ error: "Choose open or solved." }, 400);
    await db.run(`UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?`, [status as string, clock.now(), t.id]);
    return c.json({ ok: true });
  });

  // The company's managers pass a request on to us when they can't solve it themselves.
  app.post("/api/support/tickets/:tid/forward", async (c) => {
    const user = c.get("user");
    const t = await ticket(c.req.param("tid"));
    if (!t || (await canSee(t, user)) !== "it") return c.json({ error: "That request doesn't exist." }, 404);
    await db.run(`UPDATE support_tickets SET via = 'direct', status = 'open', updated_at = ? WHERE id = ?`, [clock.now(), t.id]);
    await db.run(`INSERT INTO support_messages (id, ticket_id, author_id, from_staff, body, created_at) VALUES (?, ?, ?, 0, ?, ?)`, [crypto.randomUUID(), t.id, user.id, `${user.name} passed this request on to support.`, clock.now()]);
    await notify(db, clock.now(), { userId: t.user_id, kind: "support", text: `${user.name} passed your request on to support: ${t.subject}`, link: `/help/requests/${t.id}` }, user.id);
    return c.json({ ok: true });
  });

  app.delete("/api/support/grants/:gid", async (c) => {
    const user = c.get("user");
    const g = await db.first<{ ticket_id: string; granted_by: string; plan_id: string }>(`SELECT ticket_id, granted_by, plan_id FROM support_access_grants WHERE id = ?`, [c.req.param("gid")]);
    const a = g ? await d.access(g.plan_id, user.id) : null;
    if (!g || (g.granted_by !== user.id && a?.role !== "manager")) return c.json({ error: "Not found." }, 404);
    await db.run(`UPDATE support_access_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, [clock.now(), c.req.param("gid")]);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ our team's inbox

  app.get("/api/admin/support", async (c) => {
    const user = c.get("user");
    if (!staff(user)) return c.json({ error: "Not found." }, 404);
    const status = c.req.query("status");
    const rows = await db.all<TicketRow & { name: string; email: string }>(
      `SELECT t.*, u.name, u.email FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.via = 'direct'${STATUSES.includes(status as never) ? " AND t.status = ?" : ""} ORDER BY (t.status = 'open') DESC, t.updated_at DESC LIMIT 200`,
      STATUSES.includes(status as never) ? [status!] : [],
    );
    const open = Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM support_tickets WHERE via = 'direct' AND status = 'open'`))?.n ?? 0);
    return c.json({ open, items: rows.map((t) => ({ id: t.id, topic: t.topic, subject: t.subject, status: t.status, from: t.name, email: t.email, updatedAt: Number(t.updated_at) })) });
  });

  /** A plan, read-only, only while the person's grant on this request lasts. Every view is logged. */
  app.get("/api/admin/support/tickets/:tid/plan", async (c) => {
    const user = c.get("user");
    const t = await ticket(c.req.param("tid"));
    if (!t || !staff(user) || t.via !== "direct") return c.json({ error: "Not found." }, 404);
    const g = await liveGrant(t.id);
    if (!g) return c.json({ error: "There's no access to a plan on this request (it was never given, has ended or was taken back)." }, 404);
    const room = await loadRoom(db, g.plan_id);
    if (!room) return c.json({ error: "Not found." }, 404);
    await db.run(`INSERT INTO support_access_log (id, grant_id, staff_id, viewed_at) VALUES (?, ?, ?, ?)`, [crypto.randomUUID(), g.id, user.id, clock.now()]);
    return c.json({ planId: g.plan_id, title: room.plan.title, until: Number(g.expires_at), text: exportPlan(room.plan) });
  });
}

/** Open requests waiting for our team (for the badge). */
export async function supportOpen(db: Db): Promise<number> {
  return Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM support_tickets WHERE via = 'direct' AND status = 'open'`))?.n ?? 0);
}
