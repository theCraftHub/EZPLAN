/**
 * The free Plan Check: instant, deterministic, no AI. Every finding is written in
 * plain language for non-technical users and points at the tasks involved.
 */
import { schedulePlan, type Schedule, type ScheduleOptions } from "./schedule";
import { allTasks, type Plan } from "./schema";

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

export function checkPlan(plan: Plan, opts: ScheduleOptions & { schedule?: Schedule } = {}): PlanCheckResult {
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

  const schedule = opts.schedule ?? schedulePlan(plan, opts);
  for (const loop of schedule.cycles) add("dependency-loop", "problem", `These tasks wait on each other in a loop, so none can start: ${loop.join(" → ")} → ${loop[0]}.`, loop);

  // Completeness
  if (!plan.goal) add("missing-goal", "warning", "The plan has no goal. Add one so everyone (and the AI check) knows what it must achieve.");
  if (!plan.doneWhen) add("missing-done-when", "warning", 'The plan doesn\'t say how you\'ll know it\'s finished. Add "done when".');
  if (tasks.length === 0) add("no-tasks", "problem", "The plan has no tasks yet.");
  for (const p of plan.phases) if (p.tasks.length === 0) add("empty-phase", "tip", `The phase "${p.title}" has no tasks.`);

  const open = tasks.filter((t) => t.status !== "done" && t.status !== "skipped");
  const noOwner = open.filter((t) => !t.milestone && !t.owner);
  if (noOwner.length) add("no-owner", noOwner.length > 3 ? "warning" : "tip", `${noOwner.length} task${s(noOwner.length)} ${noOwner.length === 1 ? "has" : "have"} no owner.`, noOwner.map((t) => t.id));
  const noEstimate = open.filter((t) => !t.milestone && !t.estimate);
  if (noEstimate.length) add("no-estimate", "warning", `${noEstimate.length} task${s(noEstimate.length)} ${noEstimate.length === 1 ? "has" : "have"} no time estimate, so 1 day was assumed.`, noEstimate.map((t) => t.id));
  if (tasks.length >= 8 && !tasks.some((t) => t.milestone)) add("no-milestones", "tip", "Add a milestone or two (key moments like \"Venue confirmed\") to make progress easier to see.");
  for (const m of tasks.filter((t) => t.milestone && t.depends.length === 0 && tasks.length > 1)) add("milestone-no-predecessors", "tip", `Milestone ${m.id} "${m.title}" doesn't wait on any task, so it can't show progress.`, [m.id]);

  // Risks
  for (const t of open) {
    const st = schedule.tasks.get(t.id);
    if (st && t.due && st.end > t.due) add("after-due-date", "warning", `${t.id} "${t.title}" is scheduled to finish ${st.end}, after its due date ${t.due}.`, [t.id]);
  }
  const openIds = new Set(open.map((t) => t.id));
  const critOpen = new Set(schedule.criticalPath.filter((id) => openIds.has(id)));
  const critTasks = tasks.filter((t) => critOpen.has(t.id) && !t.milestone);
  const unassignedCrit = critTasks.filter((t) => !t.owner);
  if (unassignedCrit.length) add("critical-unassigned", "warning", `${unassignedCrit.length} task${s(unassignedCrit.length)} that decide the finish date ${unassignedCrit.length === 1 ? "has" : "have"} no owner.`, unassignedCrit.map((t) => t.id));
  if (critTasks.length >= 3) {
    const counts = new Map<string, number>();
    for (const t of critTasks) if (t.owner) counts.set(t.owner, (counts.get(t.owner) ?? 0) + 1);
    for (const [owner, n] of counts) {
      if (n / critTasks.length > 0.6) add("critical-concentration", "warning", `${owner} owns ${n} of ${critTasks.length} tasks that decide the finish date. Consider sharing some.`, critTasks.filter((t) => t.owner === owner).map((t) => t.id));
    }
  }
  for (const t of open) {
    const st = schedule.tasks.get(t.id);
    if (st && !t.milestone && st.durationDays > LONG_TASK_DAYS && t.subtasks.length === 0) add("long-task", "tip", `${t.id} "${t.title}" is ${Math.round(st.durationDays)} working days long. Consider breaking it down.`, [t.id]);
  }
  const byEnd = new Map<string, string[]>();
  for (const t of open) {
    const end = t.due ?? schedule.tasks.get(t.id)?.end;
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
