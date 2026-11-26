/**
 * The risk log (step J3, "RAID": risks, assumptions, issues, decisions) for each plan. Everyone on
 * the plan reads it; editors and managers add, change, close and delete. Risks carry likelihood and
 * impact (1 to 5) for the heat map; any item can point at tasks in the plan. Text is screened like
 * comments, and every change writes an activity line.
 */
import type { Hono } from "hono";
import { allTasks, freeModeration } from "@rakuplan/shared";
import type { Clock, Db, User } from "./ports";
import { canEdit, type Role } from "./roles";
import { loadRoom } from "./room";
import { recordActivity } from "./activity";

const KINDS = ["risk", "assumption", "issue", "decision"] as const;
type Kind = (typeof KINDS)[number];
const WORD: Record<Kind, string> = { risk: "a risk", assumption: "an assumption", issue: "an issue", decision: "a decision" };

export interface RaidDeps {
  db: Db;
  clock: Clock;
  access: (planId: string, userId: string) => Promise<{ role: Role } | null>;
  notFound: { error: string };
}

type Row = { id: string; kind: Kind; title: string; detail: string; owner: string | null; likelihood: number | null; impact: number | null; status: "open" | "closed"; due: string | null; task_ids: string; created_by: string; author: string; created_at: number; updated_at: number };
const view = (r: Row) => ({ id: r.id, kind: r.kind, title: r.title, detail: r.detail, owner: r.owner, likelihood: r.likelihood === null ? null : Number(r.likelihood), impact: r.impact === null ? null : Number(r.impact), status: r.status, due: r.due, taskIds: JSON.parse(r.task_ids) as string[], createdBy: r.author, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) });

/** Open risks and issues, for the dashboard. */
export async function raidOpen(db: Db, planId: string): Promise<{ risks: number; issues: number }> {
  const rows = await db.all<{ kind: string; n: number }>(`SELECT kind, COUNT(*) AS n FROM raid_items WHERE plan_id = ? AND status = 'open' AND kind IN ('risk', 'issue') GROUP BY kind`, [planId]);
  const n = (k: string) => Number(rows.find((r) => r.kind === k)?.n ?? 0);
  return { risks: n("risk"), issues: n("issue") };
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");
const score = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5 ? (v as number) : null);

