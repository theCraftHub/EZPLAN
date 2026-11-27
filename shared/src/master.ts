/**
 * Master plans (step K1): a master plan with its own tasks, plus sub-plans, scheduled as one.
 * Task IDs stay local to each plan; a task in another plan is written `key/T4` (`master/M1` for the
 * master's own). The parts are flattened into one plan (IDs prefixed with their plan's key), the
 * person-aware scheduler runs once, so one person's hours count across every plan and a slip in
 * one plan moves whatever waits on it elsewhere; the results are split back per plan.
 */
import { levelPlan, type Booking, type LeveledSchedule, type LevelOptions, type PersonAvailability, type StartReason } from "./level";
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

/**
 * The master as one plan's people may see it: their plan in full; every other plan stripped to
 * what scheduling needs (length, status, links, owner). Real titles are kept only for tasks this
 * plan links to, and real names only for people who also work in this plan; everyone else gets a
 * stand-in ("Person 3"). Running `masterSchedule` on it gives this plan exactly the whole master's
 * dates, so the app can recompute live as edits arrive.
 */
export function maskedMaster(parts: MasterPart[], key: string, people: Record<string, PersonAvailability> = {}): { parts: MasterPart[]; people: Record<string, PersonAvailability> } {
  const own = parts.find((p) => p.key === key);
  const ownTasks = own ? own.plan.phases.flatMap((p) => p.tasks) : [];
  const ownPeople = new Set(ownTasks.map((t) => t.owner?.toLowerCase()).filter((n): n is string => !!n));
  const linked = new Set(ownTasks.flatMap((t) => t.depends.map((d) => d.id)).filter((id) => crossRef(id)));
  const alias = new Map<string, string>();
  const nameFor = (owner: string | undefined) => {
    if (!owner) return undefined;
    const k = owner.toLowerCase();
    if (ownPeople.has(k)) return owner;
    if (!alias.has(k)) alias.set(k, `Person ${alias.size + 1}`);
    return alias.get(k)!;
  };
  const masked = parts.map((part) => {
    if (part.key === key) return part;
    return {
      key: part.key,
      title: part.title,
      plan: {
        ...part.plan,
        goal: undefined,
        doneWhen: undefined,
        team: [],
        extra: {},
        phases: part.plan.phases.map((ph, i) => ({
          id: ph.id,
          title: `Part ${i + 1}`,
          tasks: ph.tasks.map((t) => ({
            id: t.id,
            title: linked.has(`${part.key}/${t.id}`) ? t.title : "",
            status: t.status,
            milestone: t.milestone,
            ...(t.estimate ? { estimate: t.estimate } : {}),
            ...(t.owner ? { owner: nameFor(t.owner)! } : {}),
            ...(t.due ? { due: t.due } : {}),
            ...(t.priority ? { priority: t.priority } : {}),
            depends: t.depends,
            notes: [],
            tags: [],
            subtasks: [],
            extra: {},
          })),
        })),
      } as Plan,
    };
  });
  const maskedPeople: Record<string, PersonAvailability> = {};
  for (const [name, a] of Object.entries(people)) {
    const k = name.toLowerCase();
    if (ownPeople.has(k)) maskedPeople[name] = a;
    else if (alias.has(k)) maskedPeople[alias.get(k)!] = { ...(a.hoursPerWeek !== undefined ? { hoursPerWeek: a.hoursPerWeek } : {}), ...(a.workdays ? { workdays: a.workdays } : {}), ...(a.timeOff ? { timeOff: a.timeOff.map((o) => ({ start: o.start, end: o.end })) } : {}), ...(a.busy ? { busy: a.busy } : {}) } as PersonAvailability;
  }
  return { parts: masked, people: maskedPeople };
}

/**
 * One plan's part of a master schedule, with its own task IDs, so its pages (checklist, timeline,
 * Team, Plan Check) work as for any plan. Reasons that point at other plans are put in words.
 */
