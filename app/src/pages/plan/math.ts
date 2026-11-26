/** Dates, progress and Plan Check, recomputed in the browser with the same engine as the server. */
import { useMemo } from "react";
import { allTasks, baselineVariance, crossRef, checkPlan, explainStart, levelPlan, localSchedule, masterSchedule, progressOf, type MasterPart, type PersonAvailability, type Plan, type WorkWeek } from "@rakuplan/shared";

/** A plan inside a master: its key and the master as its people may see it. */
export type MasterView = { key: string; parts: MasterPart[]; people: Record<string, PersonAvailability> };

export function usePlanMath(plan: Plan | null, ctx: { workWeek: WorkWeek; today: string; people: Record<string, PersonAvailability>; master?: MasterView | null } | null) {
  return useMemo(() => {
    if (!plan || !ctx) return null;
    const opts = { workWeek: ctx.workWeek, today: ctx.today, people: ctx.people };
    // Inside a master plan, dates come from the whole master (this plan's latest edits included).
    const m = ctx.master;
    const parts = m ? m.parts.map((p) => (p.key === m.key ? { ...p, plan } : p)) : null;
    const schedule = m && parts ? localSchedule(masterSchedule(parts, { ...opts, people: { ...m.people, ...ctx.people } }), parts, m.key) : levelPlan(plan, opts);
    const progress = progressOf(plan, schedule, opts);
    const check = checkPlan(plan, { ...opts, schedule, level: true });
    const tasks = allTasks(plan);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    // What a dependency points at, including a task in another plan of the master ("Reception: Move network closet").
    const dep = (id: string): { title: string; status: string } | null => {
      const own = byId.get(id);
      if (own) return { title: own.title, status: own.status };
      const x = crossRef(id);
      const part = x && parts?.find((p) => p.key === x.key);
      const other = part && allTasks(part.plan).find((t) => t.id === x!.id);
      return other ? { title: `${part!.title}: ${other.title || x!.id}`, status: other.status } : null;
    };
    const waiting = (id: string) => !["done", "skipped"].includes(dep(id)?.status ?? "done");
    const open = tasks.filter((t) => t.status !== "done" && t.status !== "skipped");
    // Up next: open work whose dependencies are finished, earliest first.
    const ready = open
      .filter((t) => !t.milestone && t.depends.every((d) => !waiting(d.id)))
      .sort((a, b) => (schedule.tasks.get(a.id)?.start ?? "").localeCompare(schedule.tasks.get(b.id)?.start ?? ""));
    const nextMilestone = open
      .filter((t) => t.milestone)
      .map((t) => ({ task: t, date: schedule.tasks.get(t.id)?.end ?? schedule.finish }))
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const why = (id: string) => explainStart(schedule, id, plan);
    // Working days each task's finish moved against its baseline (+ later, - earlier).
    const variance = baselineVariance(plan, schedule, opts);
    return { schedule, progress, check, ready, nextMilestone, byId, why, variance, dep, waiting };
  }, [plan, ctx]);
}
