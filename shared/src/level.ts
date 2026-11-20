/**
 * Person-aware ("resource-leveled") scheduling, plan section 3c.
 *
 * schedulePlan() assumes unlimited people: every task starts as soon as its dependencies
 * allow, so one person's tasks can run side by side. levelPlan() also respects each
 * person's available hours per day (hours per week for this project, working days, time
 * off, calendar-busy hours) and works one task at a time per person. Every task records
 * why it starts when it does, so the app can explain each date. Deterministic, no AI.
 */
import { Calendar, fromDay, toDay, todayIso } from "./calendar";
import { calendarOf, milestoneDate, schedulePlan, type Schedule, type ScheduledTask, type ScheduleOptions } from "./schedule";
import { allTasks, estimateToDays, HOURS_PER_DAY, isWaiting, planDayLength, type Plan, type Task } from "./schema";

export interface TimeOff {
  start: string;
  /** Inclusive. */
  end: string;
  label?: string;
}

export interface PersonAvailability {
  /** Hours per week this person can give this project. Default: full time (8h per working day). */
  hoursPerWeek?: number;
  /** Days of the week they work (0 = Sunday). Default: the project calendar's workdays. */
  workdays?: number[];
  timeOff?: TimeOff[];
  /** Hours already busy per date (from a connected calendar). Only hours are kept, never event details. */
  busy?: Record<string, number>;
}

export interface LevelOptions extends ScheduleOptions {
  /** Availability by person name (matched case-insensitively to task owners). */
  people?: Record<string, PersonAvailability>;
}

export type StartReason =
  | { kind: "start" }
  | { kind: "depends"; on: string }
  | { kind: "person"; person: string; after: string }
  | { kind: "time-off"; person: string; from: string; to: string; label?: string }
  | { kind: "no-hours"; person: string };

export interface Booking {
  taskId: string;
  hours: number;
}

export interface LeveledSchedule extends Schedule {
  leveled: true;
  /** Why each task starts when it does. */
  reasons: Map<string, StartReason>;
  /** Hours booked per person per date: what the Team schedule grid draws. */
  bookings: Map<string, Map<string, Booking[]>>;
  /** Owners with no availability given (assumed full time). */
  assumedFullTime: string[];
  /** The full-time week those owners were given, in hours (the workspace setting). */
  fullTimeHours: number;
  /** Tasks that couldn't be placed (their owner has no available hours at all). */
  unplaceable: string[];
}

const EPS = 1e-9;
const MAX_DAYS = 2600; // ~10 working years: a safety stop, never reached by real plans

/**
 * Hours a person can give this project on a date (0 on days off). `dayHours` is the workspace's
 * standard day (full time); someone with no availability set works exactly that.
 */
export function availableHours(a: PersonAvailability | undefined, date: string, cal: Calendar, dayHours = HOURS_PER_DAY): number {
  if (!cal.isWorkday(date)) return 0;
  if (!a) return dayHours;
  const days = a.workdays ?? [1, 2, 3, 4, 5];
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (!days.includes(wd)) return 0;
  if (a.timeOff?.some((o) => date >= o.start && date <= o.end)) return 0;
  const perDay = (a.hoursPerWeek ?? dayHours * days.length) / Math.max(1, days.length);
  // Meetings come out of the working day: the standard day, or a longer one if they work longer.
  const busy = a.busy?.[date] ?? 0;
  return Math.max(0, Math.min(perDay, Math.max(dayHours, perDay) - busy));
}