export function localSchedule(ms: MasterSchedule, parts: MasterPart[], key: string): LeveledSchedule {
  const pre = `${key}/`;
  const strip = (id: string) => (id.startsWith(pre) ? id.slice(pre.length) : id);
  const titleOf = (k: string) => parts.find((p) => p.key === k)?.title ?? k;
  const taskTitle = (ref: { key: string; id: string }) => parts.find((p) => p.key === ref.key)?.plan.phases.flatMap((p) => p.tasks).find((t) => t.id === ref.id)?.title || "a task";
  const tasks = new Map([...ms.schedule.tasks].filter(([id]) => id.startsWith(pre)).map(([id, s]) => [strip(id), { ...s, id: strip(id) }]));
  const reasons = new Map<string, StartReason>();
  for (const [id, r] of ms.schedule.reasons) {
    if (!id.startsWith(pre)) continue;
    const other = r.kind === "depends" ? crossRef(r.on) : r.kind === "person" ? crossRef(r.after) : null;
    if (other && other.key !== key) reasons.set(strip(id), { kind: "other-plan", plan: titleOf(other.key), title: taskTitle(other), ...(r.kind === "person" ? { person: r.person } : {}) });
    else reasons.set(strip(id), r.kind === "depends" ? { ...r, on: strip(r.on) } : r.kind === "person" ? { ...r, after: strip(r.after) } : r);
  }
  const bookings = new Map<string, Map<string, Booking[]>>();
  for (const [person, days] of ms.schedule.bookings) {
    const mine = new Map([...days].map(([d, list]) => [d, list.filter((b) => b.taskId.startsWith(pre)).map((b) => ({ ...b, taskId: strip(b.taskId) }))] as const).filter(([, l]) => l.length));
    if (mine.size) bookings.set(person, mine);
  }
  const own = [...tasks.values()];
  return {
    ...ms.schedule,
    projectStart: own.length ? own.reduce((a, b) => (a.start < b.start ? a : b)).start : ms.schedule.projectStart,
    finish: own.length ? own.reduce((a, b) => (a.end > b.end ? a : b)).end : ms.schedule.projectStart,
    tasks,
    criticalPath: ms.schedule.criticalPath.filter((id) => id.startsWith(pre)).map(strip),
    cycles: ms.schedule.cycles.map((c) => c.filter((id) => id.startsWith(pre)).map(strip)).filter((c) => c.length),
    reasons,
    bookings,
    unplaceable: ms.schedule.unplaceable.filter((id) => id.startsWith(pre)).map(strip),
  };
}

/**
 * A whole master plan written as one text (from an AI assistant or by hand): the usual header and
 * whole-building tasks first, then each plan under its own `# Plan: Title` heading. Links between
 * plans use the plan's key (`reception/T2`, from its title). Returns null when the text has no
 * `# Plan:` headings (an ordinary plan).
 */
export function splitMasterText(text: string, formatKey: string): { master: string; title: string; plans: { title: string; key: string; text: string }[] } | null {
  const src = text.replace(/\r\n/g, "\n");
  const heads = [...src.matchAll(/^#[ \t]+Plan:[ \t]*(.+?)[ \t]*$/gim)];
  if (!heads.length) return null;
  const head = src.slice(0, heads[0]!.index);
  const front = /^\s*---\n([\s\S]*?)\n---\n?/.exec(head);
  const fields = front ? front[1]! : "";
  const title = /^title:\s*(.+)$/im.exec(fields)?.[1]?.trim() || "Master plan";
  const start = /^start:\s*(\d{4}-\d{2}-\d{2})/im.exec(fields)?.[1];
  const body = front ? head.slice(front[0].length) : head;
  const masterBody = /^##\s/m.test(body) ? body : `${body.trim() ? `${body.trim()}\n` : ""}## P1: Whole building\n`;
  const master = `---\n${fields.trim() || `${formatKey}: 1\ntitle: ${title}`}\n---\n${masterBody}`;
  const taken: string[] = [MASTER_KEY];
  const plans = heads.map((h, i) => {
    const t = h[1]!.trim().slice(0, 120);
    const key = planKey(t, taken);
    taken.push(key);
    const part = src.slice(h.index! + h[0].length, i + 1 < heads.length ? heads[i + 1]!.index : src.length).replace(/^\n+/, "");
    return { title: t, key, text: `---\n${formatKey}: 1\ntitle: ${t}\n${start ? `start: ${start}\n` : ""}---\n${part.trim()}\n` };
  });
  return { master, title, plans };
}
