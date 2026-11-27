/**
 * Scheduled jobs (step N2, plan section 6), run every 15 minutes by both hosts (a Cron Trigger on
 * Cloudflare, a timer self-hosted). Each job is safe to run again: what it sent is recorded per
 * person and period, so a repeated or late tick never sends twice, and a missed tick catches up.
 *
 * - Digests: each person's daily or weekly summary at their chosen hour in their time zone (due
 *   today, overdue, starting soon, milestones this week, waiting for their approval). In the app
 *   always; by email once sending is set up (until then it waits in the outbox).
 * - Status-update reminders: a plan's managers, once a week, when its status update is overdue.
 * - Weekly summaries: people who follow a plan get a one-page summary each Monday.
 */
import { allTasks, awaitingApproval, sameName, type LeveledSchedule, type Plan } from "@rakuplan/shared";
import type { Clock, Db, HttpFetch } from "./ports";
import { syncCalendars } from "./calendars";
import { notify } from "./notify";
import { updateState } from "./statusUpdates";

export interface DigestPref { mode: "daily" | "weekly" | "off"; hour: number; tz: string; weekday: number }
export const DEFAULT_DIGEST: DigestPref = { mode: "daily", hour: 8, tz: "UTC", weekday: 1 };

export interface JobDeps {
  db: Db;
  clock: Clock;
  http: HttpFetch;
  /** A plan with its schedule as of a given day (the same engine the app uses). */
  plan: (planId: string, today: string) => Promise<{ plan: Plan; schedule: LeveledSchedule } | null>;
  email: (to: string, subject: string, text: string) => Promise<void>;
}

/** The date, hour and weekday (1 = Monday) at `now` in a time zone; UTC if the zone is unknown. */
export function localTime(now: number, tz: string): { date: string; hour: number; weekday: number } {
  const fmt = (zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(now));
  let parts: Intl.DateTimeFormatPart[];
  try { parts = fmt(tz); } catch { parts = fmt("UTC"); }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), weekday: days.indexOf(get("weekday")) + 1 };
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const nice = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function parseDigest(raw: unknown): DigestPref {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<DigestPref>;
  return {
    mode: v.mode === "weekly" || v.mode === "off" || v.mode === "daily" ? v.mode : DEFAULT_DIGEST.mode,
    hour: Number.isInteger(v.hour) && v.hour! >= 0 && v.hour! <= 23 ? v.hour! : DEFAULT_DIGEST.hour,
    tz: typeof v.tz === "string" && v.tz.length < 64 ? v.tz : DEFAULT_DIGEST.tz,
    weekday: Number.isInteger(v.weekday) && v.weekday! >= 1 && v.weekday! <= 7 ? v.weekday! : DEFAULT_DIGEST.weekday,
  };
}

/** Records that something was sent; false if it already was (so it isn't sent twice). */
async function once(db: Db, key: string, now: number): Promise<boolean> {
  return (await db.run(`INSERT INTO sent_log (key, at) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`, [key, now])).changes > 0;
}

type Line = { plan: string; text: string };
export interface DigestContent { dueToday: Line[]; overdue: Line[]; startingSoon: Line[]; milestones: Line[]; approvals: Line[] }

/** One person's digest across every active plan they can open. */
export async function digestFor(d: JobDeps, user: { id: string; name: string }, today: string, days: number): Promise<DigestContent> {
  const out: DigestContent = { dueToday: [], overdue: [], startingSoon: [], milestones: [], approvals: [] };
  const plans = await d.db.all<{ id: string }>(
    `SELECT p.id FROM plans p WHERE p.state = 'active' AND (p.workspace_id IN (SELECT workspace_id FROM members WHERE user_id = ?) OR p.id IN (SELECT plan_id FROM plan_members WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?))) ORDER BY p.updated_at DESC LIMIT 100`,
    [user.id, user.id, d.clock.now()],
  );
  for (const { id } of plans) {
    const got = await d.plan(id, today);
    if (!got) continue;
    const { plan, schedule } = got;
    const linked = new Set((await d.db.all<{ name_key: string }>(`SELECT name_key FROM plan_people WHERE plan_id = ? AND user_id = ?`, [id, user.id])).map((r) => r.name_key));
    const mine = (name: string | undefined) => !!name && (sameName(name, user.name) || linked.has(name.trim().toLowerCase()));
    for (const t of allTasks(plan)) {
      const s = schedule.tasks.get(t.id);
      const open = t.status !== "done" && t.status !== "skipped";
      if (awaitingApproval(t) && mine(t.approver)) out.approvals.push({ plan: plan.title, text: t.title });
      if (t.milestone && open && s && s.end >= today && s.end <= addDays(today, 6)) out.milestones.push({ plan: plan.title, text: `${t.title} (${nice(s.end)})` });
      if (!open || t.milestone || !mine(t.owner) || !s) continue;
      if (s.overdue) out.overdue.push({ plan: plan.title, text: `${t.title} (was due ${nice(s.end)})` });
      else if (s.end <= addDays(today, days - 1) && s.end >= today) out.dueToday.push({ plan: plan.title, text: days === 1 ? t.title : `${t.title} (${nice(s.end)})` });
      else if (s.start > today && s.start <= addDays(today, days === 1 ? 3 : 13)) out.startingSoon.push({ plan: plan.title, text: `${t.title} (starts ${nice(s.start)})` });
    }
  }
  return out;
}

