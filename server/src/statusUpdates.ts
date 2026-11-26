/**
 * Status updates (step J1): red / amber / green, a headline and sections, posted from the Status
 * report (template or AI-worded) and kept as the plan's history. An update is "overdue" when the
 * last one is more than 7 days old, or the plan is over 7 days old and has none (section 1b).
 * Everyone on the plan reads them; editors and managers post.
 */
import type { Hono } from "hono";
import { freeModeration } from "@rakuplan/shared";
import type { Clock, Db, User } from "./ports";
import { canEdit, type Role } from "./roles";
import { notify } from "./notify";
import { planPeople } from "./comments";
import { recordActivity } from "./activity";

export const UPDATE_EVERY_DAYS = 7;
const DAY = 86_400_000;
const RAGS = ["green", "amber", "red"] as const;
export type Rag = (typeof RAGS)[number];

export interface StatusDeps {
  db: Db;
  clock: Clock;
  access: (planId: string, userId: string) => Promise<{ role: Role } | null>;
  notFound: { error: string };
}

/** The latest update and whether one is due, for the plan page and Home. */
export async function updateState(db: Db, now: number, planId: string): Promise<{ last: { rag: Rag; headline: string; at: number } | null; overdue: boolean }> {
  const last = await db.first<{ rag: Rag; headline: string; created_at: number }>(`SELECT rag, headline, created_at FROM status_updates WHERE plan_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, [planId]);
  const since = last ? Number(last.created_at) : Number((await db.first<{ created_at: number }>(`SELECT created_at FROM plans WHERE id = ?`, [planId]))?.created_at ?? now);
  return { last: last ? { rag: last.rag, headline: last.headline, at: Number(last.created_at) } : null, overdue: now - since > UPDATE_EVERY_DAYS * DAY };
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

export function registerStatusUpdateRoutes(app: Hono<{ Variables: { user: User } }>, d: StatusDeps) {
  const { db, clock } = d;

  app.get("/api/plans/:id/status-updates", async (c) => {
    const id = c.req.param("id");
    const a = await d.access(id, c.get("user").id);
    if (!a) return c.json(d.notFound, 404);
    const rows = await db.all<{ id: string; rag: Rag; headline: string; sections: string; source: string; name: string; created_at: number }>(
      `SELECT s.id, s.rag, s.headline, s.sections, s.source, u.name, s.created_at FROM status_updates s JOIN users u ON u.id = s.author_id WHERE s.plan_id = ? ORDER BY s.created_at DESC, s.rowid DESC LIMIT 100`,
      [id],
    );
    const state = await updateState(db, clock.now(), id);
    return c.json({
      canPost: canEdit(a.role),
      overdue: state.overdue,
      dueEveryDays: UPDATE_EVERY_DAYS,
      items: rows.map((r) => ({ id: r.id, rag: r.rag, headline: r.headline, sections: JSON.parse(r.sections) as { title: string; text: string }[], source: r.source, author: r.name, createdAt: Number(r.created_at) })),
    });
  });

  app.post("/api/plans/:id/status-updates", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "Only editors and managers can post status updates." }, 403);
    const b = await c.req.json<Record<string, unknown>>().catch(() => null);
    const rag = RAGS.includes(b?.rag as Rag) ? (b!.rag as Rag) : null;
    const headline = clean(b?.headline, 200);
    const sections = (Array.isArray(b?.sections) ? b!.sections : [])
      .slice(0, 10)
      .map((s) => ({ title: clean((s as Record<string, unknown>)?.title, 80), text: clean((s as Record<string, unknown>)?.text, 2000) }))
      .filter((s) => s.title && s.text);
    if (!rag) return c.json({ error: "Choose green, amber or red." }, 400);
    if (!headline) return c.json({ error: "Add a headline." }, 400);
    if (freeModeration([headline, ...sections.flatMap((s) => [s.title, s.text])].join("\n")).verdict !== "allow") return c.json({ error: "This update can't be posted because it may break the Acceptable Use Policy." }, 422);
    const source = b?.source === "ai" ? "ai" : "template";
    const now = clock.now();
    const updateId = crypto.randomUUID();
    await db.run(`INSERT INTO status_updates (id, plan_id, rag, headline, sections, source, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [updateId, id, rag, headline, JSON.stringify(sections), source, user.id, now]);
    const word = { green: "a green", amber: "an amber", red: "a red" }[rag];
    const title = (await db.first<{ title: string }>(`SELECT title FROM plans WHERE id = ?`, [id]))?.title ?? "a plan";
    await recordActivity(db, id, user, { kind: "status-update", summary: `${user.name} posted ${word} status update: ${headline.slice(0, 80)}` }, now);
    for (const p of await planPeople(db, id)) await notify(db, now, { userId: p.userId, planId: id, kind: "status", text: `${user.name} posted ${word} status update on ${title}: ${headline.slice(0, 120)}`, link: `/p/${id}/report` }, user.id);
    return c.json({ id: updateId }, 201);
  });
}
