/**
 * Time logging (step N4): hours worked on a task, by person and day. Editors log their own time;
 * managers can log for someone else and remove any entry; everyone on the plan can read it. Hours
 * against estimates and, with hourly rates, actual cost come from these entries. CSV export has
 * formulas neutralized.
 */
import type { Hono } from "hono";
import { allTasks, sameName } from "@rakuplan/shared";
import type { Clock, Db, User } from "./ports";
import type { Role } from "./roles";
import { canEdit } from "./roles";
import { loadRoom } from "./room";
import { recordActivity } from "./activity";

export interface TimeDeps {
  db: Db;
  clock: Clock;
  notFound: { error: string };
  access: (planId: string, userId: string) => Promise<{ role: Role; title: string } | null>;
}

type Row = { id: string; task_id: string; user_id: string; person: string; date: string; minutes: number; note: string | null; created_at: number };

const cell = (v: unknown) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };

export function registerTimeRoutes(app: Hono<{ Variables: { user: User } }>, d: TimeDeps) {
  const { db, clock } = d;
  const entries = async (planId: string) => db.all<Row>(`SELECT id, task_id, user_id, person, date, minutes, note, created_at FROM time_logs WHERE plan_id = ? ORDER BY date DESC, created_at DESC LIMIT 5000`, [planId]);

  app.get("/api/plans/:id/time", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    const rows = await entries(id);
    return c.json({
      canLog: canEdit(a.role), manager: a.role === "manager",
      entries: rows.map((r) => ({ id: r.id, taskId: r.task_id, person: r.person, date: r.date, minutes: Number(r.minutes), note: r.note, mine: r.user_id === user.id })),
    });
  });

  app.post("/api/plans/:id/time", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "You can view this plan but not log time on it." }, 403);
    const b = await c.req.json<{ taskId?: unknown; date?: unknown; hours?: unknown; note?: unknown; person?: unknown }>().catch(() => null);
    const room = await loadRoom(db, id);
    const task = room ? allTasks(room.plan).find((t) => t.id === b?.taskId) : undefined;
    if (!task) return c.json({ error: "That task isn't in this plan." }, 400);
    const hours = Number(b?.hours);
    if (!(hours >= 0.25 && hours <= 24) || Math.round(hours * 4) !== hours * 4) return c.json({ error: "Log a quarter hour to 24 hours (like 1.5 or 0.25)." }, 400);
    const date = typeof b?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
    if (!date || date > clock.today()) return c.json({ error: "Choose a day up to today." }, 400);
    // You log your own time, under the name the plan uses for you (the task's owner if that's you).
    // Managers may log for someone else.
    const other = typeof b?.person === "string" ? b.person.trim().slice(0, 80) : "";
    if (other && !sameName(other, user.name) && a.role !== "manager") return c.json({ error: "Only managers can log time for someone else." }, 403);
    const person = other || (task.owner && sameName(task.owner, user.name) ? task.owner : user.name);
    const note = typeof b?.note === "string" ? b.note.trim().slice(0, 300) || null : null;
    const entryId = crypto.randomUUID();
    await db.run(`INSERT INTO time_logs (id, plan_id, task_id, user_id, person, date, minutes, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [entryId, id, task.id, user.id, person, date, Math.round(hours * 60), note, clock.now()]);
    await recordActivity(db, id, user, { kind: "edit", taskId: task.id, summary: `${user.name} logged ${hours} h on ${task.title}${person !== user.name && !sameName(person, user.name) ? ` for ${person}` : ""}` }, clock.now());
    return c.json({ id: entryId }, 201);
  });

  app.delete("/api/plans/:id/time/:entryId", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    const row = await db.first<{ user_id: string }>(`SELECT user_id FROM time_logs WHERE id = ? AND plan_id = ?`, [c.req.param("entryId"), id]);
    if (!row) return c.json({ error: "That entry is already gone." }, 404);
    if (row.user_id !== user.id && a.role !== "manager") return c.json({ error: "Only the person who logged it, or a manager, can remove it." }, 403);
    if (!canEdit(a.role)) return c.json({ error: "You can view this plan but not change it." }, 403);
    await db.run(`DELETE FROM time_logs WHERE id = ?`, [c.req.param("entryId")]);
    return c.json({ ok: true });
  });

  app.get("/api/plans/:id/time.csv", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    const room = await loadRoom(db, id);
    const title = new Map(room ? allTasks(room.plan).map((t) => [t.id, t.title]) : []);
    const csv = ["Date,Person,Task ID,Task,Hours,Note", ...(await entries(id)).map((r) => [r.date, r.person, r.task_id, title.get(r.task_id) ?? "(deleted task)", Number(r.minutes) / 60, r.note ?? ""].map(cell).join(","))].join("\r\n");
    const name = (a.title.replace(/[^\w .-]+/g, "").trim() || "plan").slice(0, 80);
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name} time.csv"` } });
  });
}
