/** Dates, progress and Plan Check, recomputed in the browser with the same engine as the server. */
import { useMemo } from "react";
import { allTasks, baselineVariance, checkPlan, explainStart, levelPlan, progressOf, type PersonAvailability, type Plan, type WorkWeek } from "@ezplan/shared";

export function usePlanMath(plan: Plan | null, ctx: { workWeek: WorkWeek; today: string; people: Record<string, PersonAvailability> } | null) {
  return useMemo(() => {
    if (!plan || !ctx) return null;
    const opts = { workWeek: ctx.workWeek, today: ctx.today, people: ctx.people };
    const schedule = levelPlan(plan, opts);
    const progress = progressOf(plan, schedule, opts);
    const check = checkPlan(plan, { ...opts, schedule, level: true });
    const tasks = allTasks(plan);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const open = tasks.filter((t) => t.status !== "done" && t.status !== "skipped");
    // Up next: open work whose dependencies are finished, earliest first.
    const ready = open
      .filter((t) => !t.milestone && t.depends.every((d) => ["done", "skipped"].includes(byId.get(d.id)?.status ?? "done")))
      .sort((a, b) => (schedule.tasks.get(a.id)?.start ?? "").localeCompare(schedule.tasks.get(b.id)?.start ?? ""));
    const nextMilestone = open
      .filter((t) => t.milestone)
      .map((t) => ({ task: t, date: schedule.tasks.get(t.id)?.end ?? schedule.finish }))
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const why = (id: string) => explainStart(schedule, id, plan);
    // Working days each task's finish moved against its baseline (+ later, - earlier).
    const variance = baselineVariance(plan, schedule, opts);
    return { schedule, progress, check, ready, nextMilestone, byId, why, variance };
  }, [plan, ctx]);
}
