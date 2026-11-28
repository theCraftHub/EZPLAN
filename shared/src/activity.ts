/**
 * Plain-language activity lines ("Ana marked Book venue done") and @mentions in comments.
 * The server writes activity from the edit it actually applied and the signed-in person,
 * never from anything the client says about itself.
 */
import type { Op } from "./ops";
import { allTasks, type Plan, type Task } from "./schema";

export type ActivityKind = "status" | "edit" | "add" | "move" | "delete" | "restore" | "phase" | "plan" | "replace" | "comment" | "sharing" | "update" | "report" | "safety" | "baseline" | "status-update" | "raid";

export interface ActivityLine {
  kind: ActivityKind;
  taskId?: string;
  /** Who it's about when the owner changes (for "assigned to you" notices). */
  owner?: string;
  summary: string;
}

const STATUS_WORD: Record<string, string> = { todo: "to do", progress: "in progress", done: "done", skipped: "skipped" };
const FIELD_WORD: Record<string, string> = { title: "the name", owner: "the owner", due: "the due date", notes: "the notes", priority: "the priority", estimate: "the estimate", depends: "what it waits on", tags: "the tags" };
const PLAN_FIELD_WORD: Record<string, string> = { title: "the plan's name", goal: "the goal", doneWhen: "\"done when\"" };

const findTask = (plan: Plan, id: string): Task | undefined => allTasks(plan).find((t) => t.id === id);
const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The task an edit touches, copied before the edit is applied (so lines can say what changed). */
export function taskBefore(op: Op, plan: Plan): Task | undefined {
  const id = "taskId" in op ? op.taskId : undefined;
  const t = id ? findTask(plan, id) : undefined;
  return t ? { ...t } : undefined;
}

/** One line for an applied edit, or null when it changed nothing worth telling people about. */
export function describeOp(op: Op, before: Task | undefined, after: Plan, who: string): ActivityLine | null {
  const name = (id: string) => clip(findTask(after, id)?.title ?? before?.title ?? id);
  switch (op.kind) {
    case "approve":
      return { kind: "status", taskId: op.taskId, summary: op.decision === "approve" ? `${who} approved ${name(op.taskId)}` : `${who} sent ${name(op.taskId)} back${op.note ? `: ${clip(op.note)}` : ""}` };
    case "setStatus": {
      if (before?.status === op.status) return null;
      return { kind: "status", taskId: op.taskId, summary: op.status === "done" || op.status === "skipped" ? `${who} marked ${name(op.taskId)} ${STATUS_WORD[op.status]}` : `${who} set ${name(op.taskId)} to ${STATUS_WORD[op.status]}` };
    }
    case "setField": {
      if (op.field === "owner") {
        const owner = typeof op.value === "string" && op.value.trim() ? op.value.trim() : undefined;
        if (before?.owner === owner) return null;
        return { kind: "edit", taskId: op.taskId, ...(owner ? { owner } : {}), summary: owner ? `${who} gave ${name(op.taskId)} to ${owner}` : `${who} left ${name(op.taskId)} without an owner` };
      }
      if (op.field === "title") return { kind: "edit", taskId: op.taskId, summary: `${who} renamed ${clip(before?.title ?? op.taskId)} to ${name(op.taskId)}` };
      return { kind: "edit", taskId: op.taskId, summary: `${who} changed ${FIELD_WORD[op.field] ?? op.field} of ${name(op.taskId)}` };
    }
    case "addTask":
      return { kind: "add", taskId: op.task.id, ...(op.task.owner ? { owner: op.task.owner } : {}), summary: `${who} added ${clip(op.task.title)}` };
    case "moveTask":
      return { kind: "move", taskId: op.taskId, summary: `${who} moved ${name(op.taskId)}` };
    case "deleteTask":
      return before ? { kind: "delete", taskId: op.taskId, summary: `${who} deleted ${name(op.taskId)} (it's in the Trash)` } : null;
    case "restoreTask":
      return { kind: "restore", taskId: op.taskId, summary: `${who} restored ${name(op.taskId)} from the Trash` };
    case "addPhase":
      return { kind: "phase", summary: `${who} added the phase ${clip(op.phase.title)}` };
    case "setPhaseField":
      return { kind: "phase", summary: `${who} changed a phase's ${op.field === "title" ? "name" : "description"}` };
    case "setPlanField":
      return { kind: "plan", summary: `${who} changed ${PLAN_FIELD_WORD[op.field] ?? op.field}` };
    case "replacePlan":
      return { kind: "replace", summary: `${who} restored an earlier version of the plan` };
    case "setBaseline":
      if (op.name && op.switched) return { kind: "baseline", summary: `${who} compared the plan to the baseline "${op.name}" (planned dates as of ${op.on})` };
      return { kind: "baseline", summary: `${who} set the baseline${op.name ? ` "${op.name}"` : ""} (planned dates as of ${op.on})` };
    default:
      return null;
  }
}

/**
 * The people an @mention names, matched against known names (longest first, so "@Ana Lopez"
 * beats "@Ana"). Case doesn't matter; an @ inside an email address doesn't count.
 */
export function findMentions(body: string, names: string[]): string[] {
  const sorted = [...new Set(names.filter((n) => n.trim()))].sort((a, b) => b.length - a.length);
  const found = new Set<string>();
  const lower = body.toLowerCase();
  for (let i = lower.indexOf("@"); i !== -1; i = lower.indexOf("@", i + 1)) {
    if (i > 0 && /[\w.+-]/.test(lower[i - 1]!)) continue; // name@example.com
    const rest = lower.slice(i + 1);
    const hit = sorted.find((n) => rest.startsWith(n.toLowerCase()) && !/[\w]/.test(rest[n.length] ?? " "));
    if (hit) found.add(hit);
  }
  return [...found];
}
