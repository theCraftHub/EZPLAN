/**
 * Master plans (step K2): a master plan holds sub-plans in the same workspace, each with a short key
 * (used in links: "reception/T4"), a lead department and departments it needs; the master keeps a
 * contact per department. Everyone who can open the master can open every plan in it (they share
 * the workspace). Someone added to one sub-plan only sees that plan, and the rest of the master in
 * outline (maskedMaster), which is enough for its dates to match the whole master's.
 */
import type { Hono } from "hono";
import { freeModeration, findMentions, localSchedule, maskedMaster, masterSchedule, MASTER_KEY, planKey, type LeveledSchedule, type MasterPart, type PersonAvailability, type Plan, type WorkWeek } from "@rakuplan/shared";
import type { Clock, Db, User } from "./ports";
import { canEdit, type Role } from "./roles";
import { loadRoom, newRoomJson } from "./room";
import { recordActivity } from "./activity";
import { notify } from "./notify";

type PlanRow = { id: string; title: string; workspace_id: string; master_id: string | null; plan_key: string | null; kind: string; lead_dept: string | null; needs_depts: string };
export interface MasterDeps {
  db: Db;
  clock: Clock;
  access: (planId: string, userId: string) => Promise<{ role: Role; workspace_id: string; work_week: string } | null>;
  notFound: { error: string };
  workWeekOf: (wsId: string) => Promise<WorkWeek>;
}

const planRow = (db: Db, id: string) => db.first<PlanRow>(`SELECT id, title, workspace_id, master_id, plan_key, kind, lead_dept, needs_depts FROM plans WHERE id = ?`, [id]);
const peopleOf = async (db: Db, planId: string): Promise<Record<string, PersonAvailability>> =>
  Object.fromEntries((await db.all<{ name: string; availability: string }>(`SELECT name, availability FROM plan_people WHERE plan_id = ?`, [planId])).map((r) => [r.name, JSON.parse(r.availability) as PersonAvailability]));

/** The master and its plans as parts for the engine, with everyone's availability merged by name. */
export async function loadMaster(db: Db, masterId: string): Promise<{ master: PlanRow; subs: PlanRow[]; parts: MasterPart[]; people: Record<string, PersonAvailability> } | null> {
  const master = await planRow(db, masterId);
  if (!master || master.kind !== "master") return null;
  const subs = await db.all<PlanRow>(`SELECT id, title, workspace_id, master_id, plan_key, kind, lead_dept, needs_depts FROM plans WHERE master_id = ? ORDER BY plan_key`, [masterId]);
  const parts: MasterPart[] = [];
  const people: Record<string, PersonAvailability> = {};
  for (const row of [master, ...subs]) {
    const room = await loadRoom(db, row.id);
    if (!room) continue;
    parts.push({ key: row.id === masterId ? MASTER_KEY : row.plan_key!, title: row.id === masterId ? "Whole building" : room.plan.title, plan: room.plan });
    for (const [name, a] of Object.entries(await peopleOf(db, row.id))) if (!Object.keys(people).some((n) => n.toLowerCase() === name.toLowerCase())) people[name] = a;
  }
  return { master, subs, parts, people };
}

/**
 * A plan's schedule: its own, or for a plan inside a master, its part of the master's schedule
 * (so a slip elsewhere and shared people count). Used by every page that shows dates.
 */
export async function scheduleOf(db: Db, planId: string, plan: Plan, opts: { workWeek: WorkWeek; today: string; people: Record<string, PersonAvailability> }, level: (p: Plan, o: typeof opts) => LeveledSchedule): Promise<LeveledSchedule> {
  const row = await planRow(db, planId);
  const masterId = row?.kind === "master" ? row.id : row?.master_id;
  if (!masterId) return level(plan, opts);
  const m = await loadMaster(db, masterId);
  if (!m) return level(plan, opts);
  const key = row!.kind === "master" ? MASTER_KEY : row!.plan_key!;
  const parts = m.parts.map((p) => (p.key === key ? { ...p, plan } : p));
  return localSchedule(masterSchedule(parts, { workWeek: opts.workWeek, today: opts.today, people: { ...m.people, ...opts.people } }), parts, key);
}

