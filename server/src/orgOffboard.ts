/**
 * Offboarding and policies in the admin console (step L3b). Offboarding someone: preview, then in
 * one go deactivate them, sign them out everywhere and close their live plan connections, hand
 * their plans and open tasks to someone else, and turn off invites they sent. Plans whose maker is
 * no longer in the company are listed as orphaned, to be given a new owner. Changing the rules
 * shows who it affects first.
 */
import type { Hono } from "hono";
import { allTasks } from "@rakuplan/shared";
import type { Clock, Db, RoomHost, User } from "./ports";
import { endAllSessions } from "./sessions";
import { notify } from "./notify";
import { loadRoom } from "./room";
import { audit, can, orgOf, orgRole, RULE_PRESETS, rulesOf, syncAccess, type OrgRole, type RulePreset } from "./orgs";
import { planBulk } from "./orgPeople";

export interface OffboardDeps { db: Db; clock: Clock; rooms: RoomHost; notFound: { error: string } }

type PlanRow = { id: string; title: string; workspace_id: string; created_by: string };

/** Who can take work over: active people in the company who work in workspaces (not Guests, Helpdesk or Auditors). */
async function recipients(db: Db, orgId: string, except: string) {
  return db.all<{ id: string; name: string; email: string; role: OrgRole }>(
    `SELECT u.id, u.name, u.email, om.role FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = ? AND om.status = 'active' AND om.role IN ('owner', 'admin', 'dept_admin', 'member') AND om.user_id != ? ORDER BY lower(u.name)`,
    [orgId, except],
  );
}

const orgPlans = (db: Db, orgId: string) =>
  db.all<PlanRow>(`SELECT p.id, p.title, p.workspace_id, p.created_by FROM plans p JOIN workspaces w ON w.id = p.workspace_id WHERE w.org_id = ? AND p.state != 'archived' ORDER BY lower(p.title)`, [orgId]);

/**
 * The names a person goes by in a plan: their full name, any name linked to their account on that
 * plan (from an invite), and their first name when nobody else in the company shares it.
 */
async function namesOf(db: Db, orgId: string, planId: string, user: { id: string; name: string }): Promise<Set<string>> {
  const full = user.name.trim().toLowerCase();
  const keys = new Set([full]);
  for (const r of await db.all<{ name_key: string }>(`SELECT name_key FROM plan_people WHERE plan_id = ? AND user_id = ?`, [planId, user.id])) keys.add(r.name_key);
  const first = full.split(/\s+/)[0]!;
  const others = await db.all<{ name: string }>(`SELECT u.name FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = ? AND om.user_id != ?`, [orgId, user.id]);
  if (first && !others.some((o) => o.name.trim().toLowerCase().split(/\s+/)[0] === first)) keys.add(first);
  return keys;
}

/** Open tasks in each company plan that carry this person's name. */
async function openTasksOf(db: Db, orgId: string, plans: PlanRow[], person: { id: string; name: string }) {
  const out: { planId: string; title: string; taskIds: string[] }[] = [];
  for (const p of plans) {
    const room = await loadRoom(db, p.id);
    if (!room) continue;
    const keys = await namesOf(db, orgId, p.id, person);
    const ids = allTasks(room.plan).filter((t) => keys.has(t.owner?.trim().toLowerCase() ?? "") && t.status !== "done" && t.status !== "skipped").map((t) => t.id);
    if (ids.length) out.push({ planId: p.id, title: p.title, taskIds: ids });
  }
  return out;
}

/** How to write someone as a task owner in a plan: the name the plan already uses for them, else their full name. */
async function nameIn(db: Db, orgId: string, planId: string, person: { id: string; name: string }): Promise<string> {
  const room = await loadRoom(db, planId);
  const keys = await namesOf(db, orgId, planId, person);
  const used = room ? allTasks(room.plan).map((t) => t.owner?.trim()).find((o) => o && keys.has(o.toLowerCase())) : undefined;
  return used ?? person.name;
}

