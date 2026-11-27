/**
 * Read-only share links (step N1, plan section 6): `/s/<token>` shows a plan's overview, checklist
 * and timeline to anyone with the link, without signing in. Made from the plan's Share page, with an
 * optional expiry; revocable; the token is stored only as a hash. Company plans follow the company's
 * rules (who may share outside the company). Shared copies leave out email addresses.
 */
import type { Context, Hono } from "hono";
import type { Plan } from "@rakuplan/shared";
import type { Db, Clock, User } from "./ports";
import { randomToken, sha256 } from "./sessions";
import { audit, companyOf, orgRole } from "./orgs";
import { loadRoom } from "./room";

const DAY = 86_400_000;
export const SHARE_DAYS = [7, 30, 90] as const;

type Access = { workspace_id: string; ws_role: string | null; role: string; title: string; state: string; archived: boolean; canShare: boolean } | null;

export interface ShareDeps {
  db: Db;
  clock: Clock;
  siteOrigin: string;
  notFound: { error: string };
  access: (planId: string, userId: string) => Promise<Access>;
  /** Availability saved for the plan, by name. */
  people: (planId: string) => Promise<Record<string, unknown>>;
  workWeek: (planId: string) => Promise<unknown>;
  limited: (c: Context, subject: string) => Promise<Response | null>;
}

/** A plan as the public may see it: no email addresses. */
function publicPlan(plan: Plan): Plan {
  const p = structuredClone(plan);
  p.team = p.team.map((m) => ({ name: m.name }));
  return p;
}

/** Whether this person may make share links for the plan (company rules first). */
async function mayShare(db: Db, a: NonNullable<Access>, user: User): Promise<string | null> {
  if (a.archived) return "This plan is archived. Restore it to share it.";
  if (a.state === "review") return "This plan is waiting for a safety review. Sharing is paused until then.";
  if (!a.canShare) return "Only people in this plan's workspace can share it.";
  const company = await companyOf(db, a.workspace_id);
  if (!company) return null;
  const mine = await orgRole(db, company.orgId, user.id);
  const admin = mine === "owner" || mine === "admin";
  if (company.rules.outsideInvites === "admins" && !admin) return `${company.name} only lets Owners and Admins make share links.`;
  if (company.rules.outsideInvites === "managers" && !admin && a.ws_role !== "manager") return `${company.name} only lets managers make share links.`;
  return null;
}

export function registerPublicShareRoute(app: Hono, d: ShareDeps) {
  const { db, clock } = d;
  // Public: no sign-in. The same answer for a wrong, expired or revoked link.
  app.get("/api/share/:token", async (c) => {
    const limited = await d.limited(c, "share");
    if (limited) return limited;
    const gone = c.json({ error: "This link doesn't work any more. Ask whoever sent it for a new one." }, 404);
    const token = c.req.param("token");
    if (!token || token.length > 100) return gone;
    const now = clock.now();
    const row = await db.first<{ id: string; plan_id: string; expires_at: number | null; revoked_at: number | null }>(`SELECT id, plan_id, expires_at, revoked_at FROM share_links WHERE token_hash = ?`, [await sha256(token)]);
    if (!row || row.revoked_at || (row.expires_at !== null && Number(row.expires_at) <= now)) return gone;
    const plan = await db.first<{ state: string }>(`SELECT state FROM plans WHERE id = ?`, [row.plan_id]);
    if (!plan || plan.state !== "active") return gone;
    const room = await loadRoom(db, row.plan_id);
    if (!room) return gone;
    // Refreshes from an open page (?since=) aren't counted as opens.
    const since = c.req.query("since");
    if (since === undefined) await db.run(`UPDATE share_links SET last_opened_at = ?, opens = opens + 1 WHERE id = ?`, [now, row.id]);
    else if (Number(since) === room.seq) return c.json({ version: room.seq, unchanged: true });
    c.header("x-robots-tag", "noindex, nofollow");
    return c.json({ version: room.seq, plan: publicPlan(room.plan), people: await d.people(row.plan_id), workWeek: await d.workWeek(row.plan_id), today: clock.today(), expiresAt: row.expires_at === null ? null : Number(row.expires_at) });
  });
}

export function registerShareRoutes(app: Hono<{ Variables: { user: User } }>, d: ShareDeps) {
  const { db, clock } = d;

  app.get("/api/plans/:id/shares", async (c) => {
    const user = c.get("user");
    const a = await d.access(c.req.param("id"), user.id);
    if (!a) return c.json(d.notFound, 404);
    const why = await mayShare(db, a, user);
    const rows = a.canShare ? await db.all<{ id: string; created_at: number; expires_at: number | null; last_opened_at: number | null; opens: number; name: string }>(
      `SELECT s.id, s.created_at, s.expires_at, s.last_opened_at, s.opens, u.name FROM share_links s JOIN users u ON u.id = s.created_by WHERE s.plan_id = ? AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?) ORDER BY s.created_at DESC`, [c.req.param("id"), clock.now()]) : [];
    return c.json({ canShare: why === null, reason: why, links: rows.map((r) => ({ id: r.id, by: r.name, createdAt: Number(r.created_at), expiresAt: r.expires_at === null ? null : Number(r.expires_at), lastOpenedAt: r.last_opened_at === null ? null : Number(r.last_opened_at), opens: Number(r.opens) })) });
  });

  app.post("/api/plans/:id/shares", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    const why = await mayShare(db, a, user);
    if (why) return c.json({ error: why }, 403);
    const b = await c.req.json<{ days?: unknown }>().catch(() => null);
    const days = b?.days === null || b?.days === undefined ? null : Number(b.days);
    if (days !== null && !(SHARE_DAYS as readonly number[]).includes(days)) return c.json({ error: "Choose 7, 30 or 90 days, or no expiry." }, 400);
    const count = Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM share_links WHERE plan_id = ? AND revoked_at IS NULL`, [id]))?.n ?? 0);
    if (count >= 20) return c.json({ error: "A plan can have up to 20 share links. Turn off one you don't need." }, 400);
    const token = randomToken();
    const now = clock.now();
    const linkId = crypto.randomUUID();
    const expiresAt = days === null ? null : now + days * DAY;
    await db.run(`INSERT INTO share_links (id, plan_id, token_hash, created_by, created_at, expires_at, opens) VALUES (?, ?, ?, ?, ?, ?, 0)`, [linkId, id, await sha256(token), user.id, now, expiresAt]);
    const company = await companyOf(db, a.workspace_id);
    if (company) await audit(db, now, company.orgId, { id: user.id, name: user.name }, "plan.shared", a.title, { planId: id, days });
    // The link is shown once; only its hash is kept.
    return c.json({ id: linkId, url: `${d.siteOrigin}/s/${token}`, expiresAt }, 201);
  });

  app.delete("/api/plans/:id/shares/:sid", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    if (!a.canShare) return c.json({ error: "Only people in this plan's workspace can turn off share links." }, 403);
    const r = await db.run(`UPDATE share_links SET revoked_at = ? WHERE id = ? AND plan_id = ? AND revoked_at IS NULL`, [clock.now(), c.req.param("sid"), id]);
    if (!r.changes) return c.json({ error: "That link is already off." }, 404);
    const company = await companyOf(db, a.workspace_id);
    if (company) await audit(db, clock.now(), company.orgId, { id: user.id, name: user.name }, "plan.share_revoked", a.title, { planId: id });
    return c.json({ ok: true });
  });
}
