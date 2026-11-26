/**
 * Comments on tasks and the plan's activity log. Comments are plain text (shown as text, never
 * HTML), screened with the free checks, and @mentions resolve only to people on the plan.
 */
import type { Hono } from "hono";
import { allTasks, findMentions, freeModeration } from "@rakuplan/shared";
import type { Clock, Db, RoomHost, User } from "./ports";
import { activityFor, recordActivity } from "./activity";
import { loadRoom } from "./room";
import { canComment, type Role } from "./roles";

export interface CollabDeps {
  db: Db;
  clock: Clock;
  rooms: RoomHost;
  access: (planId: string, userId: string) => Promise<{ role: Role; workspace_id: string } | null>;
  notFound: { error: string };
  /** Called for each comment saved (notifications hook in here). */
  onComment?: (c: { planId: string; taskId: string; taskTitle: string; taskOwner: string | undefined; author: User; body: string; mentions: string[] }) => Promise<void>;
}

const MAX_BODY = 2000;
const EDIT_WINDOW_MS = 24 * 3600_000;

/** People on a plan who have accounts, by the names others would type after "@". */
export async function planPeople(db: Db, planId: string): Promise<{ userId: string; name: string }[]> {
  const rows = await db.all<{ user_id: string; name: string }>(
    `SELECT u.id AS user_id, u.name FROM plans p JOIN members m ON m.workspace_id = p.workspace_id JOIN users u ON u.id = m.user_id WHERE p.id = ?
     UNION SELECT u.id, u.name FROM plan_members pm JOIN users u ON u.id = pm.user_id WHERE pm.plan_id = ?
     UNION SELECT pp.user_id, pp.name FROM plan_people pp WHERE pp.plan_id = ? AND pp.user_id IS NOT NULL`,
    [planId, planId, planId],
  );
  return rows.map((r) => ({ userId: r.user_id, name: r.name }));
}

