/**
 * Availability people give a plan (hours a week, working days, days off). Validated the same way
 * on the server and in the app.
 */
import { z } from "zod";
import type { PersonAvailability } from "./level";
import { allTasks, type Plan } from "./schema";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Availability = z
  .object({
    hoursPerWeek: z.number().min(1).max(60).optional(),
    workdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    timeOff: z
      .array(z.object({ start: IsoDate, end: IsoDate, label: z.string().max(60).optional() }).refine((r) => r.start <= r.end, "A time off range must end on or after its start."))
      .max(50)
      .optional(),
    rate: z.number().min(0).max(100000).optional(),
  })
  .strict();

export const MAX_PLAN_PEOPLE = 200;

/** A checked copy, or null when anything is out of range (hours 1 to 60, days 0 to 6, up to 50 days-off ranges). */
export function parseAvailability(input: unknown): PersonAvailability | null {
  const r = Availability.safeParse(input);
  if (!r.success) return null;
  const a = r.data;
  return {
    ...(a.hoursPerWeek !== undefined ? { hoursPerWeek: Math.round(a.hoursPerWeek * 2) / 2 } : {}),
    ...(a.workdays ? { workdays: [...new Set(a.workdays)].sort() } : {}),
    ...(a.timeOff ? { timeOff: a.timeOff.map((t) => ({ start: t.start, end: t.end, ...(t.label ? { label: t.label } : {}) })) } : {}),
    ...(a.rate !== undefined ? { rate: Math.round(a.rate * 100) / 100 } : {}),
  };
}

/** Everyone a plan names: task owners and the team line, once each (first spelling wins). */
export function planPeople(plan: Plan): string[] {
  const seen = new Map<string, string>();
  const add = (n?: string) => {
    const name = n?.trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  };
  plan.team.forEach((m) => add(m.name));
  allTasks(plan).forEach((t) => add(t.owner));
  return [...seen.values()];
}
