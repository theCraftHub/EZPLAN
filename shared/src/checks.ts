/**
 * The free Plan Check: instant, deterministic, no AI. Every finding is written in
 * plain language for non-technical users and points at the tasks involved.
 */
import { Calendar } from "./calendar";
import { levelPlan, type LeveledSchedule, type LevelOptions } from "./level";
import { calendarOf, schedulePlan, type Schedule } from "./schedule";
import { allTasks, estimateToDays, isWaiting, planDayLength, type Plan } from "./schema";

export type FindingSeverity = "problem" | "warning" | "tip";

export interface Finding {
  code: string;
  severity: FindingSeverity;
  message: string;
  taskIds: string[];
}

export interface PlanCheckResult {
  score: number;
  findings: Finding[];
}

const WEIGHT: Record<FindingSeverity, number> = { problem: 15, warning: 6, tip: 2 };
const LONG_TASK_DAYS = 10;
const SAME_DAY_CROWD = 5;

export interface CheckOptions extends LevelOptions {
  schedule?: Schedule;
  /** Use person-aware scheduling (the app always does; implied when `people` is given). */
  level?: boolean;
}

export function checkPlan(plan: Plan, opts: CheckOptions = {}): PlanCheckResult {
  const dayHours = planDayLength(plan, opts.workWeek);
  const weekDays = calendarOf(opts).workdays?.length ?? 5;
  const f: Finding[] = [];
  const add = (code: string, severity: FindingSeverity, message: string, taskIds: string[] = []) => f.push({ code, severity, message, taskIds });
  const tasks = allTasks(plan);
  const ids = new Set<string>();

  // Structure
  const dupes = new Set<string>();
  for (const t of tasks) (ids.has(t.id) ? dupes : ids).add(t.id);
  for (const id of dupes) add("duplicate-id", "problem", `More than one task uses the ID ${id}. Give each task its own ID.`, [id]);

  for (const t of tasks) {
    for (const d of t.depends) {
      if (d.id === t.id) add("self-dependency", "problem", `${t.id} "${t.title}" waits on itself.`, [t.id]);
      else if (!ids.has(d.id)) add("unknown-dependency", "problem", `${t.id} "${t.title}" waits on ${d.id}, which isn't in the plan.`, [t.id]);
    }
  }

  const schedule: Schedule = opts.schedule ?? (opts.level || opts.people ? levelPlan(plan, opts) : schedulePlan(plan, opts));
  const leveled = "leveled" in schedule ? (schedule as LeveledSchedule) : null;
  for (const loop of schedule.cycles) add("dependency-loop", "problem", `These tasks wait on each other in a loop, so none can start: ${loop.join(" → ")} → ${loop[0]}.`, loop);

  // Completeness
  if (!plan.goal) add("missing-goal", "warning", "The plan has no goal. Add one so everyone (and the AI check) knows what it must achieve.");
  if (!plan.doneWhen) add("missing-done-when", "warning", 'The plan doesn\'t say how you\'ll know it\'s finished. Add "done when".');
  if (tasks.length === 0) add("no-tasks", "problem", "The plan has no tasks yet.");
  for (const p of plan.phases) if (p.tasks.length === 0) add("empty-phase", "tip", `The phase "${p.title}" has no tasks.`);

  const open = tasks.filter((t) => t.status !== "done" && t.status !== "skipped");
  const noOwner = open.filter((t) => !t.milestone && !isWaiting(t) && !t.owner);
  if (noOwner.length) add("no-owner", noOwner.length > 3 ? "warning" : "tip", `${noOwner.length} task${s(noOwner.length)} ${noOwner.length === 1 ? "has" : "have"} no owner.`, noOwner.map((t) => t.id));
  const noEstimate = open.filter((t) => !t.milestone && !t.estimate);
  if (noEstimate.length) add("no-estimate", "warning", `${noEstimate.length} task${s(noEstimate.length)} ${noEstimate.length === 1 ? "has" : "have"} no time estimate, so 1 day was assumed.`, noEstimate.map((t) => t.id));
  if (tasks.length >= 8 && !tasks.some((t) => t.milestone)) add("no-milestones", "tip", "Add a milestone or two (key moments like \"Venue confirmed\") to make progress easier to see.");
  // Loose ends: work outside the last phase that nothing waits on can't move the finish date,
  // which usually means a missing link (e.g. a permit wait that demolition should depend on).
  if (tasks.some((t) => t.depends.length)) {
    const waitedOn = new Set(tasks.flatMap((t) => t.depends.map((d) => d.id)));
    const phaseOf = new Map(plan.phases.flatMap((p, i) => p.tasks.map((t) => [t.id, i] as const)));
    // A phase "feeds forward" when a task in a later phase waits on something in it. Only then is a
    // task in it that nothing waits on likely a missing link (not, say, an ongoing or separate item).
    const feedsForward = new Set<number>();
    for (const t of tasks) for (const d of t.depends) {
      const from = phaseOf.get(d.id);
      if (from !== undefined && from < phaseOf.get(t.id)!) feedsForward.add(from);
    }
    for (const t of plan.phases.filter((_, i) => feedsForward.has(i)).flatMap((p) => p.tasks)) {
      if (t.milestone || waitedOn.has(t.id) || !open.includes(t)) continue;
      add("loose-end", "tip", `Nothing waits on ${t.id} "${t.title}", so it doesn't affect the finish date. Should a later task depend on it?`, [t.id]);
    }
  }
  for (const m of open.filter((t) => t.milestone && t.depends.length === 0 && tasks.length > 1)) add("milestone-no-predecessors", "tip", `Milestone ${m.id} "${m.title}" doesn't wait on any task, so it can't show progress.`, [m.id]);

  // Risks
  if (leveled) {
    for (const name of leveled.assumedFullTime) add("assumed-availability", "tip", `No availability is set for ${name}, so full time on this project (${leveled.fullTimeHours} h a week) was assumed. Add how many hours a week ${name} can give it.`, open.filter((t) => t.owner === name).map((t) => t.id));
    if (leveled.unplaceable.length) add("no-hours", "problem", `${leveled.unplaceable.length} task${s(leveled.unplaceable.length)} can't be scheduled because the owner has no available hours.`, leveled.unplaceable);
  }
  // (Unleveled schedules only) The schedule runs independent tasks side by side. If one person owns more work than fits
  // before the scheduled finish, the real finish is later. (Waiting tasks aren't anyone's work.)
  const workDays = new Map<string, number>();
  for (const t of open) {
    if (!t.owner || t.milestone || isWaiting(t)) continue;
    const left = (t.estimate ? estimateToDays(t.estimate, dayHours, weekDays) : 1) * (t.status === "progress" ? 0.5 : 1);
    workDays.set(t.owner, (workDays.get(t.owner) ?? 0) + left);
  }
  const cal = new Calendar(calendarOf(opts));
  for (const [owner, days] of leveled ? [] : workDays) {
    const oneAtATime = cal.dateAt(schedule.projectStart, Math.max(0, Math.ceil(days) - 1));
    if (oneAtATime > schedule.finish) {
      add("overloaded", "warning", `${owner} has about ${Math.round(days)} working days of tasks, but the schedule runs them side by side and finishes ${schedule.finish}. Doing one at a time, ${owner}'s work alone runs to about ${oneAtATime}.`, open.filter((t) => t.owner === owner && !t.milestone && !isWaiting(t)).map((t) => t.id));
    }
  }
  for (const t of open) {
    const st = schedule.tasks.get(t.id);
    if (st && t.due && st.end > t.due) add("after-due-date", "warning", `${t.id} "${t.title}" is scheduled to finish ${st.end}, after its due date ${t.due}.`, [t.id]);
  }
  const openIds = new Set(open.map((t) => t.id));
  const critOpen = new Set(schedule.criticalPath.filter((id) => openIds.has(id)));
  const critTasks = tasks.filter((t) => critOpen.has(t.id) && !t.milestone && !isWaiting(t));
  const unassignedCrit = critTasks.filter((t) => !t.owner);
  if (unassignedCrit.length) add("critical-unassigned", "warning", `${unassignedCrit.length} task${s(unassignedCrit.length)} that decide the finish date ${unassignedCrit.length === 1 ? "has" : "have"} no owner.`, unassignedCrit.map((t) => t.id));
  const owners = new Set(tasks.map((t) => t.owner).filter(Boolean));
  if (critTasks.length >= 3 && owners.size > 1) {
    const counts = new Map<string, number>();
    for (const t of critTasks) if (t.owner) counts.set(t.owner, (counts.get(t.owner) ?? 0) + 1);
    for (const [owner, n] of counts) {
      if (n / critTasks.length > 0.6) add("critical-concentration", "warning", `${owner} owns ${n} of ${critTasks.length} tasks that decide the finish date. Consider sharing some.`, critTasks.filter((t) => t.owner === owner).map((t) => t.id));
    }
  }
  for (const t of open) {
    // The amount of work, not the calendar span (part-time availability stretches the span).
    const work = t.estimate ? estimateToDays(t.estimate, dayHours, weekDays) : 0;
    if (!t.milestone && !isWaiting(t) && work > LONG_TASK_DAYS && t.subtasks.length === 0) add("long-task", "tip", `${t.id} "${t.title}" is ${Math.round(work)} working days of work. Consider breaking it down.`, [t.id]);
  }
  const byEnd = new Map<string, string[]>();
  for (const t of open) {
    // Only dates people set: scheduled finish dates bunching up is a workload question (see "overloaded").
    const end = t.due;
    if (end && !t.milestone) (byEnd.get(end) ?? byEnd.set(end, []).get(end)!).push(t.id);
  }
  for (const [day, list] of byEnd) if (list.length >= SAME_DAY_CROWD) add("crowded-day", "tip", `${list.length} tasks are due on ${day}. Spread them out if you can.`, list);
  for (const t of open) {
    const blockers = t.depends.map((d) => d.id).filter((id) => schedule.tasks.get(id)?.overdue);
    if (blockers.length) add("waits-on-overdue", "warning", `${t.id} "${t.title}" waits on overdue work (${blockers.join(", ")}).`, [t.id, ...blockers]);
  }

  const score = Math.max(0, Math.min(100, 100 - f.reduce((sum, x) => sum + WEIGHT[x.severity], 0)));
  const order: Record<FindingSeverity, number> = { problem: 0, warning: 1, tip: 2 };
  f.sort((a, b) => order[a.severity] - order[b.severity]);
  return { score, findings: f };
}

function s(n: number): string {
  return n === 1 ? "" : "s";
}
