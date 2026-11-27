/**
 * In-app notifications. Written by the server only, never for your own actions.
 * "Due soon" and "overdue" are worked out when the list is read (nothing to schedule).
 */
import type { Hono } from "hono";
import { allTasks } from "@rakuplan/shared";
import type { Clock, Db, User } from "./ports";
import { loadRoom } from "./room";

export type NoticeKind = "mention" | "comment" | "assigned" | "invited" | "ai-low" | "credit-request" | "credit-answer" | "safety" | "support" | "status" | "company";

export interface Notice { userId: string; planId?: string | null; kind: NoticeKind; text: string; link: string }

export async function notify(db: Db, now: number, n: Notice, actorId?: string): Promise<void> {
  if (actorId && n.userId === actorId) return;
  await db.run(`INSERT INTO notifications (id, user_id, plan_id, kind, text, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [crypto.randomUUID(), n.userId, n.planId ?? null, n.kind, n.text.slice(0, 300), n.link, now]);
}

/**
 * Names on plans linked to accounts: set when availability is saved for a linked person, or when
 * someone accepts an invite made out to a name on the plan (and is still on it).
 */
const LINKS = `SELECT plan_id, name_key, user_id FROM plan_people WHERE user_id IS NOT NULL
  UNION SELECT i.plan_id, lower(i.person_name), i.accepted_by FROM invites i JOIN plan_members pm ON pm.plan_id = i.plan_id AND pm.user_id = i.accepted_by
  WHERE i.person_name IS NOT NULL AND i.accepted_by IS NOT NULL`;

/** The account linked to a name on a plan ("Priya" → Priya's user id), if any. */
export async function userForName(db: Db, planId: string, name: string | undefined): Promise<string | null> {
  if (!name) return null;
  return (await db.first<{ user_id: string }>(`SELECT user_id FROM (${LINKS}) WHERE plan_id = ? AND name_key = ?`, [planId, name.trim().toLowerCase()]))?.user_id ?? null;
}

export async function unreadCount(db: Db, userId: string): Promise<number> {
  return Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`, [userId]))?.n ?? 0);
}

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export function registerNotificationRoutes(app: Hono<{ Variables: { user: User } }>, d: { db: Db; clock: Clock }) {
  const { db, clock } = d;

  app.get("/api/notifications", async (c) => {
    const user = c.get("user");
    const rows = await db.all<{ id: string; plan_id: string | null; kind: string; text: string; link: string; created_at: number; read_at: number | null }>(
      `SELECT id, plan_id, kind, text, link, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY (read_at IS NULL) DESC, created_at DESC, rowid DESC LIMIT 100`,
      [user.id],
    );
    // Tasks given to your name on plans you can see, with a due date: overdue or due in the next 2 days.
    const today = clock.today();
    const soon = addDays(today, 2);
    const linked = await db.all<{ plan_id: string; name: string; title: string }>(
      `SELECT DISTINCT l.plan_id, l.name_key AS name, p.title FROM (${LINKS}) l JOIN plans p ON p.id = l.plan_id WHERE l.user_id = ?`,
      [user.id],
    );
    const due: { planId: string; planTitle: string; taskId: string; title: string; due: string; overdue: boolean }[] = [];
    for (const l of linked.slice(0, 50)) {
      const room = await loadRoom(db, l.plan_id);
      for (const t of room ? allTasks(room.plan) : []) {
        if (!t.due || t.milestone || t.status === "done" || t.status === "skipped" || t.owner?.trim().toLowerCase() !== l.name.toLowerCase()) continue;
        if (t.due <= soon) due.push({ planId: l.plan_id, planTitle: l.title, taskId: t.id, title: t.title, due: t.due, overdue: t.due < today });
      }
    }
    due.sort((a, b) => a.due.localeCompare(b.due));
    return c.json({
      unread: rows.filter((r) => r.read_at === null).length,
      due,
      items: rows.map((r) => ({ id: r.id, planId: r.plan_id, kind: r.kind, text: r.text, link: r.link, createdAt: Number(r.created_at), read: r.read_at !== null })),
    });
  });

  app.get("/api/notifications/count", async (c) => c.json({ unread: await unreadCount(db, c.get("user").id) }));

  app.post("/api/notifications/read", async (c) => {
    const user = c.get("user");
    const b = await c.req.json<{ ids?: unknown; all?: unknown }>().catch(() => null);
    if (b?.all === true) {
      await db.run(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`, [clock.now(), user.id]);
    } else if (Array.isArray(b?.ids) && b!.ids.length <= 100 && b!.ids.every((x) => typeof x === "string")) {
      for (const id of b!.ids as string[]) await db.run(`UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`, [clock.now(), id, user.id]);
    } else return c.json({ error: "Send { ids: [...] } or { all: true }." }, 400);
    return c.json({ ok: true, unread: await unreadCount(db, user.id) });
  });
}