export function digestText(c: DigestContent, weekly: boolean): { summary: string; body: string } | null {
  const sections: [string, Line[]][] = [
    [weekly ? "Due this week" : "Due today", c.dueToday], ["Overdue", c.overdue], ["Waiting for your approval", c.approvals],
    [weekly ? "Starting in the next two weeks" : "Starting soon", c.startingSoon], ["Milestones this week", c.milestones],
  ];
  const filled = sections.filter(([, l]) => l.length);
  // Nothing of your own to do and nothing coming up: no digest.
  if (!c.dueToday.length && !c.overdue.length && !c.approvals.length && !c.startingSoon.length && !c.milestones.length) return null;
  const counts = [c.dueToday.length && `${c.dueToday.length} due`, c.overdue.length && `${c.overdue.length} overdue`, c.approvals.length && `${c.approvals.length} waiting for your approval`, c.milestones.length && `${c.milestones.length} ${c.milestones.length === 1 ? "milestone" : "milestones"} this week`].filter(Boolean).join(", ");
  const body = filled.map(([title, lines]) => `${title}:\n${lines.map((l) => `- ${l.text} · ${l.plan}`).join("\n")}`).join("\n\n");
  return { summary: counts || "Work starting soon", body };
}

/** Tests only: run some jobs, for some people. */
export interface JobFilter { jobs?: string[]; userIds?: string[] }

async function digests(d: JobDeps, now: number, only?: JobFilter) {
  let sent = 0;
  const users = await d.db.all<{ id: string; name: string; email: string; value: string | null }>(
    `SELECT u.id, u.name, u.email, p.value FROM users u LEFT JOIN user_prefs p ON p.user_id = u.id AND p.key = 'digest' WHERE u.suspended_at IS NULL`,
  );
  for (const u of users) {
    if (only?.userIds && !only.userIds.includes(u.id)) continue;
    const pref = parseDigest(u.value ? JSON.parse(u.value) : null);
    if (pref.mode === "off") continue;
    const local = localTime(now, pref.tz);
    if (local.hour < pref.hour) continue;
    const weekly = pref.mode === "weekly";
    if (weekly && local.weekday !== pref.weekday) continue;
    const key = `digest:${u.id}:${pref.mode}:${local.date}`;
    if (await d.db.first(`SELECT 1 AS x FROM sent_log WHERE key = ?`, [key])) continue;
    const text = digestText(await digestFor(d, u, local.date, weekly ? 7 : 1), weekly);
    if (!(await once(d.db, key, now)) || !text) continue;
    await notify(d.db, now, { userId: u.id, kind: "digest", text: `${weekly ? "Your week" : "Today"}: ${text.summary}`, link: "/" });
    await d.email(u.email, `${weekly ? "Your week" : "Today"}: ${text.summary}`, `Hi ${u.name.split(" ")[0]},\n\n${text.body}\n\nChange how often you get this in Settings.`);
    sent++;
  }
  return sent;
}

