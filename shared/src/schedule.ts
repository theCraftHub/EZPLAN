/**
 * Deterministic scheduling engine (no AI): dates from estimates and dependencies,
 * critical path and slack, progress, baseline variance, forecast from pace,
 * suggested health, and workload per person per week.
 */
import { Calendar, todayIso, toDay, type WorkCalendar } from "./calendar";
import { allTasks, estimateToDays, HOURS_PER_DAY, type Plan, type Task } from "./schema";

export type Health = "On track" | "At risk" | "Off track" | "On hold" | "Complete";

export interface ScheduledTask {
  id: string;
  /** Working-day offsets from the project start; end is exclusive. */
  startOffset: number;
  endOffset: number;
  durationDays: number;
  start: string;
  /** Last working day of the task (inclusive). Milestones: their date. */
  end: string;
  /** Working days the task can slip without moving the finish date. */
  slack: number;
  critical: boolean;
  overdue: boolean;
  /** Estimate was missing, so 1 day was assumed. */
  assumedDuration: boolean;
}

export interface Schedule {
  projectStart: string;
  finish: string;
  totalDays: number;
  tasks: Map<string, ScheduledTask>;
  criticalPath: string[];
  /** Task IDs that are part of a dependency loop (their loop links were ignored). */
  cycles: string[][];
}

export interface ScheduleOptions {
  calendar?: WorkCalendar;
  /** Overrides plan.start. */
  start?: string;
  /** For overdue/forecast; defaults to the real today. */
  today?: string;
}

const EPS = 1e-9;

export function schedulePlan(plan: Plan, opts: ScheduleOptions = {}): Schedule {
  const cal = new Calendar(opts.calendar);
  const today = opts.today ?? todayIso();
  const projectStart = cal.nextWorkday(opts.start ?? plan.start ?? today);
  const tasks = allTasks(plan);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dur = new Map<string, number>();
  const assumed = new Set<string>();
  for (const t of tasks) {
    if (t.milestone) dur.set(t.id, 0);
    else if (t.estimate) dur.set(t.id, estimateToDays(t.estimate));
    else {
      dur.set(t.id, 1);
      assumed.add(t.id);
    }
  }

  // Valid edges only (known, not self).
  const preds = new Map<string, { from: string; type: string; lag: number }[]>();
  for (const t of tasks) {
    preds.set(
      t.id,
      t.depends.filter((d) => d.id !== t.id && byId.has(d.id)).map((d) => ({ from: d.id, type: d.type, lag: d.lagDays })),
    );
  }

  const { order, cycles } = topoOrder(tasks.map((t) => t.id), preds);
  const inCycle = new Set(cycles.flat());

  // Forward pass.
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    const d = dur.get(id)!;
    let start = 0;
    for (const p of preds.get(id)!) {
      if (!ef.has(p.from)) continue; // a loop link: ignored
      const pes = es.get(p.from)!;
      const pef = ef.get(p.from)!;
      if (p.type === "SS") start = Math.max(start, pes + p.lag);
      else if (p.type === "FF") start = Math.max(start, pef + p.lag - d);
      else start = Math.max(start, pef + p.lag);
    }
    es.set(id, Math.max(0, start));
    ef.set(id, Math.max(0, start) + d);
  }
  const total = Math.max(0, ...ef.values());

  // Backward pass.
  const succs = new Map<string, { to: string; type: string; lag: number }[]>();
  for (const [to, list] of preds) for (const p of list) (succs.get(p.from) ?? succs.set(p.from, []).get(p.from)!).push({ to, type: p.type, lag: p.lag });
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const d = dur.get(id)!;
    let finish = total;
    for (const s of succs.get(id) ?? []) {
      if (!ls.has(s.to)) continue;
      if (s.type === "SS") finish = Math.min(finish, ls.get(s.to)! - s.lag + d);
      else if (s.type === "FF") finish = Math.min(finish, lf.get(s.to)! - s.lag);
      else finish = Math.min(finish, ls.get(s.to)! - s.lag);
    }
    lf.set(id, finish);
    ls.set(id, finish - d);
  }

  const out = new Map<string, ScheduledTask>();
  for (const t of tasks) {
    const s = es.get(t.id) ?? 0;
    const e = ef.get(t.id) ?? s;
    const slack = Math.max(0, (ls.get(t.id) ?? s) - s);
    const d = dur.get(t.id)!;
    const endDate = t.milestone || d === 0 ? cal.dateAt(projectStart, s) : cal.dateAt(projectStart, Math.max(s, Math.ceil(e - EPS) - 1));
    const finished = t.status === "done" || t.status === "skipped";
    out.set(t.id, {
      id: t.id,
      startOffset: s,
      endOffset: e,
      durationDays: d,
      start: cal.dateAt(projectStart, s),
      end: endDate,
      slack,
      critical: slack < EPS && !inCycle.has(t.id),
      overdue: !finished && (toDay(t.due ?? endDate) < toDay(today)),
      assumedDuration: assumed.has(t.id),
    });
  }
  const criticalPath = order.filter((id) => out.get(id)!.critical);
  const finishOffset = Math.max(0, Math.ceil(total - EPS) - 1);
  return {
    projectStart,
    finish: tasks.length ? cal.dateAt(projectStart, finishOffset) : projectStart,
    totalDays: total,
    tasks: out,
    criticalPath,
    cycles,
  };
}