/** What a plan's page needs about its master: who it belongs to, and the master in outline. */
export async function masterContext(db: Db, planId: string, userId: string, access: MasterDeps["access"]) {
  const row = await planRow(db, planId);
  if (!row) return null;
  if (row.kind === "master") {
    const m = await loadMaster(db, row.id);
    return { id: row.id, isMaster: true, key: MASTER_KEY, title: row.title, plans: m ? m.subs.length : 0, canOpenMaster: true, view: m ? { parts: m.parts, people: m.people } : null };
  }
  if (!row.master_id) return null;
  const m = await loadMaster(db, row.master_id);
  if (!m) return null;
  const view = maskedMaster(m.parts, row.plan_key!, m.people);
  return { id: m.master.id, isMaster: false, key: row.plan_key!, title: m.master.title, plans: m.subs.length, canOpenMaster: !!(await access(m.master.id, userId)), lead: row.lead_dept, needs: JSON.parse(row.needs_depts) as string[], view };
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function registerMasterRoutes(app: Hono<{ Variables: { user: User } }>, d: MasterDeps) {
  const { db, clock } = d;

  /** Plans the person may put in a master: in that workspace, theirs to edit, not already in one. */
  const groupable = async (planId: string, user: User, wsId: string) => {
    const a = await d.access(planId, user.id);
    const row = await planRow(db, planId);
    if (!a || !row || row.workspace_id !== wsId) return { error: "Only plans in the same workspace can go in a master plan." };
    if (!canEdit(a.role)) return { error: `You can't change "${row.title}".` };
    if (row.kind === "master") return { error: `"${row.title}" is a master plan already.` };
    if (row.master_id) return { error: `"${row.title}" is already in a master plan.` };
    return { row };
  };

  // New master plan, grouping existing plans ("group these plans"). The master gets its own plan for
  // whole-building tasks (permits, move-in), which start empty.
  app.post("/api/masters", async (c) => {
    const user = c.get("user");
    const b = await c.req.json<{ title?: unknown; planIds?: unknown; start?: unknown }>().catch(() => null);
    const title = clean(b?.title, 120);
    const ids = Array.isArray(b?.planIds) ? [...new Set(b!.planIds.filter((x): x is string => typeof x === "string"))].slice(0, 50) : [];
    if (!title) return c.json({ error: "Name the master plan." }, 400);
    if (ids.length < 1) return c.json({ error: "Choose at least one plan to put in it." }, 400);
    const first = await d.access(ids[0]!, user.id);
    if (!first) return c.json(d.notFound, 404);
    const rows: PlanRow[] = [];
    for (const id of ids) {
      const g = await groupable(id, user, first.workspace_id);
      if ("error" in g) return c.json({ error: g.error }, 400);
      rows.push(g.row);
    }
    const start = typeof b?.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.start) ? b.start : clock.today();
    const id = crypto.randomUUID();
    const now = clock.now();
    const plan: Plan = { version: 1, id, title, start, team: [], phases: [{ id: "P1", title: "Whole building", tasks: [] }], extra: {} } as unknown as Plan;
    await db.batch([
      { sql: `INSERT INTO plans (id, workspace_id, title, state, room, version, created_by, created_at, updated_at, kind) VALUES (?, ?, ?, 'active', ?, 0, ?, ?, ?, 'master')`, params: [id, first.workspace_id, title, newRoomJson(plan), user.id, now, now] },
      { sql: `INSERT INTO plan_versions (plan_id, version, reason, snapshot, created_by, created_at) VALUES (?, 0, 'import', ?, ?, ?)`, params: [id, JSON.stringify(plan), user.id, now] },
    ]);
    const taken: string[] = [MASTER_KEY];
    for (const r of rows) {
      const key = planKey(r.title, taken);
      taken.push(key);
      await db.run(`UPDATE plans SET master_id = ?, plan_key = ? WHERE id = ?`, [id, key, r.id]);
    }
    await recordActivity(db, id, user, { kind: "plan", summary: `${user.name} made the master plan with ${rows.length === 1 ? "1 plan" : `${rows.length} plans`}` }, now);
    return c.json({ id, keys: Object.fromEntries(rows.map((r, i) => [r.id, taken[i + 1]])) }, 201);
  });

  const masterFor = async (c: { req: { param: (k: string) => string } }, user: User, write: boolean) => {
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    const row = await planRow(db, id);
    if (!a || !row || row.kind !== "master") return null;
    if (write && !canEdit(a.role)) return "readonly" as const;
    return { a, row };
  };

  app.post("/api/masters/:id/plans", async (c) => {
    const user = c.get("user");
    const m = await masterFor(c, user, true);
    if (!m) return c.json(d.notFound, 404);
    if (m === "readonly") return c.json({ error: "You can view this master plan but not change it." }, 403);
    const b = await c.req.json<{ planId?: unknown }>().catch(() => null);
    const g = await groupable(typeof b?.planId === "string" ? b.planId : "", user, m.row.workspace_id);
    if ("error" in g) return c.json({ error: g.error }, 400);
    const taken = [MASTER_KEY, ...(await db.all<{ plan_key: string }>(`SELECT plan_key FROM plans WHERE master_id = ?`, [m.row.id])).map((r) => r.plan_key)];
    const key = planKey(g.row.title, taken);
    await db.run(`UPDATE plans SET master_id = ?, plan_key = ? WHERE id = ?`, [m.row.id, key, g.row.id]);
    await recordActivity(db, m.row.id, user, { kind: "plan", summary: `${user.name} added ${g.row.title} to the master plan` }, clock.now());
    return c.json({ key }, 201);
  });

  // Taking a plan out: links to it from other plans stop counting (they're kept in the text).
  app.delete("/api/masters/:id/plans/:planId", async (c) => {
    const user = c.get("user");
    const m = await masterFor(c, user, true);
    if (!m) return c.json(d.notFound, 404);
    if (m === "readonly") return c.json({ error: "You can view this master plan but not change it." }, 403);
    const row = await planRow(db, c.req.param("planId"));
    if (!row || row.master_id !== m.row.id) return c.json({ error: "That plan isn't in this master plan." }, 404);
    await db.run(`UPDATE plans SET master_id = NULL, plan_key = NULL WHERE id = ?`, [row.id]);
    await recordActivity(db, m.row.id, user, { kind: "plan", summary: `${user.name} took ${row.title} out of the master plan` }, clock.now());
    return c.json({ ok: true });
  });

  // A plan's departments: who leads it and whose input it needs.
  app.put("/api/masters/:id/plans/:planId/departments", async (c) => {
    const user = c.get("user");
    const m = await masterFor(c, user, true);
    if (!m) return c.json(d.notFound, 404);
    if (m === "readonly") return c.json({ error: "You can view this master plan but not change it." }, 403);
    const row = await planRow(db, c.req.param("planId"));
    if (!row || row.master_id !== m.row.id) return c.json({ error: "That plan isn't in this master plan." }, 404);
    const b = await c.req.json<{ lead?: unknown; needs?: unknown }>().catch(() => null);
    const lead = clean(b?.lead, 60) || null;
    const needs = (Array.isArray(b?.needs) ? b!.needs : []).map((x) => clean(x, 60)).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i && x !== lead).slice(0, 12);
    await db.run(`UPDATE plans SET lead_dept = ?, needs_depts = ? WHERE id = ?`, [lead, JSON.stringify(needs), row.id]);
    return c.json({ ok: true });
  });

  // Each department's contact for the whole master.
  app.put("/api/masters/:id/departments/:name", async (c) => {
    const user = c.get("user");
    const m = await masterFor(c, user, true);
    if (!m) return c.json(d.notFound, 404);
    if (m === "readonly") return c.json({ error: "You can view this master plan but not change it." }, 403);
    const name = clean(decodeURIComponent(c.req.param("name")), 60);
    const b = await c.req.json<{ contact?: unknown; role?: unknown }>().catch(() => null);
    if (!name) return c.json({ error: "Name the department." }, 400);
    await db.run(
      `INSERT INTO master_departments (master_id, name, contact, role) VALUES (?, ?, ?, ?) ON CONFLICT (master_id, name) DO UPDATE SET contact = excluded.contact, role = excluded.role`,
      [m.row.id, name, clean(b?.contact, 80) || null, clean(b?.role, 80) || null],
    );
    return c.json({ ok: true });
  });

  // Everything the master's pages need; the app schedules it (and what-ifs) with the same engine.
  app.get("/api/masters/:id", async (c) => {
    const user = c.get("user");
    const m = await masterFor(c, user, false);
    if (!m || m === "readonly") return c.json(d.notFound, 404);
    const data = await loadMaster(db, m.row.id);
    if (!data) return c.json(d.notFound, 404);
    const depts = await db.all<{ name: string; contact: string | null; role: string | null }>(`SELECT name, contact, role FROM master_departments WHERE master_id = ? ORDER BY name`, [m.row.id]);
    return c.json({
      id: m.row.id,
      title: data.master.title,
      canEdit: canEdit(m.a.role),
      today: clock.today(),
      workWeek: await d.workWeekOf(m.row.workspace_id),
      people: data.people,
      parts: data.parts.map((p) => {
        const row = p.key === MASTER_KEY ? data.master : data.subs.find((s) => s.plan_key === p.key)!;
        return { key: p.key, planId: row.id, title: p.title, plan: p.plan, lead: row.lead_dept, needs: JSON.parse(row.needs_depts) as string[] };
      }),
      departments: depts,
    });
  });

  // Activity across every plan in the master, newest first.
  app.get("/api/masters/:id/activity", async (c) => {
    const user = c.get("user");
    const m = await masterFor(c, user, false);
    if (!m || m === "readonly") return c.json(d.notFound, 404);
    const rows = await db.all<{ id: string; plan_id: string; actor_name: string; kind: string; task_id: string | null; summary: string; created_at: number; title: string; plan_key: string | null }>(
      `SELECT a.id, a.plan_id, a.actor_name, a.kind, a.task_id, a.summary, a.created_at, p.title, p.plan_key FROM activity a JOIN plans p ON p.id = a.plan_id WHERE p.id = ? OR p.master_id = ? ORDER BY a.created_at DESC, a.rowid DESC LIMIT 200`,
      [m.row.id, m.row.id],
    );
    return c.json({ items: rows.map((r) => ({ id: r.id, planId: r.plan_id, key: r.plan_id === m.row.id ? MASTER_KEY : r.plan_key, plan: r.plan_id === m.row.id ? "Whole building" : r.title, actor: r.actor_name, kind: r.kind, taskId: r.task_id, summary: r.summary, at: Number(r.created_at) })) });
  });

  // ---------------------------------------------------------------- Discussion

  /**
   * Threads: one per plan plus "Whole building" (scope = the master's ID). People who can open the
   * master read every thread; someone on one plan only reads that plan's thread and Whole building.
   */
  const threadAccess = async (masterId: string, scope: string, user: User) => {
    const master = await planRow(db, masterId);
    if (!master || master.kind !== "master") return null;
    const onMaster = await d.access(masterId, user.id);
    if (scope === masterId) {
      if (onMaster) return { master, canPost: true };
      const mine = await db.all<{ id: string }>(`SELECT id FROM plans WHERE master_id = ?`, [masterId]);
      for (const p of mine) if (await d.access(p.id, user.id)) return { master, canPost: true };
      return null;
    }
    const plan = await planRow(db, scope);
    if (!plan || plan.master_id !== masterId) return null;
    const a = onMaster ?? (await d.access(scope, user.id));
    return a ? { master, canPost: true } : null;
  };

  app.get("/api/masters/:id/threads", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const scopes = [id, ...(await db.all<{ id: string }>(`SELECT id FROM plans WHERE master_id = ? ORDER BY plan_key`, [id])).map((r) => r.id)];
    const out = [];
    for (const scope of scopes) {
      if (!(await threadAccess(id, scope, user))) continue;
      const last = await db.first<{ author: string; body: string; created_at: number }>(`SELECT u.name AS author, t.body, t.created_at FROM master_messages t JOIN users u ON u.id = t.author_id WHERE t.master_id = ? AND t.scope = ? ORDER BY t.created_at DESC, t.rowid DESC LIMIT 1`, [id, scope]);
      const n = Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM master_messages WHERE master_id = ? AND scope = ?`, [id, scope]))?.n ?? 0);
      const title = scope === id ? "Whole building" : (await planRow(db, scope))!.title;
      out.push({ scope, title, count: n, last: last ? { author: last.author, body: last.body.slice(0, 140), at: Number(last.created_at) } : null });
    }
    if (out.length === 0) return c.json(d.notFound, 404);
    return c.json({ threads: out });
  });

  app.get("/api/masters/:id/threads/:scope", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const scope = c.req.param("scope");
    if (!(await threadAccess(id, scope, user))) return c.json(d.notFound, 404);
    const rows = await db.all<{ id: string; author: string; body: string; about: string | null; created_at: number }>(`SELECT t.id, u.name AS author, t.body, t.about, t.created_at FROM master_messages t JOIN users u ON u.id = t.author_id WHERE t.master_id = ? AND t.scope = ? ORDER BY t.created_at, t.rowid`, [id, scope]);
    return c.json({ messages: rows.map((r) => ({ id: r.id, author: r.author, body: r.body, about: r.about, at: Number(r.created_at) })), people: await threadPeople(id, scope) });
  });

  /** Who can be @mentioned in a thread: people with accounts on the plans it covers. */
  async function threadPeople(masterId: string, scope: string) {
    const plans = scope === masterId ? [masterId, ...(await db.all<{ id: string }>(`SELECT id FROM plans WHERE master_id = ?`, [masterId])).map((r) => r.id)] : [scope];
    const rows = await db.all<{ id: string; name: string }>(
      `SELECT DISTINCT u.id, u.name FROM plans p JOIN members m ON m.workspace_id = p.workspace_id JOIN users u ON u.id = m.user_id WHERE p.id IN (${plans.map(() => "?").join(",")})
       UNION SELECT DISTINCT u.id, u.name FROM plan_members pm JOIN users u ON u.id = pm.user_id WHERE pm.plan_id IN (${plans.map(() => "?").join(",")})`,
      [...plans, ...plans],
    );
    return rows;
  }

  app.post("/api/masters/:id/threads/:scope", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const scope = c.req.param("scope");
    const t = await threadAccess(id, scope, user);
    if (!t) return c.json(d.notFound, 404);
    const b = await c.req.json<{ body?: unknown; about?: unknown }>().catch(() => null);
    const body = typeof b?.body === "string" ? b.body.replace(/\r\n/g, "\n").trim().slice(0, 4000) : "";
    if (!body) return c.json({ error: "Write something first." }, 400);
    if (freeModeration(body).verdict !== "allow") return c.json({ error: "This message can't be posted because it may break the Acceptable Use Policy." }, 422);
    const about = typeof b?.about === "string" && /^([a-z0-9][a-z0-9-]{0,39}\/)?[TM]\d+$/.test(b.about) ? b.about : null;
    const now = clock.now();
    const msgId = crypto.randomUUID();
    await db.run(`INSERT INTO master_messages (id, master_id, scope, author_id, body, about, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [msgId, id, scope, user.id, body, about, now]);
    const title = scope === id ? "Whole building" : (await planRow(db, scope))!.title;
    await recordActivity(db, scope, user, { kind: "comment", summary: `${user.name} posted in the ${title} discussion` }, now);
    const people = await threadPeople(id, scope);
    for (const name of findMentions(body, people.map((p) => p.name))) {
      const p = people.find((x) => x.name === name);
      if (p) await notify(db, now, { userId: p.id, planId: scope, kind: "mention", text: `${user.name} mentioned you in the ${title} discussion (${t.master.title})`, link: `/m/${id}/discussion/${scope}` }, user.id);
    }
    return c.json({ id: msgId }, 201);
  });
}
