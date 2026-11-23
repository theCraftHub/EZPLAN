/**
 * AI endpoints: Plan Check, "don't suggest this again", status reports, usage and limits, holds.
 * Every AI call goes through the refusal rule (one retry on the same model, then held for review)
 * and is logged with its cost.
 */
import type { Hono } from "hono";
import {
  detectInjection,
  exportPlan,
  filterReview,
  levelPlan,
  onlyKnownNumbers,
  progressOf,
  statusFacts,
  templateReport,
  type ModerationVerdict,
  type PersonAvailability,
  type Plan,
  type SuggestionKind,
  type Suppression,
  type WorkWeek,
} from "@ezplan/shared";
import type { StoredRoomState } from "../room";
import { sha256 } from "../sessions";
import { DEFAULT_AI_LIMITS, type Clock, type Db, type ServerConfig, type User } from "../ports";
import { costUsd, withRefusalRule, type AiEngine, type AiResult } from "./engine";

import { canEdit, type Role } from "../roles";
import { notify } from "../notify";
type Access = { workspace_id: string; role: Role } | null;
export type Feature = "check" | "report" | "moderation";

export interface AiDeps {
  db: Db;
  clock: Clock;
  config: ServerConfig;
  ai: AiEngine | undefined;
  access(planId: string, userId: string): Promise<Access>;
  loadRoom(planId: string): Promise<StoredRoomState | null>;
  loadPeople(planId: string): Promise<Record<string, PersonAvailability>>;
  workWeekOf(workspaceId: string): Promise<WorkWeek>;
}

const KINDS: SuggestionKind[] = ["missingStep", "risk", "suggestion", "tip"];
export const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);
const nextMonthStart = (now: number) => {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
};

