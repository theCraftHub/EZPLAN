/**
 * The EZPLAN data model. Everything in a `.ezplan` file maps onto these types,
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
  due: IsoDate.optional(),
  depends: z.array(Dependency),
  planned: DateRange.optional(),
  notes: z.array(z.string()),
  done: Attribution.optional(),
  skipped: Attribution.optional(),
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
  team: z.array(TeamMember),
  phases: z.array(Phase),
  /** Unknown front-matter keys, preserved in order of appearance. */
  extra: z.record(z.string(), z.string()),
});
export type Plan = z.infer<typeof Plan>;

/** Working-day conversions used everywhere (estimates are stored as written). */
export const HOURS_PER_DAY = 8;
export const DAYS_PER_WEEK = 5;

export function estimateToDays(e: Estimate | undefined): number {
  if (!e) return 0;
  if (e.unit === "h") return e.amount / HOURS_PER_DAY;
  if (e.unit === "w") return e.amount * DAYS_PER_WEEK;
  return e.amount;
}

export function allTasks(plan: Plan): Task[] {
  return plan.phases.flatMap((p) => p.tasks);
}
