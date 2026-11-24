/**
 * The HTTP API, written once against the ports. Hono runs unchanged on Cloudflare Workers and Node.
 */
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  BRAND,
  checkPlan,
  DEFAULT_WORK_WEEK,
  exportPlan,
  hoursPerDay,
  importPlan,
  levelPlan,
  MAX_PLAN_PEOPLE,
  parseAvailability,
  planPeople,
  progressOf,
  type PersonAvailability,
  type Plan,
  parseOp,
  type Actor,
  type OpEnvelope,
  type WorkWeek,
} from "@ezplan/shared";
import { userFromTestHeader } from "./auth";
import { migrate } from "./migrations";
import { finishLogin, SignInError, startLogin, userForSignIn } from "./oidc";
import { loadRoom, newRoomJson } from "./room";
import { EMAIL_RE, INVITE_DAYS, inviteProblem, maskEmail, PLAN_ROLES, strongest, type InviteRow, type PlanRole } from "./invites";
import { createSession, endAllSessions, endSession, randomToken, sha256, SESSION_COOKIE, SESSION_DAYS, userForSession } from "./sessions";
import type { Ports, User } from "./ports";
import { aiService, registerAiRoutes } from "./ai/routes";
import { registerAiAdminRoutes } from "./ai/admin";
import { isPlatformAdmin, registerSafetyRoutes } from "./safety";

import { canEdit, type Role } from "./roles";
import { recordActivity } from "./activity";
import { registerStatusUpdateRoutes, updateState } from "./statusUpdates";
import { registerCollabRoutes } from "./comments";
import { notify, registerNotificationRoutes, unreadCount, userForName } from "./notify";
import { registerSupportRoutes, supportOpen } from "./support";
import { registerInboundEmail, registerSafetyCaseRoutes } from "./safetyCases";

const ROLE_WORD: Record<string, string> = { editor: "an Editor", commenter: "a Commenter", viewer: "a Viewer" };
const suspendedMessage = "This account is suspended after a safety review. Contact support if you think this is a mistake.";
type Vars = { Variables: { user: User } };

const MAX_BODY_CHARS = 1_000_000;

