/**
 * "Update with my AI" (plan section 2b): compare the current plan with the assistant's reply,
 * task by task (matched by ID), and turn the changes the person accepts into ordinary edits.
 *
 * Safe-merge rules:
 * - Progress never comes from a reply: status, "Done by", done and skipped dates stay as they are.
 *   A status change in the reply is shown as a suggestion only.
 * - Tasks missing from the reply are kept unless the person chooses to remove them.
 * - Done tasks can't be removed.
 * - Names hidden with "Hide names and emails" are put back first (restoreNames).
 */
import type { EditableField, Op, PlanField } from "./ops";
import { restoreNames } from "./prompts";
import type { Plan, Task } from "./schema";

const FIELDS: EditableField[] = ["title", "owner", "due", "estimate", "depends", "notes", "tags", "priority"];
const PLAN_FIELDS: PlanField[] = ["title", "goal", "doneWhen"];

export type UpdateChange = {
  /** Stable key for accept/reject in the preview. */
  key: string;
  /** Plain-language line for the preview. */
  text: string;
  /** Accepted unless the person unticks it (removals of missing tasks start unticked). */
  defaultOn: boolean;
  /** False for information only (status suggestions, done tasks that can't be removed). */
  applicable: boolean;
} & (
  | { kind: "plan"; field: PlanField; to: string | undefined }
  | { kind: "addPhase"; phase: { id: string; title: string; description?: string }; afterId?: string }
  | { kind: "renamePhase"; phaseId: string; to: string }
  | { kind: "addTask"; phaseId: string; task: Task; afterId?: string }
  | { kind: "edit"; taskId: string; field: EditableField; to: unknown }
  | { kind: "move"; taskId: string; phaseId: string; afterId?: string }
  | { kind: "remove"; taskId: string }
  | { kind: "status"; taskId: string }
);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const show = (v: unknown): string => {
  if (v === undefined || v === null || (Array.isArray(v) && !v.length)) return "nothing";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" && x && "id" in x ? (x as { id: string }).id : String(x))).join(", ");
  if (typeof v === "object" && v && "amount" in v) {
    const e = v as unknown as { amount: number; unit: string };
    return `${e.amount}${e.unit}`;
  }
  return String(v);
};
const FIELD_NAME: Record<EditableField, string> = { title: "name", owner: "owner", dept: "department", due: "due date", estimate: "time needed", depends: "waits on", notes: "notes", tags: "tags", priority: "priority" };
const PLAN_NAME: Record<PlanField, string> = { title: "Plan name", goal: "Goal", doneWhen: "Done when" };

/** A new task from a reply starts fresh: not started, nobody credited. */
function freshTask(t: Task): Task {
  const copy = structuredClone(t);
  copy.status = "todo";
  delete copy.done;
  delete copy.skipped;
  delete copy.extra.remove;
  return copy;
}

