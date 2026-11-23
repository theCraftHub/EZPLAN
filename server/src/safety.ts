/**
 * The safety review queue for the owner's team (PLATFORM_ADMINS): plans held because the AI declined
 * them twice, or because screening flagged them. Only the flagged excerpt is shown (section 4c).
 */
import type { Hono } from "hono";
import type { Clock, Db, ServerConfig, User } from "./ports";
import { endAllSessions } from "./sessions";

export const isPlatformAdmin = (config: ServerConfig, user: User) => (config.platformAdmins ?? []).includes(user.email.toLowerCase());

export function registerSafetyRoutes(app: Hono<{ Variables: { user: User } }>, d: { db: Db; clock: Clock; config: ServerConfig }) {
  const { db, clock } = d;
  const refuse = { error: "Not found." };

  app.get("/api/admin/safety", async (c) => {
    const user = c.get("user");
    if (!isPlatformAdmin(d.config, user)) return c.json(refuse, 404); // invisible to everyone else
    const rows = await db.all<{ id: string; plan_id: string | null; title: string | null; feature: string; category: string | null; excerpt: string; status: string; note: string | null; name: string; email: string; decider: string | null; created_at: number; decided_at: number | null }>(
      `SELECT h.id, h.plan_id, p.title, h.feature, h.category, h.excerpt, h.status, h.note, u.name, u.email, dd.name AS decider, h.created_at, h.decided_at
       FROM safety_holds h JOIN users u ON u.id = h.user_id LEFT JOIN plans p ON p.id = h.plan_id LEFT JOIN users dd ON dd.id = h.decided_by
       ORDER BY (h.status = 'held') DESC, h.created_at DESC LIMIT 200`,
    );
    return c.json({ open: rows.filter((r) => r.status === "held").length, items: rows.map((r) => ({ id: r.id, planId: r.plan_id, planTitle: r.title, feature: r.feature, category: r.category, excerpt: r.excerpt, status: r.status, note: r.note, person: r.name, email: r.email, decidedBy: r.decider, createdAt: Number(r.created_at), decidedAt: r.decided_at === null ? null : Number(r.decided_at) })) });
  });

  app.post("/api/admin/safety/:id", async (c) => {
    const user = c.get("user");
    if (!isPlatformAdmin(d.config, user)) return c.json(refuse, 404);
    const h = await db.first<{ plan_id: string | null; user_id: string; status: string }>(`SELECT plan_id, user_id, status FROM safety_holds WHERE id = ?`, [c.req.param("id")]);
    if (!h) return c.json(refuse, 404);
    const b = await c.req.json<{ action?: unknown; note?: unknown }>().catch(() => null);
    const note = typeof b?.note === "string" ? b.note.trim().slice(0, 1000) : null;
    const action = b?.action;
    if (action !== "release" && action !== "keep" && action !== "suspend") return c.json({ error: "Choose release, keep or suspend." }, 400);
    if (action === "keep" && !note) return c.json({ error: "Add a note for the people on the plan." }, 400);
    const status = action === "release" ? "released" : action === "keep" ? "kept" : "suspended";
    await db.run(`UPDATE safety_holds SET status = ?, note = ?, decided_by = ?, decided_at = ? WHERE id = ?`, [status, note, user.id, clock.now(), c.req.param("id")]);
    if (action === "release" && h.plan_id) {
      // Other open holds on the same plan keep it held.
      const others = await db.first(`SELECT 1 AS x FROM safety_holds WHERE plan_id = ? AND status = 'held'`, [h.plan_id]);
      if (!others) await db.run(`UPDATE plans SET state = 'active' WHERE id = ?`, [h.plan_id]);
    }
    if (action === "suspend") {
      await db.run(`UPDATE users SET suspended_at = ? WHERE id = ?`, [clock.now(), h.user_id]);
      await endAllSessions(db, h.user_id);
    }
    return c.json({ ok: true, status });
  });
}
