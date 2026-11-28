/**
 * "Try a change" for one plan (step N5d): the same schedule, worked out again with one thing
 * changed, so people see what it would do before doing it. Nothing is saved. Changes: a task takes
 * longer, someone's hours a week change, or someone is away for a few working days.
 */
import { Calendar } from "./calendar";
import { levelPlan, type PersonAvailability } from "./level";
import { calendarOf } from "./schedule";
import { allTasks, estimateToDays, planDayLength, sameName, type Plan, type WorkWeek } from "./schema";

export type WhatIf =
  | { kind: "longer"; taskId: string; days: number }
  | { kind: "hours"; person: string; hours: number }
  | { kind: "away"; person: string; from: string; days: number };

export interface WhatIfOpts { workWeek?: Partial<WorkWeek>; today?: string; people?: Record<string, PersonAvailability> }

export interface WhatIfResult {
  finishBefore: string;
  finishAfter: string;
  /** Working days the finish moves (+ later, − earlier). */
  finishDays: number;
  /** Open milestones whose date moves. */
  milestones: { id: string; title: string; before: string; after: string }[];
  /** Open tasks whose finish moves. */
  tasksMoved: number;
  /** What was tried, in words. */
  summary: string;
}

const personKey = (people: Record<string, PersonAvailability>, name: string) => Object.keys(people).find((k) => sameName(k, name)) ?? name;

/** The plan and people with the change made (copies; the originals are untouched). */
export function withWhatIf(plan: Plan, opts: WhatIfOpts, w: WhatIf): { plan: Plan; people: Record<string, PersonAvailability> } {
  const people = { ...(opts.people ?? {}) };
  if (w.kind === "longer") {
    const dayHours = planDayLength(plan, opts.workWeek);
    const weekDays = opts.workWeek?.workdays?.length ?? 5;
    const next: Plan = { ...plan, phases: plan.phases.map((ph) => ({ ...ph, tasks: ph.tasks.map((t) => (t.id !== w.taskId ? t : { ...t, estimate: { amount: Math.round((estimateToDays(t.estimate ?? { amount: 1, unit: "d" }, dayHours, weekDays) + w.days) * 100) / 100, unit: "d" as const } })) })) };
    return { plan: next, people };
  }
  const key = personKey(people, w.person);
  const a = people[key] ?? {};
  if (w.kind === "hours") people[key] = { ...a, hoursPerWeek: w.hours };
  else {
    const cal = new Calendar(calendarOf(opts));
    const end = cal.dateAt(w.from, Math.max(0, w.days - 1));
    people[key] = { ...a, timeOff: [...(a.timeOff ?? []), { start: w.from, end, label: "Trying a change" }] };
  }
  return { plan, people };
}

export function tryWhatIf(plan: Plan, opts: WhatIfOpts, w: WhatIf): WhatIfResult {
  const base = levelPlan(plan, opts);
  const changed = withWhatIf(plan, opts, w);
  const tried = levelPlan(changed.plan, { ...opts, people: changed.people });
  const cal = new Calendar(calendarOf(opts));
  const open = allTasks(plan).filter((t) => t.status !== "done" && t.status !== "skipped");
  const milestones = open.filter((t) => t.milestone).map((t) => ({ id: t.id, title: t.title, before: base.tasks.get(t.id)?.end ?? "", after: tried.tasks.get(t.id)?.end ?? "" })).filter((m) => m.before !== m.after);
  const tasksMoved = open.filter((t) => !t.milestone && base.tasks.get(t.id)?.end !== tried.tasks.get(t.id)?.end).length;
  const title = (id: string) => allTasks(plan).find((t) => t.id === id)?.title ?? id;
  const summary = w.kind === "longer" ? `${title(w.taskId)} takes ${w.days} more working day${w.days === 1 ? "" : "s"}` : w.kind === "hours" ? `${w.person} gives ${w.hours} hours a week` : `${w.person} is away ${w.days} working day${w.days === 1 ? "" : "s"} from ${w.from}`;
  return { finishBefore: base.finish, finishAfter: tried.finish, finishDays: cal.workdaysBetween(base.finish, tried.finish), milestones, tasksMoved, summary };
}
