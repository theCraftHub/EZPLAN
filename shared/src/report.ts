/**
 * Status reports: facts first (computed from the plan, works with AI off), wording second.
 * AI may only reword these facts; `onlyKnownNumbers` checks it added no numbers of its own.
 */
import { Calendar, toDay } from "./calendar";
import type { Progress, Schedule } from "./schedule";
import { allTasks, type Plan } from "./schema";
import { budgetOf, money, type TimeEntry } from "./budget";

export type Rag = "green" | "amber" | "red";

export interface StatusFacts {
  planTitle: string;
  today: string;
  since: string;
  rag: Rag;
  health: string;
  percent: number;
  doneCount: number;
  countedTasks: number;
  finish: string;
  forecastFinish: string | null;
  baselineVarianceDays: number | null;
  doneSince: { title: string; by: string | null; date: string }[];
  slipped: { title: string; days: number }[];
  comingUp: { title: string; owner: string | null; start: string }[];
  overdue: { title: string; owner: string | null }[];
  milestones: { title: string; date: string; done: boolean }[];
  /** Money (step N4), when the plan has any costs or rates. */
  budget?: { currency: string | null; planned: number; actual: number; forecast: number; overBy: number };
}

const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function statusFacts(plan: Plan, schedule: Schedule, progress: Progress, opts: { today: string; since?: string; rates?: Record<string, number>; time?: TimeEntry[] }): StatusFacts {
  const today = opts.today;
  const since = opts.since ?? new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const cal = new Calendar();
  const tasks = allTasks(plan);
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "skipped");
  const b = budgetOf(plan, { rates: opts.rates, time: opts.time });
  const rag: Rag = progress.suggestedHealth === "Off track" ? "red" : progress.suggestedHealth === "At risk" ? "amber" : "green";
  return {
    planTitle: plan.title,
    today,
    since,
    rag,
    health: progress.suggestedHealth,
    percent: progress.percent,
    doneCount: progress.doneCount,
    countedTasks: progress.countedTasks,
    finish: schedule.finish,
    forecastFinish: progress.forecastFinish,
    baselineVarianceDays: progress.baselineVarianceDays,
    doneSince: tasks.filter((t) => t.status === "done" && t.done && t.done.date >= since).map((t) => ({ title: t.title, by: t.done!.by ?? null, date: t.done!.date })),
    slipped: open
      .filter((t) => t.planned && schedule.tasks.get(t.id) && schedule.tasks.get(t.id)!.end > t.planned.end)
      .map((t) => ({ title: t.title, days: cal.workdaysBetween(t.planned!.end, schedule.tasks.get(t.id)!.end) }))
      .filter((s) => s.days > 0),
    comingUp: open
      .filter((t) => !t.milestone && schedule.tasks.get(t.id) && toDay(schedule.tasks.get(t.id)!.start) - toDay(today) <= 14 && schedule.tasks.get(t.id)!.start >= today)
      .sort((a, b) => schedule.tasks.get(a.id)!.start.localeCompare(schedule.tasks.get(b.id)!.start))
      .slice(0, 8)
      .map((t) => ({ title: t.title, owner: t.owner ?? null, start: schedule.tasks.get(t.id)!.start })),
    overdue: open.filter((t) => schedule.tasks.get(t.id)?.overdue).map((t) => ({ title: t.title, owner: t.owner ?? null })),
    milestones: tasks.filter((t) => t.milestone).map((t) => ({ title: t.title, date: schedule.tasks.get(t.id)?.end ?? schedule.finish, done: t.status === "done" })),
    ...(b.hasMoney ? { budget: { currency: b.currency, planned: b.planned, actual: b.actual, forecast: b.forecast, overBy: b.overBy } } : {}),
  };
}

export interface ReportText {
  headline: string;
  sections: { title: string; text: string }[];
}

/** The report written from facts alone (always available; also what the AI rewords). */
export function templateReport(f: StatusFacts): ReportText {
  const list = (xs: string[]) => (xs.length ? xs.join("; ") + "." : "Nothing.");
  const late = f.forecastFinish && f.forecastFinish > f.finish ? ` At the current pace it would finish ${short(f.forecastFinish)}.` : "";
  return {
    headline: `${f.planTitle}: ${f.health.toLowerCase()}, ${f.percent}% done, finishing ${short(f.finish)}.`,
    sections: [
      { title: "Done since " + short(f.since), text: list(f.doneSince.map((d) => `${d.title}${d.by ? ` (${d.by})` : ""}`)) },
      { title: "Behind schedule", text: list([...f.slipped.map((s) => `${s.title} (${s.days} day${s.days === 1 ? "" : "s"} late)`), ...f.overdue.map((o) => `${o.title} is overdue${o.owner ? ` (${o.owner})` : ""}`)]) },
      { title: "Coming up", text: list(f.comingUp.map((c) => `${c.title} starts ${short(c.start)}${c.owner ? ` (${c.owner})` : ""}`)) },
      { title: "Milestones", text: list(f.milestones.filter((m) => !m.done).map((m) => `${m.title} on ${short(m.date)}`)) },
      ...(f.budget ? [{ title: "Budget", text: `${money(f.budget.actual, f.budget.currency, "en-US")} spent of ${money(f.budget.planned, f.budget.currency, "en-US")} planned; forecast ${money(f.budget.forecast, f.budget.currency, "en-US")}.${f.budget.overBy > 0 ? ` Heading ${money(f.budget.overBy, f.budget.currency, "en-US")} over budget.` : ""}` }] : []),
      { title: "Forecast", text: `${f.doneCount} of ${f.countedTasks} tasks done. Planned finish ${short(f.finish)}.${late}${f.baselineVarianceDays ? ` ${Math.abs(f.baselineVarianceDays)} working days ${f.baselineVarianceDays > 0 ? "behind" : "ahead of"} the baseline.` : ""}` },
    ],
  };
}

const numbersIn = (s: string) => new Set((s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")));

/** True when every number in the reworded text already appears in the facts (no invented figures). */
export function onlyKnownNumbers(text: ReportText, facts: StatusFacts): boolean {
  const known = numbersIn(JSON.stringify(facts) + " " + JSON.stringify(templateReport(facts)));
  for (const n of numbersIn([text.headline, ...text.sections.flatMap((s) => [s.title, s.text])].join(" "))) if (!known.has(n)) return false;
  return true;
}