async function statusReminders(d: JobDeps, now: number) {
  let sent = 0;
  const week = localTime(now, "UTC");
  const weekKey = addDays(week.date, 1 - week.weekday);
  const plans = await d.db.all<{ id: string; title: string; workspace_id: string }>(`SELECT id, title, workspace_id FROM plans WHERE state = 'active' AND kind != 'master'`);
  for (const p of plans) {
    if (!(await updateState(d.db, now, p.id)).overdue) continue;
    if (!(await once(d.db, `status:${p.id}:${weekKey}`, now))) continue;
    for (const m of await d.db.all<{ user_id: string }>(`SELECT user_id FROM members WHERE workspace_id = ? AND role = 'manager'`, [p.workspace_id])) {
      await notify(d.db, now, { userId: m.user_id, planId: p.id, kind: "status", text: `${p.title} is due a status update`, link: `/p/${p.id}/report` });
      sent++;
    }
  }
  return sent;
}

async function weeklySummaries(d: JobDeps, now: number, only?: JobFilter) {
  let sent = 0;
  const follows = await d.db.all<{ plan_id: string; user_id: string; name: string; email: string; value: string | null }>(
    `SELECT f.plan_id, f.user_id, u.name, u.email, p.value FROM plan_follows f JOIN users u ON u.id = f.user_id LEFT JOIN user_prefs p ON p.user_id = u.id AND p.key = 'digest' JOIN plans pl ON pl.id = f.plan_id WHERE pl.state = 'active'`,
  );
  for (const f of follows) {
    if (only?.userIds && !only.userIds.includes(f.user_id)) continue;
    const pref = parseDigest(f.value ? JSON.parse(f.value) : null);
    const local = localTime(now, pref.tz);
    if (local.weekday !== 1 || local.hour < pref.hour) continue;
    if (!(await once(d.db, `weekly:${f.plan_id}:${f.user_id}:${local.date}`, now))) continue;
    const got = await d.plan(f.plan_id, local.date);
    if (!got) continue;
    const { plan, schedule } = got;
    const tasks = allTasks(plan).filter((t) => !t.milestone);
    const done = tasks.filter((t) => t.status === "done").length;
    const overdue = [...schedule.tasks.values()].filter((s) => s.overdue).length;
    const coming = allTasks(plan).filter((t) => t.milestone && t.status !== "done").map((t) => ({ t, s: schedule.tasks.get(t.id) })).filter((x) => x.s && x.s.end <= addDays(local.date, 13));
    const text = [`${plan.title}: week of ${nice(local.date)}`, `${done} of ${tasks.length} tasks done · finishing ${nice(schedule.finish)}${overdue ? ` · ${overdue} overdue` : ""}`, ...(coming.length ? ["", "Milestones in the next two weeks:", ...coming.map(({ t, s }) => `- ${t.title} (${nice(s!.end)})`)] : [])].join("\n");
    await notify(d.db, now, { userId: f.user_id, planId: f.plan_id, kind: "digest", text: `Weekly summary of ${plan.title}`, link: `/p/${f.plan_id}` });
    await d.email(f.email, `Weekly summary: ${plan.title}`, `${text}\n\nStop these from the plan's Status report page.`);
    sent++;
  }
  return sent;
}

const JOBS: Record<string, (d: JobDeps, now: number, only?: JobFilter) => Promise<number>> = { calendarSync: (d, now) => syncCalendars(d, now), digests, statusReminders, weeklySummaries };

/** Runs every job once; each failure is kept for the Operations page and doesn't stop the others. */
export async function runJobs(d: JobDeps, now = d.clock.now(), only?: JobFilter): Promise<Record<string, number | string>> {
  const result: Record<string, number | string> = {};
  for (const [name, job] of Object.entries(JOBS)) {
    if (only?.jobs && !only.jobs.includes(name)) continue;
    try {
      const n = await job(d, now, only);
      result[name] = n;
      await d.db.run(`INSERT INTO job_runs (name, last_run, last_ok, last_error, runs) VALUES (?, ?, ?, NULL, 1) ON CONFLICT (name) DO UPDATE SET last_run = excluded.last_run, last_ok = excluded.last_ok, last_error = NULL, runs = job_runs.runs + 1`, [name, now, now]);
    } catch (e) {
      result[name] = `failed: ${(e as Error).message}`;
      await d.db.run(`INSERT INTO job_runs (name, last_run, last_ok, last_error, runs) VALUES (?, ?, NULL, ?, 1) ON CONFLICT (name) DO UPDATE SET last_run = excluded.last_run, last_error = excluded.last_error, runs = job_runs.runs + 1`, [name, now, String((e as Error).message).slice(0, 300)]).catch(() => {});
    }
  }
  if (Math.random() < 0.05) await d.db.run(`DELETE FROM sent_log WHERE at < ?`, [now - 60 * 86_400_000]);
  return result;
}