export function registerCollabRoutes(app: Hono<{ Variables: { user: User } }>, d: CollabDeps) {
  const { db, clock } = d;
  const task = async (planId: string, taskId: string) => {
    const room = await loadRoom(db, planId);
    return room ? allTasks(room.plan).find((t) => t.id === taskId) : undefined;
  };
  const count = async (planId: string, taskId: string) => Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM comments WHERE plan_id = ? AND task_id = ? AND deleted_at IS NULL`, [planId, taskId]))?.n ?? 0);
  const broadcast = async (planId: string, taskId: string) => d.rooms.notify(planId, { t: "comments", taskId, count: await count(planId, taskId) });
  const checkBody = (body: unknown): { text: string } | { error: string } => {
    const text = typeof body === "string" ? body.replace(/\r\n/g, "\n").trim() : "";
    if (!text) return { error: "Write something first." };
    if (text.length > MAX_BODY) return { error: `Keep comments under ${MAX_BODY.toLocaleString("en-US")} characters.` };
    if (freeModeration(text).verdict !== "allow") return { error: "This comment can't be posted because it may break the Acceptable Use Policy." };
    return { text };
  };

  app.get("/api/plans/:id/tasks/:taskId/comments", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    const rows = await db.all<{ id: string; author_id: string; name: string; body: string; created_at: number; edited_at: number | null; deleted_at: number | null }>(
      `SELECT c.id, c.author_id, u.name, c.body, c.created_at, c.edited_at, c.deleted_at FROM comments c JOIN users u ON u.id = c.author_id WHERE c.plan_id = ? AND c.task_id = ? ORDER BY c.created_at, c.rowid`,
      [id, c.req.param("taskId")],
    );
    return c.json({
      canComment: canComment(a.role),
      // Who can be @mentioned, for the suggestions as you type; you aren't suggested to yourself.
      people: [...new Set((await planPeople(db, id)).filter((p) => p.userId !== user.id).map((p) => p.name))],
      comments: rows.map((r) => ({
        id: r.id,
        author: r.name,
        mine: r.author_id === user.id,
        body: r.deleted_at ? null : r.body,
        deleted: !!r.deleted_at,
        createdAt: Number(r.created_at),
        editedAt: r.edited_at === null ? null : Number(r.edited_at),
        canEdit: !r.deleted_at && r.author_id === user.id && clock.now() - Number(r.created_at) < EDIT_WINDOW_MS,
        canDelete: !r.deleted_at && (r.author_id === user.id || a.role === "manager"),
      })),
    });
  });

  app.get("/api/plans/:id/comment-counts", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!(await d.access(id, user.id))) return c.json(d.notFound, 404);
    const rows = await db.all<{ task_id: string; n: number }>(`SELECT task_id, COUNT(*) AS n FROM comments WHERE plan_id = ? AND deleted_at IS NULL GROUP BY task_id`, [id]);
    return c.json({ counts: Object.fromEntries(rows.map((r) => [r.task_id, Number(r.n)])) });
  });

  app.post("/api/plans/:id/tasks/:taskId/comments", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const taskId = c.req.param("taskId");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    if (!canComment(a.role)) return c.json({ error: "You can view this plan but not comment on it." }, 403);
    const t = await task(id, taskId);
    if (!t) return c.json({ error: "That task doesn't exist (it may have been deleted)." }, 404);
    const b = checkBody((await c.req.json<{ body?: unknown }>().catch(() => null))?.body);
    if ("error" in b) return c.json({ error: b.error }, b.error.includes("Policy") ? 422 : 400);
    const people = await planPeople(db, id);
    const named = findMentions(b.text, people.map((p) => p.name));
    const mentions = [...new Set(people.filter((p) => named.includes(p.name)).map((p) => p.userId))];
    const cid = crypto.randomUUID();
    await db.run(`INSERT INTO comments (id, plan_id, task_id, author_id, body, mentions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [cid, id, taskId, user.id, b.text, JSON.stringify(mentions), clock.now()]);
    await recordActivity(db, id, { userId: user.id, name: user.name }, { kind: "comment", taskId, summary: `${user.name} commented on ${t.title}` }, clock.now());
    await d.onComment?.({ planId: id, taskId, taskTitle: t.title, taskOwner: t.owner, author: user, body: b.text, mentions });
    await broadcast(id, taskId);
    return c.json({ id: cid, mentions: named }, 201);
  });

  app.patch("/api/plans/:id/tasks/:taskId/comments/:cid", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    const row = await db.first<{ author_id: string; created_at: number; deleted_at: number | null }>(`SELECT author_id, created_at, deleted_at FROM comments WHERE id = ? AND plan_id = ? AND task_id = ?`, [c.req.param("cid"), id, c.req.param("taskId")]);
    if (!row || row.deleted_at) return c.json({ error: "That comment doesn't exist." }, 404);
    if (row.author_id !== user.id || !canComment(a.role)) return c.json({ error: "You can only edit your own comments." }, 403);
    if (clock.now() - Number(row.created_at) >= EDIT_WINDOW_MS) return c.json({ error: "Comments can be edited for 24 hours. Add a new comment instead." }, 409);
    const b = checkBody((await c.req.json<{ body?: unknown }>().catch(() => null))?.body);
    if ("error" in b) return c.json({ error: b.error }, b.error.includes("Policy") ? 422 : 400);
    await db.run(`UPDATE comments SET body = ?, edited_at = ? WHERE id = ?`, [b.text, clock.now(), c.req.param("cid")]);
    await broadcast(id, c.req.param("taskId"));
    return c.json({ ok: true });
  });

  app.delete("/api/plans/:id/tasks/:taskId/comments/:cid", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    const row = await db.first<{ author_id: string; deleted_at: number | null }>(`SELECT author_id, deleted_at FROM comments WHERE id = ? AND plan_id = ? AND task_id = ?`, [c.req.param("cid"), id, c.req.param("taskId")]);
    if (!row || row.deleted_at) return c.json({ error: "That comment doesn't exist." }, 404);
    if (row.author_id !== user.id && a.role !== "manager") return c.json({ error: "You can only delete your own comments." }, 403);
    await db.run(`UPDATE comments SET deleted_at = ?, body = '' WHERE id = ?`, [clock.now(), c.req.param("cid")]);
    await broadcast(id, c.req.param("taskId"));
    return c.json({ ok: true });
  });

  app.get("/api/plans/:id/activity", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!(await d.access(id, user.id))) return c.json(d.notFound, 404);
    const before = Number(c.req.query("before"));
    return c.json({ items: await activityFor(db, id, Number.isFinite(before) && before > 0 ? before : undefined) });
  });
}
