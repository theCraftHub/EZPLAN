/** The Board's columns and moves (step N5a), kept apart from the screen so they can be tested. */
import { awaitingApproval, sameName, type Op, type Task } from "@rakuplan/shared";

export type Column = "todo" | "progress" | "waiting" | "done";
export const COLUMNS: { id: Column; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "progress", label: "Doing" },
  { id: "waiting", label: "Waiting for approval" },
  { id: "done", label: "Done" },
];

export const columnOf = (t: Task): Column => (awaitingApproval(t) ? "waiting" : t.status === "skipped" ? "done" : t.status);

/**
 * The edit that moves a task to a column, or why it can't move there. Done → Waiting is the same
 * as Done for a task that needs approval; Waiting → Done is approving it (the approver or a manager).
 */
export function moveOp(t: Task, to: Column, who: { me?: string; manager?: boolean }): { op: Op } | { why: string } | null {
  const from = columnOf(t);
  if (from === to) return null;
  if (to === "waiting") {
    if (!t.approver) return { why: `${t.title} doesn't need anyone's approval. Set who approves it in the task first.` };
    if (t.status === "done") return null;
    return { op: { kind: "setStatus", taskId: t.id, status: "done" } };
  }
  if (from === "waiting" && to === "done") {
    if (!who.manager && !(who.me && sameName(t.approver!, who.me))) return { why: `Only ${t.approver} or a plan manager can approve ${t.title}.` };
    return { op: { kind: "approve", taskId: t.id, decision: "approve" } };
  }
  return { op: { kind: "setStatus", taskId: t.id, status: to } };
}
