/**
 * AI credits and spending for a workspace: requests for more, approvals, allowances, top-ups,
 * department labels, and the spending breakdowns (people, projects, departments) with CSV export.
 * Who may do what is checked here, on the server, for every request.
 */
import type { Hono } from "hono";
import type { Clock, Db, ServerConfig, User } from "../ports";
import { DEFAULT_AI_LIMITS } from "../ports";
import { monthOf, type AiService } from "./routes";

type Role = "manager" | "editor" | "viewer";

/** Permissions for AI credits. With organizations (phase 1b/4) these map to Owner, Admin, Billing admin. */
export const canManageAiCredits = (role: Role | null | undefined) => role === "manager";
export const canViewAiSpending = (role: Role | null | undefined) => role === "manager";

/** A cell safe to open in a spreadsheet: formulas are neutralized (section 4c). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const NO_PROJECT = "none";
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export function registerAiAdminRoutes(app: Hono<{ Variables: { user: User } }>, d: { db: Db; clock: Clock; config: ServerConfig }, svc: AiService) {
  const { db, clock } = d;
  const limits = d.config.aiLimits ?? DEFAULT_AI_LIMITS;
  const roleIn = async (ws: string, userId: string) => (await db.first<{ role: Role }>(`SELECT role FROM members WHERE workspace_id = ? AND user_id = ?`, [ws, userId]))?.role ?? null;
  const noWs = { error: "That workspace doesn't exist or you aren't in it." };
  const notAllowed = { error: "Only people who manage AI credits for this workspace can do that." };
  const positive = (v: unknown, max = 1000) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : null);

  // A person asks for more AI this month. Anyone who uses AI here can ask (workspace members, and
  // people invited to one of its plans, since their AI use is charged here).
  app.post("/api/workspaces/:ws/ai/requests", async (c) => {
    const user = c.get("user");
    const ws = c.req.param("ws");
    const member = await roleIn(ws, user.id);
    const guest = member ? null : await db.first(`SELECT 1 AS x FROM plan_members pm JOIN plans p ON p.id = pm.plan_id WHERE pm.user_id = ? AND p.workspace_id = ? LIMIT 1`, [user.id, ws]);
    if (!member && !guest) return c.json(noWs, 404);
    const b = await c.req.json<{ checks?: unknown; reports?: unknown; note?: unknown }>().catch(() => null);
    const checks = positive(b?.checks ?? 0, 500);
    const reports = positive(b?.reports ?? 0, 500);
    if (checks === null || reports === null || checks + reports === 0) return c.json({ error: "Ask for 1 to 500 AI checks or reports." }, 400);
    const note = typeof b?.note === "string" ? b.note.trim().slice(0, 500) : null;
    if (await db.first(`SELECT 1 AS x FROM ai_credit_requests WHERE workspace_id = ? AND user_id = ? AND status = 'pending'`, [ws, user.id])) return c.json({ error: "You already have a request waiting. You'll be told when it's answered." }, 409);
    const id = crypto.randomUUID();
    await db.run(`INSERT INTO ai_credit_requests (id, workspace_id, user_id, checks, reports, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`, [id, ws, user.id, checks, reports, note, clock.now()]);
    return c.json({ id }, 201);
  });

  // Requests: credit managers see everyone's; everyone else sees only their own.
  app.get("/api/workspaces/:ws/ai/requests", async (c) => {
    const user = c.get("user");
    const ws = c.req.param("ws");
    const role = await roleIn(ws, user.id);
    const mine = !canManageAiCredits(role);
    const rows = await db.all<{ id: string; user_id: string; name: string; checks: number; reports: number; note: string | null; status: string; decider: string | null; created_at: number; decided_at: number | null }>(
      `SELECT r.id, r.user_id, u.name, r.checks, r.reports, r.note, r.status, d.name AS decider, r.created_at, r.decided_at FROM ai_credit_requests r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.decided_by
       WHERE r.workspace_id = ?${mine ? " AND r.user_id = ?" : ""} ORDER BY (r.status = 'pending') DESC, r.created_at DESC, r.rowid DESC LIMIT 100`,
      mine ? [ws, user.id] : [ws],
    );
    const approvers = (await db.all<{ name: string; role: Role }>(`SELECT u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?`, [ws])).filter((m) => canManageAiCredits(m.role)).map((m) => m.name);
    return c.json({ canManage: !mine, approvers, requests: rows.map((r) => ({ id: r.id, userId: r.user_id, name: r.name, checks: Number(r.checks), reports: Number(r.reports), note: r.note, status: r.status, decidedBy: r.decider, createdAt: Number(r.created_at), decidedAt: r.decided_at === null ? null : Number(r.decided_at) })) });
  });

  // Approve (taken from the pool) or decline. Credit managers only.
  app.post("/api/workspaces/:ws/ai/requests/:rid", async (c) => {
    const user = c.get("user");
    const ws = c.req.param("ws");
    if (!canManageAiCredits(await roleIn(ws, user.id))) return c.json(notAllowed, 403);
    const r = await db.first<{ user_id: string; checks: number; reports: number; status: string }>(`SELECT user_id, checks, reports, status FROM ai_credit_requests WHERE id = ? AND workspace_id = ?`, [c.req.param("rid"), ws]);
    if (!r) return c.json({ error: "That request doesn't exist." }, 404);
    if (r.status !== "pending") return c.json({ error: "That request was already answered." }, 409);
    const b = await c.req.json<{ decision?: unknown; checks?: unknown; reports?: unknown }>().catch(() => null);
    if (b?.decision === "decline") {
      await db.run(`UPDATE ai_credit_requests SET status = 'declined', decided_by = ?, decided_at = ? WHERE id = ?`, [user.id, clock.now(), c.req.param("rid")]);
      return c.json({ ok: true });
    }
    if (b?.decision !== "approve") return c.json({ error: "Choose approve or decline." }, 400);
    const checks = positive(b.checks ?? r.checks, 500);
    const reports = positive(b.reports ?? r.reports, 500);
    if (checks === null || reports === null) return c.json({ error: "Give 0 to 500 AI checks and reports." }, 400);
    const pool = await svc.pool(ws);
    if (checks > pool.total.checks - pool.used.checks || reports > pool.total.reports - pool.used.reports) return c.json({ error: "There isn't enough left in this month's pool. Add credits to the pool first." }, 409);
    await db.batch([
      { sql: `INSERT INTO ai_credit_grants (id, workspace_id, user_id, month, checks, reports, granted_by, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, params: [crypto.randomUUID(), ws, r.user_id, monthOf(clock.now()), checks, reports, user.id, "request approved", clock.now()] },
      { sql: `UPDATE ai_credit_requests SET status = 'approved', checks = ?, reports = ?, decided_by = ?, decided_at = ? WHERE id = ?`, params: [checks, reports, user.id, clock.now(), c.req.param("rid")] },
    ]);
    return c.json({ ok: true });
  });

  // The workspace overview for credit managers: pool, allowances, people and their use.
  app.get("/api/workspaces/:ws/ai/admin", async (c) => {
    const user = c.get("user");
    const ws = c.req.param("ws");
    if (!canManageAiCredits(await roleIn(ws, user.id))) return c.json(notAllowed, 403);
    const pool = await svc.pool(ws);
    const allowances = await db.all<{ user_id: string; monthly_checks: number; monthly_reports: number }>(`SELECT user_id, monthly_checks, monthly_reports FROM ai_allowances WHERE workspace_id = ?`, [ws]);
    const def = allowances.find((a) => a.user_id === "*");
    const people = await db.all<{ id: string; name: string; email: string; department: string | null }>(`SELECT u.id, u.name, u.email, m.department FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name`, [ws]);
    return c.json({
      pool: { ...pool, left: { checks: pool.total.checks - pool.used.checks, reports: pool.total.reports - pool.used.reports }, max: limits.poolMax },
      defaultAllowance: { checks: Number(def?.monthly_checks ?? limits.checksPerPerson), reports: Number(def?.monthly_reports ?? limits.reportsPerPerson) },
      people: await Promise.all(people.map(async (p) => ({ userId: p.id, name: p.name, email: p.email, department: p.department, override: allowances.some((a) => a.user_id === p.id), ...(await svc.usage(ws, p.id)) }))),
    });
  });

  // Set the default allowance ('*') or one person's.
  app.put("/api/workspaces/:ws/ai/allowances/:userId", async (c) => {
    const user = c.get("user");
    const ws = c.req.param("ws");
    if (!canManageAiCredits(await roleIn(ws, user.id))) return c.json(notAllowed, 403);
    const b = await c.req.json<{ checks?: unknown; reports?: unknown }>().catch(() => null);
    const checks = positive(b?.checks, 10000);
    const reports = positive(b?.reports, 10000);
    if (checks === null || reports === null) return c.json({ error: "Use whole numbers from 0 to 10,000." }, 400);
    const target = c.req.param("userId");
    if (target !== "*" && !(await roleIn(ws, target))) return c.json({ error: "That person isn't in this workspace." }, 404);
    await db.run(
      `INSERT INTO ai_allowances (workspace_id, user_id, monthly_checks, monthly_reports, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, user_id) DO UPDATE SET monthly_checks = excluded.monthly_checks, monthly_reports = excluded.monthly_reports, set_by = excluded.set_by, set_at = excluded.set_at`,
      [ws, target, checks, reports, user.id, clock.now()],
    );
    return c.json({ ok: true });
  });

  // Add credits to this month's pool, up to the server's ceiling (until billing exists).
  app.post("/api/workspaces/:ws/ai/topup", async (c) => {
    const user = c.get("user");
    const ws = c.req.param("ws");
    if (!canManageAiCredits(await roleIn(ws, user.id))) return c.json(notAllowed, 403);
    const b = await c.req.json<{ checks?: unknown; reports?: unknown; reason?: unknown }>().catch(() => null);
    const checks = positive(b?.checks ?? 0, limits.poolMax);
    const reports = positive(b?.reports ?? 0, limits.poolMax);
    if (checks === null || reports === null || checks + reports === 0) return c.json({ error: "Add at least 1 AI check or report." }, 400);
    const pool = await svc.pool(ws);
    if (pool.total.checks + checks > limits.poolMax || pool.total.reports + reports > limits.poolMax) return c.json({ error: `A pool can hold up to ${limits.poolMax} checks and ${limits.poolMax} reports a month.` }, 400);
    await db.run(`INSERT INTO ai_credit_grants (id, workspace_id, user_id, month, checks, reports, granted_by, reason, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`, [crypto.randomUUID(), ws, monthOf(clock.now()), checks, reports, user.id, typeof b?.reason === "string" ? b.reason.slice(0, 300) : "top-up", clock.now()]);
    return c.json({ ok: true });
  });

  app.put("/api/workspaces/:ws/members/:userId/department", async (c) => {
    const user = c.get("user");
    const ws = c.req.param("ws");
    if (!canManageAiCredits(await roleIn(ws, user.id))) return c.json(notAllowed, 403);
    const b = await c.req.json<{ department?: unknown }>().catch(() => null);
    const dep = typeof b?.department === "string" ? b.department.trim().slice(0, 80) : "";
    const r = await db.run(`UPDATE members SET department = ? WHERE workspace_id = ? AND user_id = ?`, [dep || null, ws, c.req.param("userId")]);
    return r.changes ? c.json({ ok: true }) : c.json({ error: "That person isn't in this workspace." }, 404);
  });

  // ---------------------------------------------------------------- spending

  interface Row { user_id: string; plan_id: string | null; feature: string; model: string; input_tokens: number; output_tokens: number; cost_usd: number; status: string; created_at: number }

  /** Usage rows for a period (and the same length of time just before, for comparison). */
  async function period(ws: string, q: { from?: string; to?: string }) {
    const today = clock.today();
    const to = q.to && ISO.test(q.to) ? q.to : today;
    const from = q.from && ISO.test(q.from) ? q.from : `${today.slice(0, 8)}01`;
    const start = dayStart(from);
    const end = dayStart(to) + 86_400_000;
    const span = end - start;
    const rows = await db.all<Row>(`SELECT user_id, plan_id, feature, model, input_tokens, output_tokens, cost_usd, status, created_at FROM ai_usage WHERE workspace_id = ? AND created_at >= ? AND created_at < ?`, [ws, start - span, end]);
    const cur = rows.filter((r) => Number(r.created_at) >= start);
    const prev = rows.filter((r) => Number(r.created_at) < start);
    return { from, to, start, end, span, cur, prev };
  }

  const sum = (rs: Row[]) => ({
    cost: rs.reduce((n, r) => n + Number(r.cost_usd), 0),
    inputTokens: rs.reduce((n, r) => n + Number(r.input_tokens), 0),
    outputTokens: rs.reduce((n, r) => n + Number(r.output_tokens), 0),
    checks: rs.filter((r) => r.feature === "check" && r.status === "ok").length,
    reports: rs.filter((r) => r.feature === "report" && r.status === "ok").length,
    screenings: rs.filter((r) => r.feature === "moderation").length,
    declined: rs.filter((r) => r.status === "refused").length,
    runs: rs.length,
  });

  async function breakdown(ws: string, q: { from?: string; to?: string }) {
    const p = await period(ws, q);
    const users = await db.all<{ id: string; name: string; department: string | null; member: number }>(
      `SELECT u.id, u.name, m.department, CASE WHEN m.user_id IS NULL THEN 0 ELSE 1 END AS member FROM users u LEFT JOIN members m ON m.user_id = u.id AND m.workspace_id = ?
       WHERE m.user_id IS NOT NULL OR u.id IN (SELECT DISTINCT user_id FROM ai_usage WHERE workspace_id = ?)`,
      [ws, ws],
    );
    const plans = await db.all<{ id: string; title: string }>(`SELECT id, title FROM plans WHERE workspace_id = ?`, [ws]);
    const deptOf = (uid: string) => {
      const u = users.find((x) => x.id === uid);
      return u ? (u.member ? u.department || "No department" : "Invited to a plan") : "Unknown";
    };
    const people = users.map((u) => {
      const mine = p.cur.filter((r) => r.user_id === u.id);
      return { key: u.id, name: u.name, department: deptOf(u.id), ...sum(mine), previous: sum(p.prev.filter((r) => r.user_id === u.id)).cost, projects: [...new Set(mine.map((r) => r.plan_id).filter(Boolean))].length };
    });
    // Screening a pasted plan before it's saved isn't tied to a project yet: its own row, so totals add up.
    if (p.cur.some((r) => !r.plan_id) || p.prev.some((r) => !r.plan_id)) plans.push({ id: NO_PROJECT, title: "Screening new plans (no project yet)" });
    const projects = plans.map((pl) => {
      const of = (r: Row) => (r.plan_id ?? NO_PROJECT) === pl.id;
      const rs = p.cur.filter(of);
      return { key: pl.id, name: pl.title, ...sum(rs), previous: sum(p.prev.filter(of)).cost, people: new Set(rs.map((r) => r.user_id)).size };
    });
    const deptNames = [...new Set(people.map((x) => x.department))];
    const departments = deptNames.map((dn) => {
      const ids = new Set(people.filter((x) => x.department === dn).map((x) => x.key));
      const rs = p.cur.filter((r) => ids.has(r.user_id));
      return { key: dn, name: dn, ...sum(rs), previous: sum(p.prev.filter((r) => ids.has(r.user_id))).cost, people: ids.size, active: new Set(rs.map((r) => r.user_id)).size };
    });
    const byCost = <T extends { cost: number }>(xs: T[]) => xs.sort((a, b) => b.cost - a.cost);
    return { p, people: byCost(people), projects: byCost(projects), departments: byCost(departments), deptOf };
  }

  const daily = (rs: Row[], start: number, days: number) => Array.from({ length: days }, (_, i) => rs.filter((r) => Number(r.created_at) >= start + i * 86_400_000 && Number(r.created_at) < start + (i + 1) * 86_400_000).reduce((n, r) => n + Number(r.cost_usd), 0));

  app.get("/api/workspaces/:ws/ai/spending", async (c) => {
    const user = c.get("user");
    const ws = c.req.param("ws");
    if (!canViewAiSpending(await roleIn(ws, user.id))) return c.json({ error: "Only people allowed to see AI spending for this workspace can open this." }, 403);
    const b = await breakdown(ws, { from: c.req.query("from"), to: c.req.query("to") });
    const days = Math.round(b.p.span / 86_400_000);
    const pool = await svc.pool(ws);
    return c.json({
      from: b.p.from,
      to: b.p.to,
      totals: sum(b.p.cur),
      previousTotals: sum(b.p.prev),
      daily: daily(b.p.cur, b.p.start, days),
      previousDaily: daily(b.p.prev, b.p.start - b.p.span, days),
      pool: { total: pool.total, used: pool.used },
      people: b.people,
      projects: b.projects,
      departments: b.departments,
      idle: { people: b.people.filter((x) => x.runs === 0).map((x) => x.name), projects: b.projects.filter((x) => x.runs === 0).map((x) => x.name), departments: b.departments.filter((x) => x.runs === 0).map((x) => x.name) },
    });
  });

  // One person, project or department: cost over time, by feature and model, and what it's linked to.
  app.get("/api/workspaces/:ws/ai/spending/:type/:key", async (c) => {
    const user = c.get("user");
    const ws = c.req.param("ws");
    if (!canViewAiSpending(await roleIn(ws, user.id))) return c.json({ error: "Only people allowed to see AI spending for this workspace can open this." }, 403);
    const type = c.req.param("type");
    const key = decodeURIComponent(c.req.param("key"));
    const b = await breakdown(ws, { from: c.req.query("from"), to: c.req.query("to") });
    const pick = (r: Row) => (type === "person" ? r.user_id === key : type === "project" ? (r.plan_id ?? NO_PROJECT) === key : type === "department" ? b.deptOf(r.user_id) === key : false);
    const item = (type === "person" ? b.people : type === "project" ? b.projects : type === "department" ? b.departments : []).find((x) => x.key === key);
    if (!item) return c.json({ error: "Not found." }, 404);
    const rs = b.p.cur.filter(pick);
    const group = (f: (r: Row) => string) => Object.entries(rs.reduce<Record<string, Row[]>>((m, r) => ((m[f(r)] ??= []).push(r), m), {})).map(([k, v]) => ({ key: k, ...sum(v) })).sort((x, y) => y.cost - x.cost);
    const related =
      type === "person"
        ? [...b.projects.filter((pr) => rs.some((r) => r.plan_id === pr.key)).map((pr) => ({ type: "project", key: pr.key, name: pr.name })), { type: "department", key: b.deptOf(key), name: b.deptOf(key) }]
        : type === "project"
          ? b.people.filter((pe) => rs.some((r) => r.user_id === pe.key)).map((pe) => ({ type: "person", key: pe.key, name: pe.name }))
          : [...b.people.filter((pe) => pe.department === key).map((pe) => ({ type: "person", key: pe.key, name: pe.name })), ...b.projects.filter((pr) => rs.some((r) => r.plan_id === pr.key)).map((pr) => ({ type: "project", key: pr.key, name: pr.name }))];
    return c.json({ type, item, byFeature: group((r) => r.feature), byModel: group((r) => r.model), daily: daily(rs, b.p.start, Math.round(b.p.span / 86_400_000)), related });
  });

  app.get("/api/workspaces/:ws/ai/spending.csv", async (c) => {
    const user = c.get("user");
    const ws = c.req.param("ws");
    if (!canViewAiSpending(await roleIn(ws, user.id))) return c.json({ error: "Only people allowed to see AI spending for this workspace can open this." }, 403);
    const view = c.req.query("view") ?? "people";
    const b = await breakdown(ws, { from: c.req.query("from"), to: c.req.query("to") });
    const list = view === "projects" ? b.projects : view === "departments" ? b.departments : b.people;
    const head = ["name", "cost_usd", "input_tokens", "output_tokens", "checks", "reports", "screenings", "declined", "previous_period_cost_usd"];
    const lines = [head.join(","), ...list.map((x) => [x.name, x.cost.toFixed(4), x.inputTokens, x.outputTokens, x.checks, x.reports, x.screenings, x.declined, x.previous.toFixed(4)].map(csvCell).join(","))];
    return c.body(lines.join("\n") + "\n", 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ai-spending-${view}-${b.p.from}-to-${b.p.to}.csv"` });
  });
}
