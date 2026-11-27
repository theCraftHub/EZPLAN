/**
 * The owner's Operations page (step M5, plan section 11): the service's health in one place, for the
 * platform admins only (PLATFORM_ADMINS). Unexpected server errors are kept here without request
 * bodies or personal data: the time, the route pattern (no IDs), and a cleaned-up message.
 */
import type { Hono } from "hono";
import type { Db, Clock, ServerConfig, User } from "./ports";
import { isPlatformAdmin } from "./safety";
import { supportOpen } from "./support";
import { auditBreak } from "./orgs";
import { MIGRATIONS } from "./migrations";

const DAY = 86_400_000;
const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Removes things that could identify someone (emails, long numbers, tokens) from an error message. */
export function scrub(message: string): string {
  return message
    .replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[token]")
    .replace(/\d{5,}/g, "[number]")
    .slice(0, 300);
}

export async function recordError(db: Db, now: number, method: string, route: string, err: unknown): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err));
  try {
    await db.run(`INSERT INTO server_errors (at, method, route, name, message) VALUES (?, ?, ?, ?, ?)`, [now, method, route.slice(0, 120), e.name.slice(0, 60), scrub(e.message)]);
    if (Math.random() < 0.02) await db.run(`DELETE FROM server_errors WHERE at < ?`, [now - 90 * DAY]);
  } catch { /* logging must never fail a request */ }
}

/** Counts an event for today (rate-limit refusals and the like). */
export async function countEvent(db: Db, now: number, kind: string): Promise<void> {
  try {
    await db.run(`INSERT INTO ops_events (day, kind, count) VALUES (?, ?, 1) ON CONFLICT (day, kind) DO UPDATE SET count = ops_events.count + 1`, [dayOf(now), kind]);
  } catch { /* never fail a request over a counter */ }
}

const n = async (db: Db, sql: string, params: unknown[] = []) => Number((await db.first<{ n: number }>(sql, params as never))?.n ?? 0);

export function registerOpsRoutes(app: Hono<{ Variables: { user: User } }>, d: { db: Db; clock: Clock; config: ServerConfig; mailOn: boolean }) {
  const { db, clock, config } = d;

  app.get("/api/ops", async (c) => {
    if (!isPlatformAdmin(config, c.get("user"))) return c.json({ error: "Not found." }, 404);
    const now = clock.now();
    const month = new Date(now).toISOString().slice(0, 7);
    const today = dayOf(now);
    const orgs = await db.all<{ id: string; name: string }>(`SELECT id, name FROM organizations ORDER BY created_at DESC LIMIT 500`);
    const broken: { id: string; name: string; at: number }[] = [];
    for (const o of orgs) {
      const at = await auditBreak(db, o.id);
      if (at !== null) broken.push({ ...o, at });
    }
    const ai = await db.first<{ calls: number; cost: number; input: number; output: number }>(`SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output FROM ai_usage WHERE month = ? AND status = 'ok'`, [month]);
    const applied = (await db.all<{ id: number }>(`SELECT id FROM schema_migrations ORDER BY id`)).map((r) => Number(r.id));
    const errors = await db.all<{ at: number; method: string; route: string; name: string; message: string }>(`SELECT at, method, route, name, message FROM server_errors ORDER BY at DESC LIMIT 50`);
    const byRoute = await db.all<{ route: string; method: string; n: number; last: number }>(`SELECT route, method, COUNT(*) AS n, MAX(at) AS last FROM server_errors WHERE at >= ? GROUP BY route, method ORDER BY n DESC LIMIT 20`, [now - 7 * DAY]);
    const events = await db.all<{ kind: string; count: number }>(`SELECT kind, count FROM ops_events WHERE day = ?`, [today]);
    const jobs = (await db.all<{ name: string; last_run: number; last_ok: number | null; last_error: string | null; runs: number }>(`SELECT * FROM job_runs ORDER BY name`)).map((j) => ({ name: j.name, lastRun: Number(j.last_run), lastOk: j.last_ok === null ? null : Number(j.last_ok), lastError: j.last_error, runs: Number(j.runs) }));
    return c.json({
      at: now,
      people: {
        total: await n(db, `SELECT COUNT(*) AS n FROM users`),
        active7: await n(db, `SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen_at >= ?`, [now - 7 * DAY]),
        active30: await n(db, `SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen_at >= ?`, [now - 30 * DAY]),
        suspended: await n(db, `SELECT COUNT(*) AS n FROM users WHERE suspended_at IS NOT NULL`),
      },
      companies: { total: await n(db, `SELECT COUNT(*) AS n FROM organizations`), live: await n(db, `SELECT COUNT(*) AS n FROM organizations WHERE onboarding LIKE '%"done":true%'`), auditBroken: broken },
      plans: {
        active: await n(db, `SELECT COUNT(*) AS n FROM plans WHERE state = 'active'`),
        archived: await n(db, `SELECT COUNT(*) AS n FROM plans WHERE state = 'archived'`),
        review: await n(db, `SELECT COUNT(*) AS n FROM plans WHERE state = 'review'`),
        changedToday: await n(db, `SELECT COUNT(*) AS n FROM plans WHERE updated_at >= ?`, [now - DAY]),
      },
      ai: { month, calls: Number(ai?.calls ?? 0), costUsd: Math.round(Number(ai?.cost ?? 0) * 100) / 100, inputTokens: Number(ai?.input ?? 0), outputTokens: Number(ai?.output ?? 0) },
      email: {
        waiting: await n(db, `SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'off'`),
        sent: await n(db, `SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'sent' AND created_at >= ?`, [now - 7 * DAY]),
        failed: await n(db, `SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'failed' AND created_at >= ?`, [now - 7 * DAY]),
        sending: d.mailOn,
      },
      queues: { safety: await n(db, `SELECT COUNT(*) AS n FROM safety_holds WHERE status = 'held'`), support: await supportOpen(db) },
      limits: { refusedToday: events.filter((e) => e.kind.startsWith("rate:")).reduce((s, e) => s + Number(e.count), 0), byRule: Object.fromEntries(events.filter((e) => e.kind.startsWith("rate:")).map((e) => [e.kind.slice(5), Number(e.count)])) },
      jobs,
      database: { migrations: applied.length, latest: applied.at(-1) ?? 0, expected: MIGRATIONS.length, upToDate: applied.length === MIGRATIONS.length },
      errors: {
        last24h: await n(db, `SELECT COUNT(*) AS n FROM server_errors WHERE at >= ?`, [now - DAY]),
        recent: errors.map((e) => ({ ...e, at: Number(e.at) })),
        byRoute: byRoute.map((r) => ({ ...r, n: Number(r.n), last: Number(r.last) })),
      },
    });
  });
}