export function diffPlans(current: Plan, replyIn: Plan, opts: { nameMap?: Record<string, string> } = {}): UpdateChange[] {
  const reply = structuredClone(replyIn);
  if (opts.nameMap && Object.keys(opts.nameMap).length) restoreNames(reply, opts.nameMap);
  const out: UpdateChange[] = [];
  const cur = new Map(current.phases.flatMap((ph) => ph.tasks.map((t) => [t.id, { t, ph }] as const)));
  const seen = new Set<string>();

  for (const f of PLAN_FIELDS) {
    const to = reply[f] || undefined;
    if (!same(current[f], to) && !(f === "title" && !to)) out.push({ key: `plan:${f}`, kind: "plan", field: f, to, text: `${PLAN_NAME[f]}: "${show(current[f])}" → "${show(to)}"`, defaultOn: true, applicable: true });
  }

  let prevPhase: string | undefined;
  for (const ph of reply.phases) {
    const existing = current.phases.find((p) => p.id === ph.id);
    if (!existing) {
      out.push({ key: `phase:${ph.id}`, kind: "addPhase", phase: { id: ph.id, title: ph.title, ...(ph.description ? { description: ph.description } : {}) }, ...(prevPhase ? { afterId: prevPhase } : {}), text: `New phase: ${ph.title}`, defaultOn: true, applicable: true });
    } else if (existing.title !== ph.title && ph.title.trim()) {
      out.push({ key: `phaseTitle:${ph.id}`, kind: "renamePhase", phaseId: ph.id, to: ph.title, text: `Phase "${existing.title}" renamed to "${ph.title}"`, defaultOn: true, applicable: true });
    }
    let prevTask: string | undefined;
    for (const t of ph.tasks) {
      seen.add(t.id);
      const was = cur.get(t.id);
      const wantsRemoval = /^(yes|true)$/i.test(t.extra.remove ?? "");
      if (!was) {
        if (!wantsRemoval) out.push({ key: `add:${t.id}`, kind: "addTask", phaseId: ph.id, task: freshTask(t), ...(prevTask ? { afterId: prevTask } : {}), text: `New ${t.milestone ? "milestone" : "task"} in ${ph.title}: ${t.title}${t.owner ? ` (${t.owner})` : ""}`, defaultOn: true, applicable: true });
        prevTask = t.id;
        continue;
      }
      if (wantsRemoval) {
        const done = was.t.status === "done";
        out.push({ key: `remove:${t.id}`, kind: "remove", taskId: t.id, text: done ? `Remove "${was.t.title}": kept, because done tasks can't be removed` : `Remove "${was.t.title}"${t.notes.length ? `: ${t.notes.join(" ")}` : ""}`, defaultOn: !done, applicable: !done });
        prevTask = t.id;
        continue;
      }
      for (const f of FIELDS) {
        const to = (t as Record<string, unknown>)[f];
        const from = (was.t as Record<string, unknown>)[f];
        if (f === "title" && !to) continue;
        if (!same(from, to)) out.push({ key: `edit:${t.id}:${f}`, kind: "edit", taskId: t.id, field: f, to: structuredClone(to), text: `"${was.t.title}": ${FIELD_NAME[f]} ${show(from)} → ${show(to)}`, defaultOn: true, applicable: true });
      }
      if (was.ph.id !== ph.id) out.push({ key: `move:${t.id}`, kind: "move", taskId: t.id, phaseId: ph.id, ...(prevTask ? { afterId: prevTask } : {}), text: `"${was.t.title}" moves to ${ph.title}`, defaultOn: true, applicable: true });
      if (t.status !== was.t.status) out.push({ key: `status:${t.id}`, kind: "status", taskId: t.id, text: `The reply marks "${was.t.title}" as ${t.status}. Progress only changes in the plan itself, so mark it there if it's right.`, defaultOn: false, applicable: false });
      prevTask = t.id;
    }
    prevPhase = ph.id;
  }

  for (const [id, { t }] of cur) {
    if (seen.has(id)) continue;
    const done = t.status === "done";
    out.push({ key: `missing:${id}`, kind: "remove", taskId: id, text: done ? `"${t.title}" wasn't in the reply; it's done, so it stays` : `"${t.title}" wasn't in the reply. It stays unless you tick this to remove it`, defaultOn: false, applicable: !done });
  }
  return out;
}

/** The edits for the accepted changes, in an order that always applies cleanly. */
export function changesToOps(changes: UpdateChange[], accepted: Set<string>): Op[] {
  const on = changes.filter((c) => c.applicable && accepted.has(c.key));
  const ops: Op[] = [];
  for (const c of on) if (c.kind === "plan") ops.push({ kind: "setPlanField", field: c.field, value: c.to });
  for (const c of on) if (c.kind === "addPhase") ops.push({ kind: "addPhase", phase: c.phase, ...(c.afterId ? { afterId: c.afterId } : {}) });
  for (const c of on) if (c.kind === "renamePhase") ops.push({ kind: "setPhaseField", phaseId: c.phaseId, field: "title", value: c.to });
  for (const c of on) if (c.kind === "addTask") ops.push({ kind: "addTask", phaseId: c.phaseId, task: c.task, ...(c.afterId ? { afterId: c.afterId } : { first: true as const }) });
  for (const c of on) if (c.kind === "edit") ops.push({ kind: "setField", taskId: c.taskId, field: c.field, value: c.to });
  for (const c of on) if (c.kind === "move") ops.push({ kind: "moveTask", taskId: c.taskId, phaseId: c.phaseId, ...(c.afterId ? { afterId: c.afterId } : { first: true as const }) });
  for (const c of on) if (c.kind === "remove") ops.push({ kind: "deleteTask", taskId: c.taskId });
  return ops;
}

/** The assistant's "WHAT CHANGED" list from the raw reply, one line per item. */
export function whatChanged(replyText: string): string[] {
  const m = /what changed[^\n]*\n([\s\S]*)$/i.exec(replyText.replace(/\r\n/g, "\n"));
  if (!m) return [];
  return m[1]!
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\*\*/g, "").trim())
    .filter((l, i, a) => l && !l.startsWith("```") && a.indexOf(l) === i)
    .slice(0, 30);
}