export function aiService(d: AiDeps) {
  const limits = d.config.aiLimits ?? DEFAULT_AI_LIMITS;
  const { db, clock } = d;

  async function allowance(ws: string, userId: string) {
    const rows = await db.all<{ user_id: string; monthly_checks: number; monthly_reports: number }>(`SELECT user_id, monthly_checks, monthly_reports FROM ai_allowances WHERE workspace_id = ? AND user_id IN (?, '*')`, [ws, userId]);
    const own = rows.find((r) => r.user_id === userId) ?? rows.find((r) => r.user_id === "*");
    const extra = await db.first<{ c: number | null; r: number | null }>(`SELECT SUM(checks) AS c, SUM(reports) AS r FROM ai_credit_grants WHERE workspace_id = ? AND user_id = ? AND month = ?`, [ws, userId, monthOf(clock.now())]);
    return {
      checks: Number(own?.monthly_checks ?? limits.checksPerPerson) + Number(extra?.c ?? 0),
      reports: Number(own?.monthly_reports ?? limits.reportsPerPerson) + Number(extra?.r ?? 0),
    };
  }

  async function used(ws: string, userId: string | null) {
    const rows = await db.all<{ feature: string; n: number }>(
      `SELECT feature, COUNT(*) AS n FROM ai_usage WHERE workspace_id = ? AND month = ? AND status = 'ok' AND feature IN ('check', 'report')${userId ? " AND user_id = ?" : ""} GROUP BY feature`,
      userId ? [ws, monthOf(clock.now()), userId] : [ws, monthOf(clock.now())],
    );
    return { checks: Number(rows.find((r) => r.feature === "check")?.n ?? 0), reports: Number(rows.find((r) => r.feature === "report")?.n ?? 0) };
  }

  async function pool(ws: string) {
    const extra = await db.first<{ c: number | null; r: number | null }>(`SELECT SUM(checks) AS c, SUM(reports) AS r FROM ai_credit_grants WHERE workspace_id = ? AND user_id IS NULL AND month = ?`, [ws, monthOf(clock.now())]);
    const total = { checks: limits.poolChecks + Number(extra?.c ?? 0), reports: limits.poolReports + Number(extra?.r ?? 0) };
    return { total, used: await used(ws, null) };
  }

  /** What this person has left here this month, and whether the workspace pool has room. */
  async function usage(ws: string, userId: string) {
    const [limit, mine, p] = await Promise.all([allowance(ws, userId), used(ws, userId), pool(ws)]);
    return { checks: { used: mine.checks, limit: limit.checks }, reports: { used: mine.reports, limit: limit.reports }, poolLeft: { checks: p.total.checks - p.used.checks, reports: p.total.reports - p.used.reports }, resets: nextMonthStart(clock.now()) };
  }

  async function blockedBy(ws: string, userId: string, feature: "check" | "report"): Promise<string | null> {
    const u = await usage(ws, userId);
    const mine = feature === "check" ? u.checks : u.reports;
    const word = feature === "check" ? "AI checks" : "AI reports";
    if (mine.used >= mine.limit) return `You've used all ${mine.limit} ${word} for this month. They reset on ${u.resets}; you can ask a manager for more in Settings.`;
    if ((feature === "check" ? u.poolLeft.checks : u.poolLeft.reports) <= 0) return `This workspace has used all its ${word} for this month. A manager can add more in Settings.`;
    return null;
  }

  async function log(user: User, ws: string, planId: string | null, feature: Feature, r: AiResult<unknown>, status?: string) {
    const u = r.usage;
    if (!u) return;
    await db.run(
      `INSERT INTO ai_usage (id, user_id, plan_id, workspace_id, feature, model, input_tokens, output_tokens, cost_usd, status, month, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), user.id, planId, ws, feature, u.model, u.inputTokens, u.outputTokens, costUsd(u), status ?? (r.ok ? "ok" : r.reason), monthOf(clock.now()), clock.now()],
    );
    if (r.ok && !status && (feature === "check" || feature === "report")) await warnIfLow(user, ws, planId, feature);
  }

  /** Once a month, the first time someone passes 80% of an allowance: a notice with the way to ask for more. */
  async function warnIfLow(user: User, ws: string, planId: string | null, feature: "check" | "report") {
    const u = await usage(ws, user.id);
    const mine = feature === "check" ? u.checks : u.reports;
    if (!mine.limit || mine.used / mine.limit < 0.8) return;
    const monthStart = Date.parse(`${monthOf(clock.now())}-01T00:00:00Z`);
    if (await db.first(`SELECT 1 AS x FROM notifications WHERE user_id = ? AND kind = 'ai-low' AND created_at >= ?`, [user.id, monthStart])) return;
    const left = Math.max(0, mine.limit - mine.used);
    await notify(db, clock.now(), { userId: user.id, planId, kind: "ai-low", text: `AI ${feature === "check" ? "checks" : "reports"} are running low: ${left} of ${mine.limit} left this month. You can ask for more.`, link: planId ? `/p/${planId}` : "/settings" });
  }

  /** Declined twice: the plan stops using AI, sharing and exports until the owner's team reviews it. */
  async function hold(planId: string | null, user: User, feature: Feature, category: string | null | undefined, excerpt: string) {
    if (planId) await db.run(`UPDATE plans SET state = 'review' WHERE id = ?`, [planId]);
    await db.run(`INSERT INTO safety_holds (id, plan_id, user_id, feature, category, excerpt, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'held', ?)`, [crypto.randomUUID(), planId, user.id, feature, category ?? null, excerpt.slice(0, 600), clock.now()]);
  }

  /** The AI moderation layer for imports (free checks have already run). Cached by text. */
  function moderator(user: User, ws: string) {
    if (!d.ai) return undefined;
    const ai = d.ai;
    return async (text: string): Promise<ModerationVerdict> => {
      const key = await sha256(text);
      const cached = await db.first<{ verdict: string }>(`SELECT verdict FROM ai_moderation_cache WHERE text_hash = ?`, [key]);
      if (cached) return JSON.parse(cached.verdict) as ModerationVerdict;
      const { result, held, attempts } = await withRefusalRule(() => ai.moderate(text));
      for (const a of attempts) await log(user, ws, null, "moderation", a);
      if (held) return { verdict: "review", category: `declined by AI (${(!result.ok && result.category) || "unspecified"})`, reason: "The AI screening declined this plan twice, so it's held for a safety review." };
      if (!result.ok) return { verdict: "allow" }; // an outage never blocks an import; the free checks already ran
      await db.run(`INSERT INTO ai_moderation_cache (text_hash, verdict, created_at) VALUES (?, ?, ?) ON CONFLICT (text_hash) DO NOTHING`, [key, JSON.stringify(result.value), clock.now()]);
      return result.value;
    };
  }

  return { usage, blockedBy, log, hold, moderator, pool, allowance, used };
}

export type AiService = ReturnType<typeof aiService>;

const notFound = { error: "This plan doesn't exist or you don't have access to it." };
const heldMessage = "This plan is waiting for a safety review. AI features, sharing and exports are paused until then; everything else works.";

export function registerAiRoutes(app: Hono<{ Variables: { user: User } }>, d: AiDeps, svc: AiService) {
  const { db, clock } = d;
  const stateOf = async (id: string) => (await db.first<{ state: string }>(`SELECT state FROM plans WHERE id = ?`, [id]))?.state ?? "active";
  const suppressionsOf = async (id: string) =>
    (await db.all<{ id: string; kind: SuggestionKind; text: string; task_ids: string; name: string | null; created_at: number }>(`SELECT s.id, s.kind, s.text, s.task_ids, u.name, s.created_at FROM ai_suppressions s LEFT JOIN users u ON u.id = s.created_by WHERE s.plan_id = ? ORDER BY s.created_at DESC`, [id])).map((s) => ({ id: s.id, kind: s.kind, text: s.text, taskIds: JSON.parse(s.task_ids) as string[], by: s.name ?? "Someone", createdAt: Number(s.created_at) }));

  app.get("/api/plans/:id/ai", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(notFound, 404);
    const row = await db.first<{ plan_version: number; result: string; hidden: number; created_at: number; name: string | null }>(`SELECT r.plan_version, r.result, r.hidden, r.created_at, u.name FROM ai_reviews r LEFT JOIN users u ON u.id = r.created_by WHERE r.plan_id = ?`, [id]);
    const room = await d.loadRoom(id);
    return c.json({
      enabled: !!d.ai,
      workspaceId: a.workspace_id,
      held: (await stateOf(id)) === "review",
      review: row ? { result: JSON.parse(row.result), planVersion: Number(row.plan_version), hidden: Number(row.hidden), createdAt: Number(row.created_at), by: row.name ?? "Someone", changedSince: (room?.seq ?? 0) !== Number(row.plan_version) } : null,
      suppressions: await suppressionsOf(id),
      usage: await svc.usage(a.workspace_id, user.id),
    });
  });

  app.post("/api/plans/:id/ai/check", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "Only people who can edit this plan can run AI checks." }, 403);
    if (!d.ai) return c.json({ error: "AI checks are off on this server. The free Plan Check still works." }, 503);
    if ((await stateOf(id)) === "review") return c.json({ error: heldMessage }, 423);
    const limit = await svc.blockedBy(a.workspace_id, user.id, "check");
    if (limit) return c.json({ error: limit }, 429);
    const room = await d.loadRoom(id);
    if (!room) return c.json(notFound, 404);
    const planText = exportPlan(room.plan);
    const declined: Suppression[] = (await suppressionsOf(id)).map((s) => ({ kind: s.kind, text: s.text, taskIds: s.taskIds }));
    const ai = d.ai;
    const { result, held, attempts } = await withRefusalRule(() => ai.review({ planText, declined, injectionFlags: detectInjection(planText) }));
    for (const r of attempts) await svc.log(user, a.workspace_id, id, "check", r);
    if (held) {
      await svc.hold(id, user, "check", !result.ok ? result.category : null, planText);
      return c.json({ error: heldMessage, held: true }, 423);
    }
    if (!result.ok) return c.json({ error: result.message }, 502);
    // The server enforces "don't suggest this again", whatever the AI sent back.
    const { review, hidden } = filterReview({ ...result.value, goalFit: { ...result.value.goalFit, score: Math.max(0, Math.min(100, Math.round(result.value.goalFit.score))) } }, declined);
    await db.run(
      `INSERT INTO ai_reviews (plan_id, plan_version, result, hidden, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (plan_id) DO UPDATE SET plan_version = excluded.plan_version, result = excluded.result, hidden = excluded.hidden, created_by = excluded.created_by, created_at = excluded.created_at`,
      [id, room.seq, JSON.stringify(review), hidden, user.id, clock.now()],
    );
    return c.json({ review, hidden, planVersion: room.seq, injectionFlags: detectInjection(planText).length, usage: await svc.usage(a.workspace_id, user.id) });
  });

  app.post("/api/plans/:id/ai/suppressions", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "Only people who can edit this plan can change its suggestions." }, 403);
    const b = await c.req.json<{ kind?: unknown; text?: unknown; taskIds?: unknown }>().catch(() => null);
    const kind = b?.kind as SuggestionKind;
    const text = typeof b?.text === "string" ? b.text.trim() : "";
    const taskIds = Array.isArray(b?.taskIds) ? (b!.taskIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length <= 64).slice(0, 20) : [];
    if (!KINDS.includes(kind) || !text || text.length > 500) return c.json({ error: "That suggestion can't be hidden." }, 400);
    const sid = crypto.randomUUID();
    await db.run(`INSERT INTO ai_suppressions (id, plan_id, kind, text, task_ids, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [sid, id, kind, text, JSON.stringify(taskIds), user.id, clock.now()]);
    return c.json({ id: sid }, 201);
  });

  app.delete("/api/plans/:id/ai/suppressions/:sid", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a.role)) return c.json({ error: "Only people who can edit this plan can change its suggestions." }, 403);
    const r = await db.run(`DELETE FROM ai_suppressions WHERE id = ? AND plan_id = ?`, [c.req.param("sid"), id]);
    return r.changes ? c.json({ ok: true }) : c.json({ error: "Not found." }, 404);
  });

  // Status report: facts from the plan; AI (the cheaper report model) only rewords them.
  app.post("/api/plans/:id/report", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(notFound, 404);
    const b = await c.req.json<{ since?: unknown; ai?: unknown }>().catch(() => ({}) as { since?: unknown; ai?: unknown });
    const room = await d.loadRoom(id);
    if (!room) return c.json(notFound, 404);
    const today = clock.today();
    const people = await d.loadPeople(id);
    const workWeek = await d.workWeekOf(a.workspace_id);
    const schedule = levelPlan(room.plan as Plan, { workWeek, today, people });
    const since = typeof b?.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.since) ? b.since : undefined;
    const facts = statusFacts(room.plan, schedule, progressOf(room.plan, schedule, { workWeek, today }), { today, ...(since ? { since } : {}) });
    const template = templateReport(facts);
    if (b?.ai !== true) return c.json({ facts, text: template, source: "template" });
    if (!canEdit(a.role)) return c.json({ error: "Only people who can edit this plan can run AI reports." }, 403);
    if (!d.ai) return c.json({ facts, text: template, source: "template", note: "AI wording is off on this server, so this is the plain version." });
    if ((await stateOf(id)) === "review") return c.json({ error: heldMessage }, 423);
    const limit = await svc.blockedBy(a.workspace_id, user.id, "report");
    if (limit) return c.json({ error: limit }, 429);
    const ai = d.ai;
    const { result, held, attempts } = await withRefusalRule(() => ai.report(facts));
    if (held) {
      for (const r of attempts) await svc.log(user, a.workspace_id, id, "report", r);
      await svc.hold(id, user, "report", !result.ok ? result.category : null, JSON.stringify(facts));
      return c.json({ error: heldMessage, held: true }, 423);
    }
    if (!result.ok) {
      for (const r of attempts) await svc.log(user, a.workspace_id, id, "report", r);
      return c.json({ facts, text: template, source: "template", note: `${result.message} Here's the plain version.` });
    }
    // The AI may only reword: any number not in the facts means the plain version is used.
    const faithful = onlyKnownNumbers(result.value, facts);
    for (const r of attempts) await svc.log(user, a.workspace_id, id, "report", r, r.ok && !faithful ? "rejected" : undefined);
    if (!faithful) return c.json({ facts, text: template, source: "template", note: "The AI wording added numbers that aren't in the plan, so the plain version is shown." });
    return c.json({ facts, text: result.value, source: "ai", usage: await svc.usage(a.workspace_id, user.id) });
  });

  app.get("/api/me/ai", async (c) => {
    const user = c.get("user");
    const wss = await db.all<{ id: string; name: string }>(`SELECT w.id, w.name FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.created_at`, [user.id]);
    return c.json({ enabled: !!d.ai, workspaces: await Promise.all(wss.map(async (w) => ({ workspaceId: w.id, name: w.name, ...(await svc.usage(w.id, user.id)) }))) });
  });
}