export function registerRaidRoutes(app: Hono<{ Variables: { user: User } }>, d: RaidDeps) {
  const { db, clock } = d;

  /** Checks and cleans an item; `base` is the current item when changing one. */
  async function clean(planId: string, b: Record<string, unknown>, base?: ReturnType<typeof view>) {
    const kind = (b.kind === undefined && base ? base.kind : KINDS.includes(b.kind as Kind) ? b.kind : null) as Kind | null;
    if (!kind) return { error: "Choose risk, assumption, issue or decision." };
    const title = b.title === undefined && base ? base.title : text(b.title, 200);
    if (!title) return { error: "Add a short title." };
    const detail = b.detail === undefined && base ? base.detail : text(b.detail, 4000);
    const owner = b.owner === undefined && base ? base.owner : text(b.owner, 80) || null;
    const status = b.status === undefined ? base?.status ?? "open" : b.status === "closed" ? "closed" : b.status === "open" ? "open" : null;
    if (!status) return { error: "Status is open or closed." };
    const due = b.due === undefined && base ? base.due : typeof b.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : b.due === null || b.due === undefined || b.due === "" ? null : undefined;
    if (due === undefined) return { error: "Use a date like 2027-03-01 for the due date." };
    // Likelihood and impact belong to risks (impact also helps rank issues).
    const likelihood = kind === "risk" ? (b.likelihood === undefined && base ? base.likelihood : score(b.likelihood)) : null;
    const impact = kind === "risk" || kind === "issue" ? (b.impact === undefined && base ? base.impact : score(b.impact)) : null;
    if (kind === "risk" && (!likelihood || !impact)) return { error: "Rate the risk's likelihood and impact from 1 to 5." };
    const room = await loadRoom(db, planId);
    const known = new Set(room ? allTasks(room.plan).map((t) => t.id) : []);
    const raw = b.taskIds === undefined && base ? base.taskIds : Array.isArray(b.taskIds) ? b.taskIds : [];
    const taskIds = [...new Set(raw.filter((x): x is string => typeof x === "string" && known.has(x)))].slice(0, 20);
    if (freeModeration([title, detail, owner ?? ""].join("\n")).verdict !== "allow") return { error: "This can't be saved because it may break the Acceptable Use Policy.", status: 422 as const };
    return { item: { kind, title, detail, owner, likelihood, impact, status, due, taskIds } };
  }

  const one = (planId: string, id: string) =>
    db.first<Row>(`SELECT r.*, u.name AS author FROM raid_items r JOIN users u ON u.id = r.created_by WHERE r.plan_id = ? AND r.id = ?`, [planId, id]);

  app.get("/api/plans/:id/raid", async (c) => {
    const id = c.req.param("id");
    const a = await d.access(id, c.get("user").id);
    if (!a) return c.json(d.notFound, 404);
    const rows = await db.all<Row>(`SELECT r.*, u.name AS author FROM raid_items r JOIN users u ON u.id = r.created_by WHERE r.plan_id = ? ORDER BY (r.status = 'open') DESC, r.updated_at DESC LIMIT 500`, [id]);
    return c.json({ canEdit: canEdit(a.role), items: rows.map(view), open: await raidOpen(db, id) });
  });

  app.post("/api/plans/:id/raid", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "Only editors and managers can change the risk log." }, 403);
    const r = await clean(id, (await c.req.json<Record<string, unknown>>().catch(() => null)) ?? {});
    if ("error" in r) return c.json({ error: r.error }, r.status ?? 400);
    const now = clock.now();
    const itemId = crypto.randomUUID();
    const it = r.item;
    await db.run(
      `INSERT INTO raid_items (id, plan_id, kind, title, detail, owner, likelihood, impact, status, due, task_ids, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [itemId, id, it.kind, it.title, it.detail, it.owner, it.likelihood, it.impact, it.status, it.due, JSON.stringify(it.taskIds), user.id, now, now],
    );
    await recordActivity(db, id, user, { kind: "raid", summary: `${user.name} added ${WORD[it.kind]} to the risk log: ${it.title.slice(0, 80)}` }, now);
    return c.json({ item: view((await one(id, itemId))!) }, 201);
  });

  app.patch("/api/plans/:id/raid/:itemId", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "Only editors and managers can change the risk log." }, 403);
    const row = await one(id, c.req.param("itemId"));
    if (!row) return c.json({ error: "That item isn't in this plan's risk log." }, 404);
    const before = view(row);
    const r = await clean(id, (await c.req.json<Record<string, unknown>>().catch(() => null)) ?? {}, before);
    if ("error" in r) return c.json({ error: r.error }, r.status ?? 400);
    const it = r.item;
    const now = clock.now();
    await db.run(`UPDATE raid_items SET kind = ?, title = ?, detail = ?, owner = ?, likelihood = ?, impact = ?, status = ?, due = ?, task_ids = ?, updated_at = ? WHERE id = ?`, [it.kind, it.title, it.detail, it.owner, it.likelihood, it.impact, it.status, it.due, JSON.stringify(it.taskIds), now, row.id]);
    const what = before.status !== it.status ? (it.status === "closed" ? "closed" : "reopened") : "changed";
    await recordActivity(db, id, user, { kind: "raid", summary: `${user.name} ${what} ${WORD[it.kind]} in the risk log: ${it.title.slice(0, 80)}` }, now);
    return c.json({ item: view((await one(id, row.id))!) });
  });

  app.delete("/api/plans/:id/raid/:itemId", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "Only editors and managers can change the risk log." }, 403);
    const row = await one(id, c.req.param("itemId"));
    if (!row) return c.json({ error: "That item isn't in this plan's risk log." }, 404);
    await db.run(`DELETE FROM raid_items WHERE id = ?`, [row.id]);
    await recordActivity(db, id, user, { kind: "raid", summary: `${user.name} deleted ${WORD[row.kind]} from the risk log: ${row.title.slice(0, 80)}` }, clock.now());
    return c.json({ ok: true });
  });
}
