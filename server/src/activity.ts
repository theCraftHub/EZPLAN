/** Writes and reads a plan's activity log. Lines are written by the server only. */
import type { ActivityLine } from "@rakuplan/shared";
import type { Db } from "./ports";

/** Quick repeats (same person, task and kind within 2 minutes) update the last line instead of adding one. */
const COLLAPSE_MS = 2 * 60_000;

export async function recordActivity(db: Db, planId: string, who: { userId: string; name: string } | { id: string; name: string }, line: ActivityLine | null, now: number): Promise<void> {
  if (!line) return;
  const actor = { userId: "userId" in who ? who.userId : who.id, name: who.name };
  const last = await db.first<{ id: string; actor_id: string; kind: string; task_id: string | null; created_at: number }>(
    `SELECT id, actor_id, kind, task_id, created_at FROM activity WHERE plan_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [planId],
  );
  if (last && line.taskId && last.actor_id === actor.userId && last.kind === line.kind && last.task_id === line.taskId && now - Number(last.created_at) < COLLAPSE_MS) {
    await db.run(`UPDATE activity SET summary = ?, created_at = ? WHERE id = ?`, [line.summary, now, last.id]);
    return;
  }
  await db.run(`INSERT INTO activity (id, plan_id, actor_id, actor_name, kind, task_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
    crypto.randomUUID(), planId, actor.userId, actor.name, line.kind, line.taskId ?? null, line.summary.slice(0, 300), now,
  ]);
}

export async function activityFor(db: Db, planId: string, before: number | undefined, limit = 50) {
  const rows = await db.all<{ id: string; actor_id: string; actor_name: string; kind: string; task_id: string | null; summary: string; created_at: number }>(
    `SELECT id, actor_id, actor_name, kind, task_id, summary, created_at FROM activity WHERE plan_id = ?${before ? " AND created_at < ?" : ""} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    before ? [planId, before, limit] : [planId, limit],
  );
  return rows.map((r) => ({ id: r.id, actorId: r.actor_id, actor: r.actor_name, kind: r.kind, taskId: r.task_id, summary: r.summary, at: Number(r.created_at) }));
}
