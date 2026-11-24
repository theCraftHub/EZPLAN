/**
 * Per-person settings that follow someone across devices (step J2: the desktop Overview's widget
 * order and hidden widgets). Small JSON values by key; each person sees only their own.
 */
import type { Hono } from "hono";
import type { Clock, Db, User } from "./ports";

const KEY = /^[a-z0-9][a-z0-9.-]{0,39}$/;
const MAX_BYTES = 4096;

export function registerPrefRoutes(app: Hono<{ Variables: { user: User } }>, d: { db: Db; clock: Clock }) {
  app.get("/api/me/prefs/:key", async (c) => {
    const key = c.req.param("key");
    if (!KEY.test(key)) return c.json({ error: "Unknown setting." }, 400);
    const row = await d.db.first<{ value: string }>(`SELECT value FROM user_prefs WHERE user_id = ? AND key = ?`, [c.get("user").id, key]);
    return c.json({ value: row ? JSON.parse(row.value) : null });
  });

  app.put("/api/me/prefs/:key", async (c) => {
    const key = c.req.param("key");
    if (!KEY.test(key)) return c.json({ error: "Unknown setting." }, 400);
    const b = await c.req.json<{ value?: unknown }>().catch(() => null);
    if (!b || !("value" in b)) return c.json({ error: "Send { value }." }, 400);
    const text = JSON.stringify(b.value ?? null);
    if (text.length > MAX_BYTES) return c.json({ error: "That setting is too large." }, 413);
    await d.db.run(
      `INSERT INTO user_prefs (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [c.get("user").id, key, text, d.clock.now()],
    );
    return c.json({ ok: true });
  });
}
