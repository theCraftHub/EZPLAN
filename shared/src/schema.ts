/**
 * The plan data model. Everything in a plan file maps onto these types,
 * and the parser (`parse.ts`) and exporter (`export.ts`) convert between them.
 * See `docs/format.md` for the human-readable spec.
 */
import { z } from "zod";

export const FORMAT_VERSION = 1;

export const TaskStatus = z.enum(["todo", "progress", "done", "skipped"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const EstimateUnit = z.enum(["h", "d", "w"]);
export type EstimateUnit = z.infer<typeof EstimateUnit>;

/** ISO calendar date, YYYY-MM-DD. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Estimate = z.object({
  amount: z.number().positive(),
  unit: EstimateUnit,
});
export type Estimate = z.infer<typeof Estimate>;

export const DependencyType = z.enum(["FS", "SS", "FF"]);
export type DependencyType = z.infer<typeof DependencyType>;

export const Dependency = z.object({
  id: z.string(),
  type: DependencyType,
  /** Lag in working days; negative = lead. */
  lagDays: z.number(),
});
export type Dependency = z.infer<typeof Dependency>;

export const Attribution = z.object({
  date: IsoDate,
  /** Display name of the person who marked it, as written in the file. */
  by: z.string().optional(),
});
export type Attribution = z.infer<typeof Attribution>;

export const DateRange = z.object({ start: IsoDate, end: IsoDate });
export type DateRange = z.infer<typeof DateRange>;

export const Priority = z.enum(["low", "medium", "high"]);
export type Priority = z.infer<typeof Priority>;

export const Subtask = z.object({
  title: z.string(),
  status: TaskStatus,
});
export type Subtask = z.infer<typeof Subtask>;

export const Task = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStatus,
  milestone: z.boolean(),
  estimate: Estimate.optional(),
  owner: z.string().optional(),
  /** The department doing it (master plans): Facilities, IT, HR… */
  dept: z.string().optional(),
  due: IsoDate.optional(),
  depends: z.array(Dependency),
  planned: DateRange.optional(),
  notes: z.array(z.string()),
  done: Attribution.optional(),
  skipped: Attribution.optional(),
  /** Who must approve it before it counts as Done ("approver: Pat"). */
  approver: z.string().optional(),
  /** "Approved by": set only by the approver's action, never from a file a client sends. */
  approved: Attribution.optional(),
  /** Repeats when done ("weekly", "every 2 weeks", "monthly", "weekdays"…). */
  repeat: z.string().optional(),
  priority: Priority.optional(),
  tags: z.array(z.string()),
  subtasks: z.array(Subtask),
  /** Unknown `key: value` attributes kept so newer files survive a round trip. */
  extra: z.record(z.string(), z.string()),
});
export type Task = z.infer<typeof Task>;

export const Phase = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  tasks: z.array(Task),
});
export type Phase = z.infer<typeof Phase>;

export const TeamMember = z.object({
  name: z.string(),
  email: z.string().optional(),
});
export type TeamMember = z.infer<typeof TeamMember>;

export const Plan = z.object({
  version: z.number().int().positive(),
  id: z.string().optional(),
  title: z.string(),
  goal: z.string().optional(),
  doneWhen: z.string().optional(),
  start: IsoDate.optional(),
  currency: z.string().optional(),
  baselineSet: IsoDate.optional(),
  basedOn: z.string().optional(),
  /** Length of a working day in hours for this plan's estimates ("hours_per_day:" header). Unset = the workspace's. */
  hoursPerDay: z.number().positive().max(24).optional(),
  team: z.array(TeamMember),
  /** Plan-wide notes and assumptions ("note:" lines in the header). */
  notes: z.array(z.string()).optional(),
  phases: z.array(Phase),
  /** Unknown front-matter keys, preserved in order of appearance. */
  extra: z.record(z.string(), z.string()),
});
export type Plan = z.infer<typeof Plan>;

/** Defaults when no work week is given (estimates are stored as written). */
export const HOURS_PER_DAY = 8;
export const DAYS_PER_WEEK = 5;

/**
 * A workspace's standard work week (a workspace setting). "Full time" means this, people with
 * no availability set are assumed to work it, and "1d"/"1w" estimates mean one of its days/weeks.
 */
export interface WorkWeek {
  /** Hours in a full-time week, e.g. 40, 37.5, 35. */
  hoursPerWeek: number;
  /** Working days, 0 = Sunday ... 6 = Saturday. */
  workdays: number[];
}
export const DEFAULT_WORK_WEEK: WorkWeek = { hoursPerWeek: 40, workdays: [1, 2, 3, 4, 5] };

/** Hours in one working day of a work week: 40 h over 5 days = 8; 37.5 over 5 = 7.5. */
export function hoursPerDay(week: Partial<WorkWeek> = {}): number {
  const days = week.workdays?.length || DAYS_PER_WEEK;
  return (week.hoursPerWeek ?? HOURS_PER_DAY * days) / days;
}

/** The day length that applies to a plan: its own header setting, else the workspace's. */
export function planDayLength(plan: Pick<Plan, "hoursPerDay">, week?: Partial<WorkWeek>): number {
  return plan.hoursPerDay ?? hoursPerDay(week);
}

export function estimateToDays(e: Estimate | undefined, dayHours = HOURS_PER_DAY, daysPerWeek = DAYS_PER_WEEK): number {
  if (!e) return 0;
  if (e.unit === "h") return e.amount / dayHours;
  if (e.unit === "w") return e.amount * daysPerWeek;
  return e.amount;
}

/** Done, but its approver hasn't approved it yet. */
export const awaitingApproval = (t: Task) => t.status === "done" && !!t.approver && !t.approved;
/** Done and, where an approval is needed, approved: what counts towards progress and health. */
export const countsAsDone = (t: Task) => t.status === "done" && (!t.approver || !!t.approved);
/** Whether a name refers to this person: the full name, or the first name ("Pat" for "Pat Lee"). */
export function sameName(written: string | undefined, person: string): boolean {
  const a = (written ?? "").trim().toLowerCase();
  const b = person.trim().toLowerCase();
  return !!a && (a === b || a === b.split(/\s+/)[0]);
}

export function allTasks(plan: Plan): Task[] {
  return plan.phases.flatMap((p) => p.tasks);
}

/**
 * Waiting time (permit review, delivery lead time, curing): takes calendar time but nobody's
 * working hours. Marked with the #wait tag, or recognized from titles AI assistants write.
 */
export function isWaiting(t: Task): boolean {
  return t.tags.some((g) => g.toLowerCase() === "wait") || /\b(wait|waiting|lead[ -]time)\b/i.test(t.title);
}
