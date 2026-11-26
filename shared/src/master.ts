/**
 * Master plans (step K1): a master plan with its own tasks, plus sub-plans, scheduled as one.
 * Task IDs stay local to each plan; a task in another plan is written `key/T4` (`master/M1` for the
 * master's own). The parts are flattened into one plan (IDs prefixed with their plan's key), the
 * person-aware scheduler runs once, so one person's hours count across every plan and a slip in
 * one plan moves whatever waits on it elsewhere; the results are split back per plan.
 */
import { levelPlan, type LeveledSchedule, type LevelOptions } from "./level";
import type { ScheduledTask } from "./schedule";
import type { Plan } from "./schema";

export interface MasterPart {
  /** "master" for the master plan; a short key for each sub-plan ("bathroom-2"). */
  key: string;
  title: string;
  plan: Plan;
}

const CROSS = /^([a-z0-9][a-z0-9-]{0,39})\/([TM]\d+)$/;
export const MASTER_KEY = "master";

/** "reception/T4" → { key: "reception", id: "T4" }; a plain "T4" → null. */
export function crossRef(id: string): { key: string; id: string } | null {
  const m = CROSS.exec(id);
  return m ? { key: m[1]!, id: m[2]! } : null;
}

/** A plan key from a title: "Bathroom 2" → "bathroom-2" (unique among `taken`). */
export function planKey(title: string, taken: Iterable<string> = []): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "plan";
  const used = new Set(taken);
  let key = base === MASTER_KEY ? `${base}-plan` : base;
  for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
  return key;
}

/** The parts as one plan, every task ID prefixed with its plan's key. */
export function flattenMaster(parts: MasterPart[]): Plan {
  const master = parts.find((p) => p.key === MASTER_KEY) ?? parts[0]!;
  const keys = new Set(parts.map((p) => p.key));
  return {
    ...structuredClone(master.plan),
    phases: parts.flatMap((part) =>
      part.plan.phases.map((ph) => ({
        ...structuredClone(ph),
        id: `${part.key}/${ph.id}`,
        title: `${part.title}: ${ph.title}`,
        tasks: ph.tasks.map((t) => ({
          ...structuredClone(t),
          id: `${part.key}/${t.id}`,
          // Local links get this plan's key; links to plans that aren't in the master are dropped.
          depends: t.depends.flatMap((d) => {
            const x = crossRef(d.id);
            if (!x) return [{ ...d, id: `${part.key}/${d.id}` }];
            return keys.has(x.key) ? [{ ...d }] : [];
          }),
        })),
      })),
    ),
  };
}

export interface MasterSchedule {
  /** The schedule of the whole master, task IDs as `key/T1`. */
  schedule: LeveledSchedule;
  flat: Plan;
  finish: string;
  /** One task's dates by its plan and local ID. */
  task(key: string, id: string): ScheduledTask | undefined;
  /** Per plan: its start and finish, and whether it holds tasks on the master's critical path. */
  plans: Map<string, { start: string; finish: string; critical: boolean }>;
}

export function masterSchedule(parts: MasterPart[], opts: LevelOptions = {}): MasterSchedule {
  const flat = flattenMaster(parts);
  const schedule = levelPlan(flat, opts);
  const plans = new Map<string, { start: string; finish: string; critical: boolean }>();
  for (const part of parts) {
    const own = [...schedule.tasks.values()].filter((s) => s.id.startsWith(`${part.key}/`));
    if (!own.length) continue;
    plans.set(part.key, {
      start: own.reduce((a, b) => (a.start < b.start ? a : b)).start,
      finish: own.reduce((a, b) => (a.end > b.end ? a : b)).end,
      critical: own.some((s) => s.critical),
    });
  }
  return { schedule, flat, finish: schedule.finish, task: (key, id) => schedule.tasks.get(`${key}/${id}`), plans };
}