export function levelPlan(plan: Plan, opts: LevelOptions = {}): LeveledSchedule {
  const base = schedulePlan(plan, opts); // for slack (priority) and cycles
  const cal = new Calendar(calendarOf(opts));
  const dayHours = planDayLength(plan, opts.workWeek);
  const weekDays = calendarOf(opts).workdays?.length ?? 5;
  const start = base.projectStart;
  const tasks = allTasks(plan);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const order = new Map(tasks.map((t, i) => [t.id, i]));

  const people = new Map<string, PersonAvailability>();
  for (const [name, a] of Object.entries(opts.people ?? {})) people.set(name.toLowerCase(), a);
  const assumedFullTime = [...new Set(tasks.filter((t) => t.owner && !people.has(t.owner.toLowerCase())).map((t) => t.owner!))];

  // Work left in hours. Finished work takes no time; in-progress work counts half (as checks do).
  const hoursLeft = new Map<string, number>();
  const isFinished = (t: Task) => t.status === "done" || t.status === "skipped";
  const durDays = (t: Task) => (t.milestone || isFinished(t) ? 0 : (t.estimate ? estimateToDays(t.estimate, dayHours, weekDays) : 1) * (t.status === "progress" ? 0.5 : 1));
  for (const t of tasks) hoursLeft.set(t.id, durDays(t) * dayHours);
  const personal = (t: Task) => !!t.owner && !t.milestone && !isWaiting(t) && !isFinished(t);

  const inCycle = new Set(base.cycles.flat());
  const preds = new Map(tasks.map((t) => [t.id, t.depends.filter((d) => d.id !== t.id && byId.has(d.id) && !(inCycle.has(t.id) && inCycle.has(d.id)))]));
  const succs = new Map<string, string[]>();
  for (const [to, list] of preds) for (const d of list) (succs.get(d.id) ?? succs.set(d.id, []).get(d.id)!).push(to);

  const startAt = new Map<string, number>(); // working-day offsets, fractional within a day
  const endAt = new Map<string, number>();
  const reasons = new Map<string, StartReason>();
  const readyAt = new Map<string, { at: number; reason: StartReason }>();
  const bookings = new Map<string, Map<string, Booking[]>>();

  /** When can `id` start, given its predecessors? Null until they're far enough along. */
  const readiness = (id: string): { at: number; reason: StartReason } | null => {
    let at = 0;
    let reason: StartReason = { kind: "start" };
    for (const d of preds.get(id)!) {
      const ref = d.type === "FS" ? endAt.get(d.id) : startAt.get(d.id);
      if (ref === undefined) return null;
      const t = ref + d.lagDays;
      if (t > at + EPS) {
        at = t;
        reason = { kind: "depends", on: d.id };
      }
    }
    return { at: Math.max(0, at), reason };
  };

  const pending = new Set(tasks.map((t) => t.id));
  const placeFree = (id: string, at: number, reason: StartReason) => {
    // Milestones, waiting tasks, unowned and finished tasks: calendar time only, nobody's hours.
    const t = byId.get(id)!;
    startAt.set(id, at);
    endAt.set(id, at + durDays(t));
    reasons.set(id, reason);
    pending.delete(id);
    wake(id);
  };
  const wake = (id: string) => {
    for (const s of succs.get(id) ?? []) {
      if (!pending.has(s) || readyAt.has(s)) continue;
      const r = readiness(s);
      if (!r) continue;
      if (personal(byId.get(s)!)) readyAt.set(s, r);
      else placeFree(s, r.at, r.reason);
    }
  };
  for (const t of tasks) {
    if (!pending.has(t.id) || readyAt.has(t.id)) continue;
    const r = readiness(t.id);
    if (!r) continue;
    if (personal(t)) readyAt.set(t.id, r);
    else placeFree(t.id, r.at, r.reason);
  }

  // Day by day, each person works their best ready task, one at a time, until their hours run out.
  const ownerKey = (t: Task) => t.owner!.toLowerCase();
  const displayName = new Map(tasks.filter((t) => t.owner).map((t) => [ownerKey(t), t.owner!]));
  const current = new Map<string, string>(); // person -> task in hand
  const lastEnd = new Map<string, { id: string; at: number }>();
  const offSince = new Map<string, { from: string; to: string; label?: string }>();
  const rank = (id: string) => {
    const t = byId.get(id)!;
    const pr = t.priority === "high" ? 0 : t.priority === "low" ? 2 : 1;
    return [base.tasks.get(id)?.slack ?? 0, t.due ? toDay(t.due) : Infinity, pr, order.get(id)!];
  };
  const better = (a: string, b: string) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! < rb[i]!;
    return false;
  };

  for (let day = 0; day < MAX_DAYS && [...pending].some((id) => personal(byId.get(id)!)); day++) {
    const date = cal.dateAt(start, day);
    for (const key of displayName.keys()) {
      const avail = people.get(key);
      const cap = availableHours(avail, date, cal, dayHours);
      if (cap <= EPS) {
        const off = avail?.timeOff?.find((o) => date >= o.start && date <= o.end);
        if (off) offSince.set(key, { from: off.start, to: off.end, label: off.label });
        continue;
      }
      let used = 0; // hours of this person's day already used
      for (;;) {
        let id = current.get(key);
        if (!id) {
          let best: string | undefined;
          for (const [cand, r] of readyAt) {
            if (ownerKey(byId.get(cand)!) !== key || r.at >= day + 1 - EPS) continue;
            if (!best || better(cand, best)) best = cand;
          }
          if (!best) break;
          id = best;
          const r = readyAt.get(id)!;
          readyAt.delete(id);
          // A task can't start before it's ready (a fraction of the way through this person's day).
          used = Math.max(used, (r.at - day) * cap);
          if (used >= cap - EPS) {
            readyAt.set(id, r); // ready too late in the day: try tomorrow
            break;
          }
          const at = day + used / cap;
          startAt.set(id, at);
          const prev = lastEnd.get(key);
          const off = offSince.get(key);
          let reason = r.reason;
          if (off && off.to >= cal.dateAt(start, r.at)) reason = { kind: "time-off", person: displayName.get(key)!, ...off };
          else if (at > r.at + EPS && prev && prev.at >= at - EPS) reason = { kind: "person", person: displayName.get(key)!, after: prev.id };
          else if (at > r.at + 1) reason = { kind: "no-hours", person: displayName.get(key)! };
          reasons.set(id, reason);
          current.set(key, id);
        }
        const left = hoursLeft.get(id)!;
        const work = Math.min(cap - used, left);
        if (work > EPS) {
          const perPerson = bookings.get(displayName.get(key)!) ?? bookings.set(displayName.get(key)!, new Map()).get(displayName.get(key)!)!;
          (perPerson.get(date) ?? perPerson.set(date, []).get(date)!).push({ taskId: id, hours: work });
        }
        used += work;
        hoursLeft.set(id, left - work);
        if (left - work <= EPS) {
          const at = day + used / cap;
          endAt.set(id, at);
          current.delete(key);
          lastEnd.set(key, { id, at });
          offSince.delete(key);
          pending.delete(id);
          wake(id);
          continue;
        }
        break; // out of hours today
      }
    }
  }

  // Anything left: an owner with no hours ever, or a loop. Place by dependencies only.
  const unplaceable = [...pending];
  for (const id of unplaceable) {
    const r = readiness(id) ?? { at: 0, reason: { kind: "start" } as StartReason };
    const t = byId.get(id)!;
    placeFree(id, r.at, t.owner ? { kind: "no-hours", person: t.owner } : r.reason);
  }
  // Finish-to-finish links: a task can't finish before its predecessor (+ lag).
  for (const t of tasks) for (const d of preds.get(t.id)!) if (d.type === "FF") endAt.set(t.id, Math.max(endAt.get(t.id)!, endAt.get(d.id)! + d.lagDays));

  // Critical chain: walk back from the last task through whatever set each start.
  const total = Math.max(0, ...endAt.values());
  const critical = new Set<string>();
  const stack = tasks.filter((t) => endAt.get(t.id)! >= total - EPS).map((t) => t.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (critical.has(id)) continue;
    critical.add(id);
    const r = reasons.get(id)!;
    if (r.kind === "depends") stack.push(r.on);
    else if (r.kind === "person") stack.push(r.after);
    else for (const d of preds.get(id)!) if (Math.abs((endAt.get(d.id) ?? -1) - startAt.get(id)!) < EPS) stack.push(d.id);
  }

  const today = opts.today ?? todayIso();
  const out = new Map<string, ScheduledTask>();
  for (const t of tasks) {
    const s = startAt.get(t.id)!;
    const e = endAt.get(t.id)!;
    const endDate = t.milestone ? milestoneDate(cal, start, s) : e - s < EPS ? cal.dateAt(start, s) : cal.dateAt(start, Math.max(s, Math.ceil(e - EPS) - 1));
    out.set(t.id, {
      id: t.id,
      startOffset: s,
      endOffset: e,
      durationDays: e - s,
      start: t.milestone ? endDate : cal.dateAt(start, s),
      end: endDate,
      slack: critical.has(t.id) ? 0 : Math.max(0, total - e),
      critical: critical.has(t.id),
      overdue: !isFinished(t) && toDay(t.due ?? endDate) < toDay(today),
      assumedDuration: base.tasks.get(t.id)!.assumedDuration,
    });
  }
  const finishOffset = Math.max(0, Math.ceil(total - EPS) - 1);
  return {
    projectStart: start,
    finish: tasks.length ? cal.dateAt(start, finishOffset) : start,
    totalDays: total,
    tasks: out,
    criticalPath: tasks.map((t) => t.id).filter((id) => critical.has(id)).sort((a, b) => startAt.get(a)! - startAt.get(b)!),
    cycles: base.cycles,
    leveled: true,
    reasons,
    bookings,
    assumedFullTime,
    fullTimeHours: dayHours * weekDays,
    unplaceable: unplaceable.filter((id) => byId.get(id)!.owner),
  };
}

/** Plain-language reason for a task's start date, e.g. "Starts Dec 2 because Alex is on T13 until then." */
export function explainStart(s: LeveledSchedule, id: string, plan: Plan): string {
  const r = s.reasons.get(id);
  const st = s.tasks.get(id);
  if (!r || !st) return "";
  const title = (tid: string) => {
    const t = allTasks(plan).find((x) => x.id === tid);
    return t ? `${tid} "${t.title}"` : tid;
  };
  const when = fmt(st.start);
  switch (r.kind) {
    case "start":
      return `Starts ${when}, the project start.`;
    case "depends":
      return `Starts ${when} because it waits on ${title(r.on)}.`;
    case "person":
      return `Starts ${when} because ${r.person} is on ${title(r.after)} until then.`;
    case "time-off":
      return `Starts ${when} because ${r.person} is off ${fmt(r.from)} to ${fmt(r.to)}${r.label ? ` (${r.label})` : ""}.`;
    case "no-hours":
      return `Starts ${when} because ${r.person} has no free hours before then.`;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Re-exported so callers can build their own day grid. */
export { fromDay, toDay };