/** Gives someone access to a plan if they don't have it (as an editor). */
async function ensureAccess(db: Db, plan: PlanRow, userId: string, by: string, now: number) {
  const has = await db.first(`SELECT 1 AS x FROM members WHERE workspace_id = ? AND user_id = ? UNION SELECT 1 AS x FROM plan_members WHERE plan_id = ? AND user_id = ? AND (expires_at IS NULL OR expires_at > ?)`, [plan.workspace_id, userId, plan.id, userId, now]);
  if (!has) await db.run(`INSERT INTO plan_members (plan_id, user_id, role, added_by, added_at) VALUES (?, ?, 'editor', ?, ?) ON CONFLICT (plan_id, user_id) DO UPDATE SET role = 'editor', expires_at = NULL`, [plan.id, userId, by, now]);
}

export function registerOffboardRoutes(app: Hono<{ Variables: { user: User } }>, d: OffboardDeps) {
  const { db, clock, rooms } = d;
  const consoleFor = async (orgId: string, user: User) => {
    const org = await orgOf(db, orgId);
    const role = org ? await orgRole(db, orgId, user.id) : null;
    return org && role && can.console(role) ? { org, role } : null;
  };

  // Offboard one person: { dryRun } previews; { transferTo, planOwners? } does it.
  app.post("/api/orgs/:id/offboard/:userId", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.managePeople(x.role)) return c.json({ error: "Your role can't offboard people." }, 403);
    const targetId = c.req.param("userId");
    const target = await db.first<{ name: string; email: string; status: string }>(`SELECT u.name, u.email, om.status FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = ? AND om.user_id = ?`, [x.org.id, targetId]);
    if (!target) return c.json({ error: "That person isn't in this company." }, 404);
    const now = clock.now();
    // The same limits as a bulk deactivate (not yourself, Owners only by Owners, last Owner, department).
    if (target.status === "active") {
      const check = await planBulk(db, now, x.org.id, user, x.role, "deactivate", [targetId], undefined);
      if (check.skipped.length) return c.json({ error: check.skipped[0]!.reason }, 403);
    }
    const plans = await orgPlans(db, x.org.id);
    const owned = plans.filter((p) => p.created_by === targetId);
    const tasks = await openTasksOf(db, x.org.id, plans, { id: targetId, name: target.name });
    const planIds = plans.map((p) => p.id);
    const invites = planIds.length ? Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM invites WHERE created_by = ? AND accepted_by IS NULL AND revoked_at IS NULL AND expires_at > ? AND plan_id IN (${planIds.map(() => "?").join(",")})`, [targetId, now, ...planIds]))?.n ?? 0) : 0;
    const orgInvites = Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM org_invites WHERE org_id = ? AND created_by = ? AND accepted_by IS NULL AND revoked_at IS NULL AND expires_at > ?`, [x.org.id, targetId, now]))?.n ?? 0);
    const sessions = Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?`, [targetId, now]))?.n ?? 0);
    const people = await recipients(db, x.org.id, targetId);
    const b = await c.req.json<{ dryRun?: unknown; transferTo?: unknown; planOwners?: unknown }>().catch(() => null);
    const summary = {
      person: { id: targetId, name: target.name, email: target.email, status: target.status },
      sessions, invites: invites + orgInvites,
      plans: owned.map((p) => ({ id: p.id, title: p.title })),
      tasks: tasks.map((t) => ({ planId: t.planId, title: t.title, count: t.taskIds.length })),
      recipients: people.map((p) => ({ id: p.id, name: p.name })),
    };
    if (b?.dryRun === true) return c.json({ dryRun: true, ...summary });

    const to = people.find((p) => p.id === b?.transferTo);
    if ((owned.length || tasks.length) && !to) return c.json({ error: "Choose who takes over their work." }, 400);
    const perPlan = b?.planOwners && typeof b.planOwners === "object" ? (b.planOwners as Record<string, unknown>) : {};
    const ownerFor = (planId: string) => people.find((p) => p.id === perPlan[planId]) ?? to!;

    // 1. Access ends and every device is signed out; open plans close for them.
    await db.run(`UPDATE org_members SET status = 'deactivated', deactivated_at = COALESCE(deactivated_at, ?) WHERE org_id = ? AND user_id = ?`, [now, x.org.id, targetId]);
    await syncAccess(db, x.org.id, targetId);
    const ended = await endAllSessions(db, targetId);
    for (const p of plans) await rooms.kick(p.id, targetId);
    // 2. Their plans get a new owner, who can open them.
    const handed: Record<string, { plans: number; tasks: number }> = {};
    const tally = (id: string, k: "plans" | "tasks", n: number) => { handed[id] = { plans: 0, tasks: 0, ...handed[id] }; handed[id]![k] += n; };
    for (const p of owned) {
      const owner = ownerFor(p.id);
      await db.run(`UPDATE plans SET created_by = ? WHERE id = ?`, [owner.id, p.id]);
      await ensureAccess(db, p, owner.id, user.id, now);
      tally(owner.id, "plans", 1);
    }
    // 3. Their open tasks carry the new person's name (as live edits, so open screens update).
    for (const t of tasks) {
      const owner = ownerFor(t.planId);
      const written = await nameIn(db, x.org.id, t.planId, owner);
      for (const taskId of t.taskIds) {
        await rooms.apply(t.planId, { opId: `offboard-${crypto.randomUUID().slice(0, 12)}`, clientId: "offboard", op: { kind: "setField", taskId, field: "owner", value: written } }, { userId: user.id, name: user.name });
      }
      await ensureAccess(db, plans.find((p) => p.id === t.planId)!, owner.id, user.id, now);
      tally(owner.id, "tasks", t.taskIds.length);
    }
    // 4. Invites they sent stop working.
    if (planIds.length) await db.run(`UPDATE invites SET revoked_at = ? WHERE created_by = ? AND accepted_by IS NULL AND revoked_at IS NULL AND plan_id IN (${planIds.map(() => "?").join(",")})`, [now, targetId, ...planIds]);
    await db.run(`UPDATE org_invites SET revoked_at = ? WHERE org_id = ? AND created_by = ? AND accepted_by IS NULL AND revoked_at IS NULL`, [now, x.org.id, targetId]);
    if (planIds.length) await db.run(`UPDATE share_links SET revoked_at = ? WHERE created_by = ? AND revoked_at IS NULL AND plan_id IN (${planIds.map(() => "?").join(",")})`, [now, targetId, ...planIds]);
    for (const [id, n] of Object.entries(handed)) {
      const parts = [n.plans ? `${n.plans} ${n.plans === 1 ? "plan" : "plans"}` : "", n.tasks ? `${n.tasks} open ${n.tasks === 1 ? "task" : "tasks"}` : ""].filter(Boolean).join(" and ");
      await notify(db, now, { userId: id, kind: "assigned", text: `You now have ${parts} from ${target.name}`, link: "/" }, user.id);
    }
    await notify(db, now, { userId: targetId, kind: "company", text: `Your access to ${x.org.name}'s plans has ended`, link: "/" }, user.id);
    await audit(db, now, x.org.id, { id: user.id, name: user.name }, "person.offboarded", target.email, { signedOut: ended, plans: owned.length, tasks: tasks.reduce((n, t) => n + t.taskIds.length, 0), invites: summary.invites, to: Object.keys(handed).map((id) => people.find((p) => p.id === id)!.email) });
    return c.json({ done: true, ...summary, sessions: ended });
  });

  // Plans whose maker has left the company or been deactivated.
  app.get("/api/orgs/:id/orphans", async (c) => {
    const x = await consoleFor(c.req.param("id"), c.get("user"));
    if (!x) return c.json(d.notFound, 404);
    const rows = await db.all<{ id: string; title: string; workspace: string; maker: string | null }>(
      `SELECT p.id, p.title, w.name AS workspace, u.name AS maker FROM plans p JOIN workspaces w ON w.id = p.workspace_id LEFT JOIN users u ON u.id = p.created_by
       WHERE w.org_id = ? AND p.state != 'archived' AND NOT EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = w.org_id AND om.user_id = p.created_by AND om.status = 'active' AND om.role != 'guest')
       ORDER BY lower(p.title)`,
      [x.org.id],
    );
    return c.json({ plans: rows, recipients: (await recipients(db, x.org.id, "")).map((p) => ({ id: p.id, name: p.name })) });
  });

  app.post("/api/orgs/:id/plans/:planId/owner", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.managePeople(x.role)) return c.json({ error: "Your role can't change plan owners." }, 403);
    const plan = (await orgPlans(db, x.org.id)).find((p) => p.id === c.req.param("planId"));
    if (!plan) return c.json({ error: "That plan isn't in this company." }, 404);
    const b = await c.req.json<{ userId?: unknown }>().catch(() => null);
    const owner = (await recipients(db, x.org.id, "")).find((p) => p.id === b?.userId);
    if (!owner) return c.json({ error: "Choose someone in the company." }, 400);
    const now = clock.now();
    await db.run(`UPDATE plans SET created_by = ? WHERE id = ?`, [owner.id, plan.id]);
    await ensureAccess(db, plan, owner.id, user.id, now);
    await notify(db, now, { userId: owner.id, planId: plan.id, kind: "assigned", text: `You now own ${plan.title}`, link: `/p/${plan.id}` }, user.id);
    await audit(db, now, x.org.id, { id: user.id, name: user.name }, "plan.owner_changed", plan.title, { to: owner.email });
    return c.json({ ok: true });
  });

  // What changing the rules would mean, before saving: who can invite outsiders and download plan
  // files before and after, and how many outside guests have access now.
  app.get("/api/orgs/:id/settings/preview", async (c) => {
    const x = await consoleFor(c.req.param("id"), c.get("user"));
    if (!x) return c.json(d.notFound, 404);
    const preset = c.req.query("preset") ?? "";
    if (!(preset in RULE_PRESETS)) return c.json({ error: "Choose Standard, Strict or Open." }, 400);
    const roles = (await db.all<{ role: OrgRole }>(`SELECT role FROM org_members WHERE org_id = ? AND status = 'active'`, [x.org.id])).map((r) => r.role);
    const count = (ok: (r: OrgRole) => boolean) => roles.filter(ok).length;
    const inviters = (rule: string) => count((r) => (rule === "admins" ? r === "owner" || r === "admin" : rule === "managers" ? r === "owner" || r === "admin" || r === "dept_admin" : r === "owner" || r === "admin" || r === "dept_admin" || r === "member"));
    const exporters = (rule: string) => count((r) => (rule === "admins" ? r === "owner" || r === "admin" : r !== "helpdesk" && r !== "auditor"));
    const now = clock.now();
    const guests = Number((await db.first<{ n: number }>(
      `SELECT COUNT(DISTINCT pm.user_id) AS n FROM plan_members pm JOIN plans p ON p.id = pm.plan_id JOIN workspaces w ON w.id = p.workspace_id
       WHERE w.org_id = ? AND (pm.expires_at IS NULL OR pm.expires_at > ?) AND NOT EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = w.org_id AND om.user_id = pm.user_id AND om.status = 'active' AND om.role != 'guest')`,
      [x.org.id, now],
    ))?.n ?? 0);
    const before = rulesOf(x.org.settings);
    const after = { preset: preset as RulePreset, ...RULE_PRESETS[preset as RulePreset] };
    return c.json({
      before, after, guestsNow: guests,
      inviters: { before: inviters(before.outsideInvites), after: inviters(after.outsideInvites) },
      exporters: { before: exporters(before.exports), after: exporters(after.exports) },
    });
  });
}