export function createApp(ports: Ports) {
  const { db, rooms, clock } = ports;
  // Migrations run once per process (self-hosted) or per isolate (cloud) before the first request.
  let ready: Promise<unknown> | null = null;
  const ensureReady = () => (ready ??= migrate(db, clock.now()).catch((e) => ((ready = null), Promise.reject(e))));

  const app = new Hono<Vars>();

  const { config } = ports;
  const siteOrigin = new URL(config.publicUrl).origin;

  app.get("/api/health", async (c) => {
    await ensureReady();
    return c.json({ ok: true });
  });

  /**
   * Changes must come from our own site (blocks cross-site request forgery): a different Origin is
   * refused; with no Origin, only JSON requests are accepted (a plain form on another site can't send JSON).
   */
  const sameSite = (c: Context) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return true;
    const origin = c.req.header("origin");
    if (origin) return origin === siteOrigin;
    return (c.req.header("content-type") ?? "").startsWith("application/json");
  };

  const setSessionCookie = (c: Context, token: string) =>
    setCookie(c, SESSION_COOKIE, token, { path: "/", httpOnly: true, secure: config.secureCookies, sameSite: "Lax", maxAge: SESSION_DAYS * 86_400 });

  // ---------------------------------------------------------------- sign-in

  app.get("/auth/providers", async (c) => c.json({ providers: config.providers.map((p) => ({ id: p.id, label: p.label })) }));

  app.get("/auth/login", async (c) => {
    await ensureReady();
    try {
      return c.redirect(await startLogin(db, ports.http, clock, config, c.req.query("provider") ?? "", c.req.query("returnTo")), 302);
    } catch (e) {
      if (e instanceof SignInError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  app.get("/auth/callback", async (c) => {
    await ensureReady();
    try {
      const signedIn = await finishLogin(db, ports.http, clock, config, new URL(c.req.url).searchParams);
      const user = await userForSignIn(db, clock, signedIn);
      if (await db.first(`SELECT 1 AS x FROM users WHERE id = ? AND suspended_at IS NOT NULL`, [user.id])) return c.json({ error: suspendedMessage }, 403);
      await ensureWorkspace(user);
      setSessionCookie(c, await createSession(db, clock, user.id, c.req.header("user-agent") ?? null));
      return c.redirect(signedIn.returnTo, 302);
    } catch (e) {
      if (e instanceof SignInError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  app.post("/auth/logout", async (c) => {
    if (!sameSite(c)) return c.json({ error: "This request didn't come from this site." }, 403);
    await endSession(db, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: config.secureCookies });
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- the API needs a signed-in person

  // Replies by email come from the email provider, not a signed-in person.
  registerInboundEmail(app as unknown as Hono, { db, clock, config, ...(ports.mail ? { mail: ports.mail } : {}) }, ensureReady);

  app.use("/api/*", async (c, next) => {
    await ensureReady();
    if (!sameSite(c)) return c.json({ error: "This request didn't come from this site." }, 403);
    let user = await userForSession(db, clock, getCookie(c, SESSION_COOKIE));
    if (!user && ports.testAuth) {
      user = userFromTestHeader(c.req.raw);
      if (user) await ensureTestUser(user);
      if (user && (await db.first(`SELECT 1 AS x FROM users WHERE id = ? AND suspended_at IS NOT NULL`, [user.id]))) return c.json({ error: suspendedMessage }, 403);
    }
    if (!user) return c.json({ error: "Sign in to continue." }, 401);
    c.set("user", user);
    await next();
  });

  app.post("/api/logout-everywhere", async (c) => {
    const ended = await endAllSessions(db, c.get("user").id);
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: config.secureCookies });
    return c.json({ ok: true, ended });
  });

  /** Every account has a private workspace; the first sign-in creates it. */
  async function ensureWorkspace(user: { id: string; name: string }) {
    const has = await db.first(`SELECT 1 AS x FROM members WHERE user_id = ? LIMIT 1`, [user.id]);
    if (has) return;
    const workspaceId = crypto.randomUUID();
    await db.batch([
      { sql: `INSERT INTO workspaces (id, name, work_week, created_at) VALUES (?, ?, ?, ?)`, params: [workspaceId, `${user.name}'s workspace`, JSON.stringify(config.defaultWorkWeek), clock.now()] },
      { sql: `INSERT INTO members (workspace_id, user_id, role) VALUES (?, ?, 'manager')`, params: [workspaceId, user.id] },
    ]);
  }

  /** TESTS ONLY: people from the x-test-user header are saved on first sight. */
  async function ensureTestUser(user: User) {
    if (!(await db.first(`SELECT id FROM users WHERE id = ?`, [user.id]))) {
      await db.run(`INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)`, [user.id, user.name, user.email, clock.now()]);
    }
    await ensureWorkspace(user);
  }

  /**
   * The plan and the person's role, or null when they can't see it. People reach a plan through
   * its workspace or by being invited to the plan; the stronger role wins. Only workspace managers
   * and editors share the plan with others (people invited to one plan can't invite more).
   */
  async function access(planId: string, userId: string) {
    const row = await db.first<{ workspace_id: string; ws_role: Role | null; plan_role: PlanRole | null; work_week: string; title: string; version: number }>(
      `SELECT p.workspace_id, m.role AS ws_role, pm.role AS plan_role, w.work_week, p.title, p.version FROM plans p
       JOIN workspaces w ON w.id = p.workspace_id
       LEFT JOIN members m ON m.workspace_id = p.workspace_id AND m.user_id = ?
       LEFT JOIN plan_members pm ON pm.plan_id = p.id AND pm.user_id = ?
       WHERE p.id = ? AND (m.user_id IS NOT NULL OR pm.user_id IS NOT NULL)`,
      [userId, userId, planId],
    );
    if (!row) return null;
    const role = strongest<Role>(row.ws_role, row.plan_role)!;
    return { ...row, role, canShare: row.ws_role === "manager" || row.ws_role === "editor" };
  }
  // Someone else's plan answers exactly like a missing one, so IDs can't be probed.
  const notFound = { error: "This plan doesn't exist or you don't have access to it." };
  const heldMessage = "This plan is waiting for a safety review. AI features, sharing and exports are paused until then; everything else works.";
  const isHeld = async (planId: string) => (await db.first<{ state: string }>(`SELECT state FROM plans WHERE id = ?`, [planId]))?.state === "review";

  const aiDeps = {
    db,
    clock,
    config,
    ai: ports.ai,
    access,
    loadRoom: (planId: string) => loadRoom(db, planId),
    loadPeople: (planId: string) => loadPeople(planId),
    workWeekOf: async (wsId: string) => parseWorkWeek((await db.first<{ work_week: string }>(`SELECT work_week FROM workspaces WHERE id = ?`, [wsId]))?.work_week ?? "{}"),
  };
  const ai = aiService(aiDeps);
  registerAiRoutes(app, aiDeps, ai);
  registerAiAdminRoutes(app, { db, clock, config }, ai);
  registerSafetyRoutes(app, { db, clock, config });
  registerNotificationRoutes(app, { db, clock });
  registerSupportRoutes(app, { db, clock, config, access, ...(ports.mail ? { mail: ports.mail } : {}) });
  registerStatusUpdateRoutes(app, { db, clock, access, notFound });
  registerSafetyCaseRoutes(app, { db, clock, config, ...(ports.mail ? { mail: ports.mail } : {}) });
  registerCollabRoutes(app, {
    db, clock, rooms, access, notFound,
    // Mentions first; then the task's owner (when their name is linked to an account) hears about it once.
    onComment: async ({ planId, taskId, taskTitle, taskOwner, author, mentions }) => {
      const title = (await db.first<{ title: string }>(`SELECT title FROM plans WHERE id = ?`, [planId]))?.title ?? "a plan";
      const link = `/p/${planId}/checklist?task=${encodeURIComponent(taskId)}`;
      for (const userId of mentions) await notify(db, clock.now(), { userId, planId, kind: "mention", text: `${author.name} mentioned you on ${taskTitle} (${title})`, link }, author.id);
      const owner = await userForName(db, planId, taskOwner);
      if (owner && !mentions.includes(owner)) await notify(db, clock.now(), { userId: owner, planId, kind: "comment", text: `${author.name} commented on your task ${taskTitle} (${title})`, link }, author.id);
    },
  });

  app.get("/api/me", async (c) => {
    const user = c.get("user");
    const workspaces = await db.all(`SELECT w.id, w.name, m.role, w.work_week FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.created_at`, [user.id]);
    const platformAdmin = isPlatformAdmin(config, user);
    const safetyOpen = platformAdmin ? Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM safety_holds WHERE status = 'held'`))?.n ?? 0) : 0;
    return c.json({ user, platformAdmin, safetyOpen, supportOpen: platformAdmin ? await supportOpen(db) : 0, unread: await unreadCount(db, user.id), workspaces: workspaces.map((w) => ({ ...w, work_week: JSON.parse(String(w.work_week)) })) });
  });

  /** Availability saved for a plan, by name (what the scheduler and Plan Check use). */
  async function loadPeople(planId: string): Promise<Record<string, PersonAvailability>> {
    const rows = await db.all<{ name: string; availability: string }>(`SELECT name, availability FROM plan_people WHERE plan_id = ?`, [planId]);
    return Object.fromEntries(rows.map((r) => [r.name, JSON.parse(r.availability) as PersonAvailability]));
  }

  /** Reads and checks a pasted or uploaded plan (shared by preview and save). Nothing is stored. */
  async function readImport(c: Context, user: User) {
    const body = await c.req.json<{ text?: unknown; fileName?: unknown; workspaceId?: unknown; people?: unknown }>().catch(() => null);
    if (!body || typeof body.text !== "string") return { error: c.json({ error: "Send the plan as text." }, 400) };
    if (body.text.length > MAX_BODY_CHARS) return { error: c.json({ error: "This text is too long (over 1,000,000 characters)." }, 413) };
    const workspace = await db.first<{ workspace_id: string; role: Role; work_week: string }>(
      typeof body.workspaceId === "string"
        ? `SELECT m.workspace_id, m.role, w.work_week FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? AND m.workspace_id = ?`
        : `SELECT m.workspace_id, m.role, w.work_week FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.created_at LIMIT 1`,
      typeof body.workspaceId === "string" ? [user.id, body.workspaceId] : [user.id],
    );
    if (!workspace) return { error: c.json({ error: "That workspace doesn't exist or you aren't in it." }, 404) };
    if (workspace.role === "viewer") return { error: c.json({ error: "Viewers can't add plans to this workspace." }, 403) };
    // Availability typed on the preview screen: names to { hours a week, working days, days off }.
    let people: Record<string, PersonAvailability> = {};
    if (body.people !== undefined) {
      const entries = body.people && typeof body.people === "object" ? Object.entries(body.people as Record<string, unknown>) : null;
      if (!entries || entries.length > MAX_PLAN_PEOPLE) return { error: c.json({ error: "The availability list isn't valid." }, 400) };
      for (const [name, value] of entries) {
        const a = parseAvailability(value);
        if (!a || !name.trim() || name.length > 80) return { error: c.json({ error: `The availability for "${name.slice(0, 80)}" isn't valid. Hours a week must be 1 to 60.` }, 400) };
        people[name.trim()] = a;
      }
    }
    const members = await db.all<{ name: string }>(`SELECT u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?`, [workspace.workspace_id]);
    const preview = await importPlan(
      { source: typeof body.fileName === "string" ? "upload" : "paste", text: body.text, ...(typeof body.fileName === "string" ? { fileName: body.fileName } : {}) },
      { importerName: user.name, editablePlanIds: new Set(), memberNames: members.map((m) => m.name), today: clock.today(), ...(ai.moderator(user, workspace.workspace_id) ? { moderate: ai.moderator(user, workspace.workspace_id)! } : {}) },
    );
    if (!preview.ok || !preview.plan) return { error: c.json({ error: preview.notices[0] ?? "This plan couldn't be read.", notices: preview.notices, parseIssues: preview.parseIssues, moderation: preview.moderation }, 422) };
    const workWeek = parseWorkWeek(workspace.work_week);
    return { workspace, preview, plan: preview.plan, people, workWeek };
  }

  // The preview screen: the plan as it would be saved, its Plan Check and finish date with the
  // availability typed so far. Nothing is stored.
  app.post("/api/plans/preview", async (c) => {
    const r = await readImport(c, c.get("user"));
    if ("error" in r) return r.error;
    const today = clock.today();
    const schedule = levelPlan(r.plan, { workWeek: r.workWeek, today, people: r.people });
    return c.json({
      plan: r.plan,
      people: planPeople(r.plan),
      workWeek: r.workWeek,
      finish: schedule.finish,
      check: checkPlan(r.plan, { schedule, workWeek: r.workWeek, today, people: r.people, level: true }),
      notices: r.preview.notices,
      parseIssues: r.preview.parseIssues,
      moderation: r.preview.moderation.verdict,
      suggestedPeople: r.preview.suggestedPeople,
      sensitiveFlags: r.preview.sensitiveFlags,
    });
  });

  app.post("/api/plans", async (c) => {
    const user = c.get("user");
    const r = await readImport(c, user);
    if ("error" in r) return r.error;
    const id = crypto.randomUUID();
    const now = clock.now();
    const plan = { ...r.plan, id };
    const state = r.preview.moderation.verdict === "review" ? "review" : "active";
    await db.batch([
      { sql: `INSERT INTO plans (id, workspace_id, title, state, room, version, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`, params: [id, r.workspace.workspace_id, plan.title, state, newRoomJson(plan), user.id, now, now] },
      { sql: `INSERT INTO plan_versions (plan_id, version, reason, snapshot, created_by, created_at) VALUES (?, 0, 'import', ?, ?, ?)`, params: [id, JSON.stringify(plan), user.id, now] },
      ...Object.entries(r.people).map(([name, a]) => ({ sql: `INSERT INTO plan_people (plan_id, name_key, name, availability, updated_at) VALUES (?, ?, ?, ?, ?)`, params: [id, name.toLowerCase(), name, JSON.stringify(a), now] })),
    ]);
    if (state === "review") await ai.hold(id, user, "moderation", r.preview.moderation.category ?? null, body0(r.plan));
    return c.json({ id, state, notices: r.preview.notices, parseIssues: r.preview.parseIssues, check: r.preview.check }, 201);
  });

  // One person's availability on a plan (hours a week, working days, days off). Editors and managers.
  app.put("/api/plans/:id/people/:name", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const name = decodeURIComponent(c.req.param("name")).trim();
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "You can view this plan but not change it." }, 403);
    const availability = parseAvailability(await c.req.json().catch(() => null));
    if (!availability || !name || name.length > 80) return c.json({ error: "This availability isn't valid. Hours a week must be 1 to 60." }, 400);
    const count = await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM plan_people WHERE plan_id = ? AND name_key != ?`, [id, name.toLowerCase()]);
    if (Number(count?.n ?? 0) >= MAX_PLAN_PEOPLE) return c.json({ error: `A plan can list up to ${MAX_PLAN_PEOPLE} people.` }, 400);
    await db.run(
      `INSERT INTO plan_people (plan_id, name_key, name, availability, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (plan_id, name_key) DO UPDATE SET name = excluded.name, availability = excluded.availability, updated_at = excluded.updated_at`,
      [id, name.toLowerCase(), name, JSON.stringify(availability), clock.now()],
    );
    // Everyone with the plan open sees the new dates at once.
    await rooms.notify(id, { t: "people", people: await loadPeople(id) });
    return c.json({ name, availability });
  });

  // The workspace's standard work week ("Full time"). Managers only. With dryRun, nothing is saved
  // and the answer lists how each plan's finish date would move (the preview shown before saving).
  app.put("/api/workspaces/:id/work-week", async (c) => {
    const user = c.get("user");
    const wsId = c.req.param("id");
    const m = await db.first<{ role: Role; work_week: string }>(`SELECT m.role, w.work_week FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? AND m.workspace_id = ?`, [user.id, wsId]);
    if (!m) return c.json({ error: "That workspace doesn't exist or you aren't in it." }, 404);
    if (m.role !== "manager") return c.json({ error: "Only workspace managers can change the work week." }, 403);
    const body = await c.req.json<{ hoursPerWeek?: unknown; workdays?: unknown; dryRun?: unknown }>().catch(() => null);
    const hours = Number(body?.hoursPerWeek);
    const days = Array.isArray(body?.workdays) ? [...new Set((body!.workdays as unknown[]).map(Number))].sort() : [];
    if (!(hours >= 1 && hours <= 60) || Math.round(hours * 2) !== hours * 2 || days.length < 1 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return c.json({ error: "Use 1 to 60 hours a week (whole or half hours) and at least one working day." }, 400);
    }
    const next: WorkWeek = { hoursPerWeek: hours, workdays: days };
    const before = parseWorkWeek(m.work_week);
    const today = clock.today();
    const plans = await db.all<{ id: string }>(`SELECT id FROM plans WHERE workspace_id = ? AND state != 'archived' ORDER BY updated_at DESC LIMIT 200`, [wsId]);
    const impact = [];
    for (const p of plans) {
      const room = await loadRoom(db, p.id);
      if (!room) continue;
      const people = await loadPeople(p.id);
      const was = levelPlan(room.plan, { workWeek: before, today, people }).finish;
      const will = levelPlan(room.plan, { workWeek: next, today, people }).finish;
      impact.push({ planId: p.id, title: room.plan.title, before: was, after: will });
    }
    if (body?.dryRun !== true) await db.run(`UPDATE workspaces SET work_week = ? WHERE id = ?`, [JSON.stringify(next), wsId]);
    return c.json({ workWeek: next, saved: body?.dryRun !== true, impact });
  });

  app.get("/api/plans", async (c) => {
    const user = c.get("user");
    const rows = await db.all<{ id: string; title: string; state: string; version: number; workspace_id: string; updated_at: number; work_week: string; shared: number }>(
      `SELECT p.id, p.title, p.state, p.version, p.workspace_id, p.updated_at, w.work_week, CASE WHEN m.user_id IS NULL THEN 1 ELSE 0 END AS shared FROM plans p
       JOIN workspaces w ON w.id = p.workspace_id
       LEFT JOIN members m ON m.workspace_id = p.workspace_id AND m.user_id = ?
       LEFT JOIN plan_members pm ON pm.plan_id = p.id AND pm.user_id = ?
       WHERE m.user_id IS NOT NULL OR pm.user_id IS NOT NULL
       ORDER BY p.updated_at DESC`,
      [user.id, user.id],
    );
    const today = clock.today();
    // Home shows each plan's progress, health, finish and next milestone, computed by the same engine.
    const plans = await Promise.all(
      rows.map(async ({ work_week, shared, ...p }) => {
        const room = await loadRoom(db, p.id);
        if (!room) return { ...p, summary: null };
        const workWeek = parseWorkWeek(work_week);
        const schedule = levelPlan(room.plan, { workWeek, today, people: await loadPeople(p.id) });
        const progress = progressOf(room.plan, schedule, { workWeek, today });
        const next = room.plan.phases
          .flatMap((ph) => ph.tasks)
          .filter((t) => t.milestone && t.status !== "done" && t.status !== "skipped")
          .map((t) => ({ title: t.title, date: schedule.tasks.get(t.id)?.end ?? schedule.finish }))
          .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
        return {
          ...p,
          shared: Number(shared) === 1,
          title: room.plan.title,
          summary: { percent: progress.percent, doneCount: progress.doneCount, countedTasks: progress.countedTasks, overdueCount: progress.overdueCount, finish: schedule.finish, health: progress.suggestedHealth, nextMilestone: next ?? null, baselineVarianceDays: progress.baselineVarianceDays },
          statusUpdate: await updateState(db, clock.now(), p.id),
        };
      }),
    );
    return c.json({ plans });
  });

  app.get("/api/plans/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    const room = await loadRoom(db, id);
    if (!room) return c.json(notFound, 404);
    const workWeek = parseWorkWeek(a.work_week);
    const today = clock.today();
    const people = await loadPeople(id);
    const schedule = levelPlan(room.plan, { workWeek, today, people });
    const check = checkPlan(room.plan, { schedule, workWeek, today, people, level: true });
    return c.json({
      id,
      version: room.seq,
      role: a.role,
      state: (await db.first<{ state: string }>(`SELECT state FROM plans WHERE id = ?`, [id]))?.state ?? "active",
      plan: room.plan,
      people,
      workWeek,
      // The app recomputes dates as edits arrive; it uses the server's day, not the device's clock.
      today,
      restoredForReview: room.restoredForReview,
      statusUpdate: await updateState(db, clock.now(), id),
      schedule: {
        projectStart: schedule.projectStart,
        finish: schedule.finish,
        criticalPath: schedule.criticalPath,
        tasks: Object.fromEntries([...schedule.tasks].map(([tid, t]) => [tid, { start: t.start, end: t.end, critical: t.critical }])),
      },
      check,
    });
  });

  app.post("/api/plans/:id/ops", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "You can view this plan but not change it." }, 403);
    const body = await c.req.json<{ opId?: unknown; clientId?: unknown; op?: unknown }>().catch(() => null);
    const op = body ? parseOp(body.op) : null;
    const idOk = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
    if (!body || !op || !idOk(body.opId) || !idOk(body.clientId)) return c.json({ error: "This edit isn't valid. Send { opId, clientId, op } with a supported change." }, 400);
    const envelope: OpEnvelope = { opId: body.opId, clientId: body.clientId, op };
    // "Done by" always comes from the signed-in person, never from the request.
    const actor: Actor = { userId: user.id, name: user.name };
    const result = await rooms.apply(id, envelope, actor);
    if (result.status === "missing") return c.json(notFound, 404);
    return c.json(result);
  });

  /** Saves the plan as it is now, so a bulk change can be undone from Version history. */
  async function saveVersion(planId: string, reason: string, userId: string): Promise<number | null> {
    const room = await loadRoom(db, planId);
    if (!room) return null;
    const last = await db.first<{ v: number | null }>(`SELECT MAX(version) AS v FROM plan_versions WHERE plan_id = ?`, [planId]);
    const v = Number(last?.v ?? -1) + 1;
    await db.run(`INSERT INTO plan_versions (plan_id, version, reason, snapshot, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [planId, v, reason, JSON.stringify(room.plan), userId, clock.now()]);
    return v;
  }

  // "Update with my AI": the changes the person accepted in the preview, applied in one go after
  // saving a version. Each one is an ordinary edit, checked like any other.
  app.post("/api/plans/:id/update", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "You can view this plan but not change it." }, 403);
    const body = await c.req.json<{ ops?: unknown }>().catch(() => null);
    const raw = Array.isArray(body?.ops) ? body!.ops : null;
    if (!raw || raw.length === 0 || raw.length > 1000) return c.json({ error: "Send the accepted changes as a list (1 to 1,000)." }, 400);
    const ops = raw.map(parseOp);
    const bad = ops.findIndex((op) => !op);
    if (bad >= 0) return c.json({ error: `Change ${bad + 1} isn't a valid edit.` }, 400);
    const saved = await saveVersion(id, "Before an update from an AI assistant", user.id);
    const batch = crypto.randomUUID().slice(0, 8);
    let version = 0;
    for (const [i, op] of ops.entries()) {
      const r = await rooms.apply(id, { opId: `update-${batch}-${i}`, clientId: "update", op: op! }, { userId: user.id, name: user.name });
      if (r.status === "missing") return c.json(notFound, 404);
      version = r.version;
    }
    await recordActivity(db, id, user, { kind: "update", summary: `${user.name} applied ${ops.length === 1 ? "1 change" : `${ops.length} changes`} from an AI assistant` }, clock.now());
    return c.json({ version, applied: ops.length, savedVersion: saved });
  });

  app.get("/api/plans/:id/versions", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!(await access(id, user.id))) return c.json(notFound, 404);
    const rows = await db.all<{ version: number; reason: string; snapshot: string; created_at: number; name: string | null }>(
      `SELECT v.version, v.reason, v.snapshot, v.created_at, u.name FROM plan_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.plan_id = ? ORDER BY v.version DESC LIMIT 100`,
      [id],
    );
    return c.json({
      versions: rows.map((r) => {
        const plan = JSON.parse(r.snapshot) as { title: string; phases: { tasks: { status: string; milestone: boolean }[] }[] };
        const tasks = plan.phases.flatMap((p) => p.tasks).filter((t) => !t.milestone);
        return { version: Number(r.version), reason: r.reason, createdAt: Number(r.created_at), by: r.name ?? "Someone", title: plan.title, tasks: tasks.length, done: tasks.filter((t) => t.status === "done").length, plan };
      }),
    });
  });

  // Restoring brings back the exact earlier plan; the current one is saved first, so this can be undone too.
  app.post("/api/plans/:id/versions/:v/restore", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "You can view this plan but not change it." }, 403);
    const v = Number(c.req.param("v"));
    const row = await db.first<{ snapshot: string }>(`SELECT snapshot FROM plan_versions WHERE plan_id = ? AND version = ?`, [id, Number.isInteger(v) ? v : -1]);
    if (!row) return c.json({ error: "That version doesn't exist." }, 404);
    const saved = await saveVersion(id, `Before restoring version ${v}`, user.id);
    const plan = { ...(JSON.parse(row.snapshot) as Plan), id };
    const r = await rooms.apply(id, { opId: `restore-${crypto.randomUUID().slice(0, 8)}`, clientId: "restore", op: { kind: "replacePlan", plan } }, { userId: user.id, name: user.name });
    if (r.status === "missing") return c.json(notFound, 404);
    await recordActivity(db, id, user, { kind: "replace", summary: `${user.name} restored version ${v} of the plan` }, clock.now());
    return c.json({ version: r.version, savedVersion: saved });
  });

  // Set baseline: today's scheduled dates become every task's planned dates. The server works the
  // dates out with the same engine (never trusting the browser), saves a version first so it can be
  // undone from Version history, and every open device gets the change live.
  app.post("/api/plans/:id/baseline", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "You can view this plan but not change it." }, 403);
    const room = await loadRoom(db, id);
    if (!room) return c.json(notFound, 404);
    const today = clock.today();
    const schedule = levelPlan(room.plan, { workWeek: parseWorkWeek(a.work_week), today, people: await loadPeople(id) });
    const dates = Object.fromEntries([...schedule.tasks].map(([tid, t]) => [tid, { start: t.start, end: t.end }]));
    const saved = await saveVersion(id, room.plan.baselineSet ? `Before replacing the baseline from ${room.plan.baselineSet}` : "Before setting the baseline", user.id);
    const r = await rooms.apply(id, { opId: `baseline-${crypto.randomUUID().slice(0, 8)}`, clientId: "baseline", op: { kind: "setBaseline", on: today, dates } }, { userId: user.id, name: user.name });
    if (r.status === "missing") return c.json(notFound, 404);
    return c.json({ version: r.version, baselineSet: today, finish: schedule.finish, savedVersion: saved });
  });

  // ---------------------------------------------------------------- sharing a plan

  app.get("/api/plans/:id/sharing", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    const ws = await db.all<{ id: string; name: string; email: string; role: Role }>(`SELECT u.id, u.name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?`, [a.workspace_id]);
    const invited = await db.all<{ id: string; name: string; email: string; role: PlanRole }>(`SELECT u.id, u.name, u.email, pm.role FROM plan_members pm JOIN users u ON u.id = pm.user_id WHERE pm.plan_id = ?`, [id]);
    const members = [...ws.map((m) => ({ userId: m.id, name: m.name, email: m.email, role: m.role, via: "workspace" as const })), ...invited.filter((p) => !ws.some((w) => w.id === p.id)).map((m) => ({ userId: m.id, name: m.name, email: m.email, role: m.role, via: "invite" as const }))];
    const invites = a.canShare
      ? (await db.all<{ id: string; email: string; role: PlanRole; person_name: string | null; expires_at: number }>(`SELECT id, email, role, person_name, expires_at FROM invites WHERE plan_id = ? AND accepted_by IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC`, [id, clock.now()])).map((i) => ({ id: i.id, email: i.email, role: i.role, personName: i.person_name, expiresAt: Number(i.expires_at) }))
      : [];
    return c.json({ canShare: a.canShare, members, invites });
  });

  app.post("/api/plans/:id/invites", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (!a.canShare) return c.json({ error: "Only people in this plan's workspace can invite others." }, 403);
    if (await isHeld(id)) return c.json({ error: heldMessage }, 423);
    const body = await c.req.json<{ email?: unknown; role?: unknown; personName?: unknown }>().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = body?.role as PlanRole;
    const personName = typeof body?.personName === "string" && body.personName.trim() ? body.personName.trim().slice(0, 80) : null;
    if (!EMAIL_RE.test(email) || email.length > 254) return c.json({ error: "Enter a full email address, like name@example.com." }, 400);
    if (!PLAN_ROLES.includes(role)) return c.json({ error: "Choose Editor, Commenter or Viewer." }, 400);
    const already = await db.first(
      `SELECT 1 AS x FROM users u WHERE lower(u.email) = ? AND (EXISTS (SELECT 1 FROM members m WHERE m.user_id = u.id AND m.workspace_id = ?) OR EXISTS (SELECT 1 FROM plan_members pm WHERE pm.user_id = u.id AND pm.plan_id = ?))`,
      [email, a.workspace_id, id],
    );
    if (already) return c.json({ error: "That person already has access to this plan." }, 409);
    const token = randomToken();
    const inviteId = crypto.randomUUID();
    const expiresAt = clock.now() + INVITE_DAYS * 86_400_000;
    await db.run(`INSERT INTO invites (id, token_hash, plan_id, email, role, person_name, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [inviteId, await sha256(token), id, email, role, personName, user.id, clock.now(), expiresAt]);
    // The link is shown once, to the person inviting; only its hash is stored.
    // Someone who already has an account also gets a notice; it opens the invite by its id (the
    // secret link is never stored), and only the invited address can accept it.
    const invitee = await db.first<{ id: string }>(`SELECT id FROM users WHERE lower(email) = ?`, [email.toLowerCase()]);
    if (invitee) await notify(db, clock.now(), { userId: invitee.id, planId: id, kind: "invited", text: `${user.name} invited you to ${a.title} as ${ROLE_WORD[role]}`, link: `/invite/id/${inviteId}` }, user.id);
    return c.json({ id: inviteId, link: `${siteOrigin}/invite/${token}`, expiresAt }, 201);
  });

  app.delete("/api/plans/:id/invites/:inviteId", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (!a.canShare) return c.json({ error: "Only people in this plan's workspace can manage invites." }, 403);
    const r = await db.run(`UPDATE invites SET revoked_at = ? WHERE id = ? AND plan_id = ? AND accepted_by IS NULL`, [clock.now(), c.req.param("inviteId"), id]);
    return r.changes ? c.json({ ok: true }) : c.json({ error: "That invite doesn't exist or was already used." }, 404);
  });

  app.put("/api/plans/:id/members/:userId", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (!a.canShare) return c.json({ error: "Only people in this plan's workspace can change roles." }, 403);
    const role = ((await c.req.json<{ role?: unknown }>().catch(() => null))?.role ?? "") as PlanRole;
    if (!PLAN_ROLES.includes(role)) return c.json({ error: "Choose Editor, Commenter or Viewer." }, 400);
    const target = c.req.param("userId");
    const r = await db.run(`UPDATE plan_members SET role = ? WHERE plan_id = ? AND user_id = ?`, [role, id, target]);
    if (!r.changes) return c.json({ error: "Only people invited to this plan can be changed here." }, 404);
    await recordActivity(db, id, user, { kind: "sharing", summary: `${user.name} made ${await nameOf(target)} ${ROLE_WORD[role]}` }, clock.now());
    await rooms.kick(id, target); // they reconnect with the new role
    return c.json({ ok: true });
  });

  app.delete("/api/plans/:id/members/:userId", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (!a.canShare) return c.json({ error: "Only people in this plan's workspace can remove others." }, 403);
    const target = c.req.param("userId");
    const r = await db.run(`DELETE FROM plan_members WHERE plan_id = ? AND user_id = ?`, [id, target]);
    if (!r.changes) return c.json({ error: "Only people invited to this plan can be removed here." }, 404);
    await db.run(`UPDATE plan_people SET user_id = NULL WHERE plan_id = ? AND user_id = ?`, [id, target]);
    await recordActivity(db, id, user, { kind: "sharing", summary: `${user.name} removed ${await nameOf(target)} from the plan` }, clock.now());
    await rooms.kick(id, target); // open connections end at once
    return c.json({ ok: true });
  });

  const nameOf = async (userId: string) => (await db.first<{ name: string }>(`SELECT name FROM users WHERE id = ?`, [userId]))?.name ?? "someone";

  /** An invite by its link secret, or by its id from a notification (the signed-in person is checked against it either way). */
  async function inviteFor(token: string, byId = false) {
    if (!token || token.length > 100) return null;
    return db.first<InviteRow & { plan_title: string; inviter: string | null }>(
      `SELECT i.*, p.title AS plan_title, u.name AS inviter FROM invites i JOIN plans p ON p.id = i.plan_id LEFT JOIN users u ON u.id = i.created_by WHERE ${byId ? "i.id" : "i.token_hash"} = ?`,
      [byId ? token : await sha256(token)],
    );
  }
  const noInvite = { error: "This invite link isn't valid. Ask for a new one." };

  app.get("/api/invites/:token", async (c) => {
    const user = c.get("user");
    const inv = await inviteFor(c.req.param("token"), c.req.query("by") === "id");
    if (!inv) return c.json(noInvite, 404);
    const problem = inviteProblem(inv, clock.now(), user.email, user.id);
    return c.json({ planTitle: problem ? null : inv.plan_title, inviter: inv.inviter ?? "Someone", role: inv.role, email: maskEmail(inv.email), problem, accepted: inv.accepted_by === user.id, planId: inv.accepted_by === user.id ? inv.plan_id : null });
  });

  app.post("/api/invites/:token/accept", async (c) => {
    const user = c.get("user");
    const inv = await inviteFor(c.req.param("token"), c.req.query("by") === "id");
    if (!inv) return c.json(noInvite, 404);
    const problem = inviteProblem(inv, clock.now(), user.email, user.id);
    if (problem) return c.json({ error: problem }, 403);
    if (!inv.accepted_by) {
      await db.batch([
        { sql: `INSERT INTO plan_members (plan_id, user_id, role, added_by, added_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (plan_id, user_id) DO UPDATE SET role = excluded.role`, params: [inv.plan_id, user.id, inv.role, inv.created_by, clock.now()] },
        { sql: `UPDATE invites SET accepted_by = ?, accepted_at = ? WHERE id = ?`, params: [user.id, clock.now(), inv.id] },
        // The name the inviter used on the plan (e.g. "Sam") now means this account.
        ...(inv.person_name ? [{ sql: `UPDATE plan_people SET user_id = ? WHERE plan_id = ? AND name_key = ?`, params: [user.id, inv.plan_id, inv.person_name.toLowerCase()] }] : []),
      ]);
      await recordActivity(db, inv.plan_id, user, { kind: "sharing", summary: `${user.name} joined the plan as ${ROLE_WORD[inv.role]}` }, clock.now());
    }
    return c.json({ planId: inv.plan_id });
  });

  app.get("/api/plans/:id/trash", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!(await access(id, user.id))) return c.json(notFound, 404);
    const room = await loadRoom(db, id);
    if (!room) return c.json(notFound, 404);
    const items = Object.entries(room.trash).map(([taskId, x]) => ({ taskId, title: x.task.title, phaseId: x.phaseId, deletedAt: x.deletedAt, by: x.by }));
    return c.json({ items: items.sort((p, q) => q.deletedAt.localeCompare(p.deletedAt)) });
  });

  // Live editing. WebSockets are GET requests, so check the origin here too (blocks other sites
  // from opening a connection with someone's cookie).
  app.get("/api/plans/:id/live", async (c) => {
    const origin = c.req.header("origin");
    if (origin && origin !== siteOrigin) return c.json({ error: "This request didn't come from this site." }, 403);
    if ((c.req.header("upgrade") ?? "").toLowerCase() !== "websocket") return c.json({ error: "Connect with a WebSocket." }, 426);
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    return rooms.connect(c.req.raw, id, { userId: user.id, name: user.name }, a.role);
  });

  app.get("/api/plans/:id/export", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (await isHeld(id)) return c.json({ error: heldMessage }, 423);
    const room = await loadRoom(db, id);
    if (!room) return c.json(notFound, 404);
    const text = exportPlan(room.plan, { hoursPerDay: hoursPerDay(parseWorkWeek(a.work_week)) });
    const name = (room.plan.title.replace(/[^\w .-]+/g, "").trim() || "plan").slice(0, 80);
    return c.body(text, 200, {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${name}${BRAND.fileExtensions[0]}"`,
    });
  });

  app.notFound((c) => c.json({ error: "Not found." }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Something went wrong on our side. Try again." }, 500);
  });

  return app;
}

/** A short excerpt of a plan for the safety review queue (only what's needed to judge it). */
function body0(plan: Plan): string {
  return [plan.title, plan.goal ?? "", ...plan.phases.flatMap((p) => [p.title, ...p.tasks.map((t) => t.title)])].join("\n").slice(0, 600);
}

function parseWorkWeek(json: string): WorkWeek {
  try {
    const w = JSON.parse(json) as Partial<WorkWeek>;
    return { hoursPerWeek: Number(w.hoursPerWeek) || DEFAULT_WORK_WEEK.hoursPerWeek, workdays: Array.isArray(w.workdays) && w.workdays.length ? w.workdays.map(Number) : DEFAULT_WORK_WEEK.workdays };
  } catch {
    return DEFAULT_WORK_WEEK;
  }
}