/** Kahn's algorithm; tasks in loops are appended in file order and the loops reported. */
function topoOrder(ids: string[], preds: Map<string, { from: string }[]>): { order: string[]; cycles: string[][] } {
  const indeg = new Map(ids.map((id) => [id, preds.get(id)!.length]));
  const succ = new Map<string, string[]>();
  for (const id of ids) for (const p of preds.get(id)!) (succ.get(p.from) ?? succ.set(p.from, []).get(p.from)!).push(id);
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi]!;
    order.push(id);
    for (const s of succ.get(id) ?? []) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  const placed = new Set(order);
  const stuck = ids.filter((id) => !placed.has(id));
  const cycles = findCycles(stuck, preds);
  return { order: [...order, ...stuck], cycles };
}

function findCycles(stuck: string[], preds: Map<string, { from: string }[]>): string[][] {
  const set = new Set(stuck);
  const seen = new Set<string>();
  const cycles: string[][] = [];
  for (const startId of stuck) {
    if (seen.has(startId)) continue;
    const path: string[] = [];
    let cur: string | undefined = startId;
    const pos = new Map<string, number>();
    while (cur && set.has(cur) && !pos.has(cur)) {
      pos.set(cur, path.length);
      path.push(cur);
      cur = preds.get(cur)!.map((p) => p.from).find((f) => set.has(f));
    }
    if (cur && pos.has(cur)) {
      const loop = path.slice(pos.get(cur)!).reverse();
      if (!loop.some((id) => seen.has(id))) cycles.push(loop);
    }
    path.forEach((id) => seen.add(id));
  }
  return cycles;
}

// ---------------------------------------------------------------- progress, forecast, health

export interface Progress {
  percent: number;
  doneCount: number;
  countedTasks: number;
  overdueCount: number;
  /** Working days the scheduled finish is later (+) or earlier (-) than the baseline finish. */
  baselineVarianceDays: number | null;
  /** Finish date projected from the pace of work done so far. */
  forecastFinish: string | null;
  suggestedHealth: Health;
}

