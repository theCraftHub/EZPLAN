/** "What if this person did this task?": fit in their free hours, the new finish, what moves. */
import { levelPlan, type PersonAvailability, type Plan, type WorkWeek } from "@ezplan/shared";
import type { usePlanMath } from "./math";
import type { useTeamData } from "./teamData";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;
type Data = ReturnType<typeof useTeamData>;

/** Hours this task takes, from the current bookings (what the scheduler gave it). */
export function taskHours(math: Math, taskId: string): number {
  let h = 0;
  for (const days of math.schedule.bookings.values()) for (const list of days.values()) for (const b of list) if (b.taskId === taskId) h += b.hours;
  return h;
}

/** Does `person` have enough free hours on the task's current dates? (instant: for drop-target colors) */
export function fits(data: Data, math: Math, taskId: string, person: string): boolean {
  const s = math.schedule.tasks.get(taskId);
  const row = data.rows.find((r) => r.name.toLowerCase() === person.toLowerCase());
  if (!s || !row) return false;
  const need = taskHours(math, taskId);
  let free = 0;
  for (const c of row.days) {
    if (c.date < s.start || c.date > s.end) continue;
    const others = c.tasks.filter((t) => t.id !== taskId).reduce((n, t) => n + t.hours, 0);
    free += Math.max(0, c.available - others);
  }
  return free + 1e-6 >= need;
}

export interface WhatIf {
  person: string;
  finish: string;
  /** Tasks whose dates change. */
  moved: number;
  /** Working-day difference in the finish (negative = earlier). */
  finishChange: number;
}

/** The plan with this task given to `person`, scheduled by the same engine. */
export function whatIfOwner(plan: Plan, taskId: string, person: string, ctx: { workWeek: WorkWeek; today: string; people: Record<string, PersonAvailability> }, math: Math): WhatIf {
  const trial = structuredClone(plan);
  for (const ph of trial.phases) for (const t of ph.tasks) if (t.id === taskId) t.owner = person;
  const s = levelPlan(trial, ctx);
  let moved = 0;
  for (const [id, x] of s.tasks) {
    const was = math.schedule.tasks.get(id);
    if (was && (was.start !== x.start || was.end !== x.end)) moved++;
  }
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  return { person, finish: s.finish, moved, finishChange: days(math.schedule.finish, s.finish) };
}
