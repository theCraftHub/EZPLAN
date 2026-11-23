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
  progressOf,
  parseOp,
  type Actor,
  type OpEnvelope,
  type WorkWeek,
} from "@ezplan/shared";
import { userFromTestHeader } from "./auth";
import { migrate } from "./migrations";
import { finishLogin, SignInError, startLogin, userForSignIn } from "./oidc";
import { loadRoom, newRoomJson } from "./room";
import { createSession, endAllSessions, endSession, SESSION_COOKIE, SESSION_DAYS, userForSession } from "./sessions";
import type { Ports, User } from "./ports";

type Role = "manager" | "editor" | "viewer";
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

  app.use("/api/*", async (c, next) => {
    await ensureReady();
    if (!sameSite(c)) return c.json({ error: "This request didn't come from this site." }, 403);
    let user = await userForSession(db, clock, getCookie(c, SESSION_COOKIE));
    if (!user && ports.testAuth) {
      user = userFromTestHeader(c.req.raw);
      if (user) await ensureTestUser(user);
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

  /** The plan and the person's role in its workspace, or null when they can't see it. */
  async function access(planId: string, userId: string) {
    return db.first<{ workspace_id: string; role: Role; work_week: string; title: string; version: number }>(
      `SELECT p.workspace_id, m.role, w.work_week, p.title, p.version FROM plans p
       JOIN members m ON m.workspace_id = p.workspace_id AND m.user_id = ?
       JOIN workspaces w ON w.id = p.workspace_id
       WHERE p.id = ?`,
      [userId, planId],
    );
  }
  // Someone else's plan answers exactly like a missing one, so IDs can't be probed.
  const notFound = { error: "This plan doesn't exist or you don't have access to it." };

  app.get("/api/me", async (c) => {
    const user = c.get("user");
    const workspaces = await db.all(`SELECT w.id, w.name, m.role, w.work_week FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.created_at`, [user.id]);
    return c.json({ user, workspaces: workspaces.map((w) => ({ ...w, work_week: JSON.parse(String(w.work_week)) })) });
  });

  app.post("/api/plans", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ text?: unknown; fileName?: unknown; workspaceId?: unknown }>().catch(() => null);
    if (!body || typeof body.text !== "string") return c.json({ error: "Send the plan as text." }, 400);
    if (body.text.length > MAX_BODY_CHARS) return c.json({ error: "This text is too long (over 1,000,000 characters)." }, 413);
    const workspace = await db.first<{ workspace_id: string; role: Role }>(
      typeof body.workspaceId === "string"
        ? `SELECT workspace_id, role FROM members WHERE user_id = ? AND workspace_id = ?`
        : `SELECT m.workspace_id, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.created_at LIMIT 1`,
      typeof body.workspaceId === "string" ? [user.id, body.workspaceId] : [user.id],
    );
    if (!workspace) return c.json({ error: "That workspace doesn't exist or you aren't in it." }, 404);
    if (workspace.role === "viewer") return c.json({ error: "Viewers can't add plans to this workspace." }, 403);
    const members = await db.all<{ name: string }>(`SELECT u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?`, [workspace.workspace_id]);
    const preview = await importPlan(
      { source: typeof body.fileName === "string" ? "upload" : "paste", text: body.text, ...(typeof body.fileName === "string" ? { fileName: body.fileName } : {}) },
      { importerName: user.name, editablePlanIds: new Set(), memberNames: members.map((m) => m.name), today: clock.today() },
    );
    if (!preview.ok || !preview.plan) return c.json({ error: preview.notices[0] ?? "This plan couldn't be read.", notices: preview.notices, moderation: preview.moderation }, 422);
    const id = crypto.randomUUID();
    const now = clock.now();
    const plan = { ...preview.plan, id };
    const state = preview.moderation.verdict === "review" ? "review" : "active";
    await db.batch([
      { sql: `INSERT INTO plans (id, workspace_id, title, state, room, version, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`, params: [id, workspace.workspace_id, plan.title, state, newRoomJson(plan), user.id, now, now] },
      { sql: `INSERT INTO plan_versions (plan_id, version, reason, snapshot, created_by, created_at) VALUES (?, 0, 'import', ?, ?, ?)`, params: [id, JSON.stringify(plan), user.id, now] },
    ]);
    return c.json({ id, state, notices: preview.notices, parseIssues: preview.parseIssues, check: preview.check }, 201);
  });

  app.get("/api/plans", async (c) => {
    const user = c.get("user");
    const rows = await db.all<{ id: string; title: string; state: string; version: number; workspace_id: string; updated_at: number; work_week: string }>(
      `SELECT p.id, p.title, p.state, p.version, p.workspace_id, p.updated_at, w.work_week FROM plans p
       JOIN members m ON m.workspace_id = p.workspace_id AND m.user_id = ?
       JOIN workspaces w ON w.id = p.workspace_id
       ORDER BY p.updated_at DESC`,
      [user.id],
    );
    const today = clock.today();
    // Home shows each plan's progress, health, finish and next milestone, computed by the same engine.
    const plans = await Promise.all(
      rows.map(async ({ work_week, ...p }) => {
        const room = await loadRoom(db, p.id);
        if (!room) return { ...p, summary: null };
        const workWeek = parseWorkWeek(work_week);
        const schedule = levelPlan(room.plan, { workWeek, today });
        const progress = progressOf(room.plan, schedule, { workWeek, today });
        const next = room.plan.phases
          .flatMap((ph) => ph.tasks)
          .filter((t) => t.milestone && t.status !== "done" && t.status !== "skipped")
          .map((t) => ({ title: t.title, date: schedule.tasks.get(t.id)?.end ?? schedule.finish }))
          .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
        return {
          ...p,
          title: room.plan.title,
          summary: { percent: progress.percent, doneCount: progress.doneCount, countedTasks: progress.countedTasks, overdueCount: progress.overdueCount, finish: schedule.finish, health: progress.suggestedHealth, nextMilestone: next ?? null },
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
    const schedule = levelPlan(room.plan, { workWeek, today });
    const check = checkPlan(room.plan, { schedule, workWeek, today, level: true });
    return c.json({
      id,
      version: room.seq,
      role: a.role,
      plan: room.plan,
      restoredForReview: room.restoredForReview,
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
    if (a.role === "viewer") return c.json({ error: "Viewers can't change this plan." }, 403);
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

function parseWorkWeek(json: string): WorkWeek {
  try {
    const w = JSON.parse(json) as Partial<WorkWeek>;
    return { hoursPerWeek: Number(w.hoursPerWeek) || DEFAULT_WORK_WEEK.hoursPerWeek, workdays: Array.isArray(w.workdays) && w.workdays.length ? w.workdays.map(Number) : DEFAULT_WORK_WEEK.workdays };
  } catch {
    return DEFAULT_WORK_WEEK;
  }
}