export function progressOf(plan: Plan, schedule: Schedule, opts: ScheduleOptions = {}): Progress {
  const cal = new Calendar(opts.calendar);
  const today = opts.today ?? todayIso();
  const tasks = allTasks(plan).filter((t) => t.status !== "skipped");
  const work = (t: Task) => (t.milestone ? 0 : Math.max(schedule.tasks.get(t.id)?.durationDays ?? 0, 0));
  const totalWork = tasks.reduce((s, t) => s + work(t), 0);
  const doneWork = tasks.filter((t) => t.status === "done").reduce((s, t) => s + work(t), 0);
  const inProgressWork = tasks.filter((t) => t.status === "progress").reduce((s, t) => s + work(t) / 2, 0);
  const counted = tasks.filter((t) => !t.milestone);
  const doneCount = counted.filter((t) => t.status === "done").length;
  const percent = totalWork > 0 ? Math.round(((doneWork + inProgressWork) / totalWork) * 100) : counted.length ? Math.round((doneCount / counted.length) * 100) : 0;
  const overdueCount = [...schedule.tasks.values()].filter((s) => s.overdue).length;

  const baselineEnds = allTasks(plan).map((t) => t.planned?.end).filter((d): d is string => !!d);
  const baselineFinish = baselineEnds.length ? baselineEnds.reduce((a, b) => (a > b ? a : b)) : null;
  const baselineVarianceDays = baselineFinish ? cal.workdaysBetween(baselineFinish, schedule.finish) : null;

  let forecastFinish: string | null = null;
  const elapsed = cal.workdaysBetween(schedule.projectStart, today);
  if (elapsed > 0 && doneWork + inProgressWork > 0 && totalWork > doneWork + inProgressWork) {
    const pace = (doneWork + inProgressWork) / elapsed;
    const remaining = totalWork - doneWork - inProgressWork;
    forecastFinish = cal.dateAt(today, Math.ceil(remaining / pace) - 1);
    if (forecastFinish < schedule.finish) forecastFinish = schedule.finish;
  }

  const allFinished = allTasks(plan).length > 0 && allTasks(plan).every((t) => t.status === "done" || t.status === "skipped");
  let suggestedHealth: Health = "On track";
  if (allFinished) suggestedHealth = "Complete";
  else {
    const target = baselineFinish ?? schedule.finish;
    const lateBy = forecastFinish ? cal.workdaysBetween(target, forecastFinish) : 0;
    const slip = Math.max(lateBy, baselineVarianceDays ?? 0);
    const span = Math.max(1, schedule.totalDays);
    if (slip > Math.max(10, span * 0.1)) suggestedHealth = "Off track";
    else if (slip > 0 || overdueCount > 0) suggestedHealth = "At risk";
  }
  return { percent, doneCount, countedTasks: counted.length, overdueCount, baselineVarianceDays, forecastFinish, suggestedHealth };
}

// ---------------------------------------------------------------- workload

/** Planned hours per owner per week (key: Monday's date), spread over each task's working days. */
export function workloadByWeek(plan: Plan, schedule: Schedule, opts: ScheduleOptions = {}): Map<string, Map<string, number>> {
  const cal = new Calendar(opts.calendar);
  const out = new Map<string, Map<string, number>>();
  for (const t of allTasks(plan)) {
    if (!t.owner || t.milestone || t.status === "done" || t.status === "skipped") continue;
    const s = schedule.tasks.get(t.id);
    if (!s || s.durationDays <= 0) continue;
    const days = Math.max(1, Math.ceil(s.durationDays - EPS));
    const perDay = (s.durationDays * HOURS_PER_DAY) / days;
    const person = out.get(t.owner) ?? out.set(t.owner, new Map()).get(t.owner)!;
    for (let i = 0; i < days; i++) {
      const date = cal.dateAt(schedule.projectStart, Math.floor(s.startOffset) + i);
      const monday = mondayOf(date);
      person.set(monday, (person.get(monday) ?? 0) + perDay);
    }
  }
  return out;
}

function mondayOf(iso: string): string {
  const d = toDay(iso);
  const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const back = (wd + 6) % 7;
  return new Date((d - back) * 86_400_000).toISOString().slice(0, 10);
}
