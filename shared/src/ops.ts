/**
 * Live-editing operations (spike → first real version).
 *
 * Model: the server's plan room is the single authority. Clients send small
 * operations; the server applies them in arrival order, stamps each with a
 * sequence number and broadcasts it. Clients keep the last confirmed state plus
 * their own pending operations and re-apply the pending ones on top of every
 * confirmed update, so all clients converge on the server's state.
 *
 * Conflict rules (per plan section 5):
 *  - Per-field last-write-wins in server arrival order.
 *  - Deletes are soft: a deleted task goes to Trash. An edit to a task that is
 *    in the Trash (e.g. made offline) restores it and flags it for review.
 *  - Completion attribution ("Done by") is set by the server from the
 *    authenticated user, never taken from the client.
 */
import type { Phase, Plan, Task, TaskStatus } from "./schema";

export type EditableField = "title" | "owner" | "due" | "notes" | "priority" | "estimate" | "depends" | "tags";

export type Op =
  | { kind: "setStatus"; taskId: string; status: TaskStatus }
  | { kind: "setField"; taskId: string; field: EditableField; value: unknown }
  | { kind: "addTask"; phaseId: string; task: Task; afterId?: string }
  | { kind: "moveTask"; taskId: string; phaseId: string; afterId?: string }
  | { kind: "deleteTask"; taskId: string };

export interface OpEnvelope {
  /** Unique per client operation, so replays after reconnect are applied once. */
  opId: string;
  clientId: string;
  op: Op;
}

export interface Actor {
  userId: string;
  name: string;
}

export interface RoomState {
  plan: Plan;
  /** Soft-deleted tasks: id → task and where it was. */
  trash: Record<string, { task: Task; phaseId: string; deletedAt: string; by: string }>;
  /** Tasks restored by an edit made after they were deleted; shown for review. */
  restoredForReview: string[];
  seq: number;
  appliedOpIds: Set<string>;
}

export interface Applied {
  seq: number;
  env: OpEnvelope;
  /** The op as the server applied it (e.g. with server-set attribution). */
  effective: Op;
  actor: Actor;
  at: string;
}

export function newRoom(plan: Plan): RoomState {
  return { plan: structuredClone(plan), trash: {}, restoredForReview: [], seq: 0, appliedOpIds: new Set() };
}

/** Server side: apply one client operation. Returns null for a duplicate (already applied). */
export function serverApply(state: RoomState, env: OpEnvelope, actor: Actor, today: string): Applied | null {
  if (state.appliedOpIds.has(env.opId)) return null;
  state.appliedOpIds.add(env.opId);
  const effective = applyOp(state, env.op, actor, today);
  state.seq++;
  return { seq: state.seq, env, effective, actor, at: today };
}

/** Pure application used by both server and clients. */
export function applyOp(state: Pick<RoomState, "plan" | "trash" | "restoredForReview">, op: Op, actor: Actor, today: string): Op {
  if (op.kind === "addTask") {
    const phase = findPhase(state.plan, op.phaseId) ?? state.plan.phases[0];
    if (!phase || findTask(state.plan, op.task.id)) return op;
    insertAfter(phase, structuredClone(op.task), op.afterId);
    return op;
  }

  let task = findTask(state.plan, op.taskId)?.task;
  if (!task) {
    const trashed = state.trash[op.taskId];
    if (!trashed || op.kind === "deleteTask") return op;
    // An edit to a deleted task restores it and flags it for review.
    const phase = findPhase(state.plan, trashed.phaseId) ?? state.plan.phases[0];
    if (!phase) return op;
    phase.tasks.push(trashed.task);
    delete state.trash[op.taskId];
    if (!state.restoredForReview.includes(op.taskId)) state.restoredForReview.push(op.taskId);
    task = trashed.task;
  }

  switch (op.kind) {
    case "setStatus": {
      task.status = op.status;
      task.done = op.status === "done" ? { date: today, by: actor.name } : undefined;
      task.skipped = op.status === "skipped" ? { date: today, by: actor.name } : undefined;
      if (!task.done) delete task.done;
      if (!task.skipped) delete task.skipped;
      return op;
    }
    case "setField": {
      (task as Record<string, unknown>)[op.field] = structuredClone(op.value);
      if (op.value === undefined) delete (task as Record<string, unknown>)[op.field];
      return op;
    }
    case "moveTask": {
      const from = findTask(state.plan, op.taskId)!;
      const to = findPhase(state.plan, op.phaseId);
      if (!to || op.afterId === op.taskId) return op;
      from.phase.tasks.splice(from.index, 1);
      insertAfter(to, task, op.afterId);
      return op;
    }
    case "deleteTask": {
      const at = findTask(state.plan, op.taskId)!;
      at.phase.tasks.splice(at.index, 1);
      state.trash[op.taskId] = { task, phaseId: at.phase.id, deletedAt: today, by: actor.name };
      return op;
    }
  }
}

function findPhase(plan: Plan, id: string): Phase | undefined {
  return plan.phases.find((p) => p.id === id);
}

function findTask(plan: Plan, id: string): { task: Task; phase: Phase; index: number } | undefined {
  for (const phase of plan.phases) {
    const index = phase.tasks.findIndex((t) => t.id === id);
    if (index >= 0) return { task: phase.tasks[index]!, phase, index };
  }
  return undefined;
}

function insertAfter(phase: Phase, task: Task, afterId?: string): void {
  const i = afterId ? phase.tasks.findIndex((t) => t.id === afterId) : -1;
  if (afterId && i >= 0) phase.tasks.splice(i + 1, 0, task);
  else phase.tasks.push(task);
}

// ---------------------------------------------------------------- client replica

/**
 * A client's view: confirmed state from the server plus its own pending ops.
 * Works offline: pending ops queue up and are sent (and re-sent) on reconnect.
 */
export class ClientReplica {
  private confirmed: Pick<RoomState, "plan" | "trash" | "restoredForReview">;
  private pending: OpEnvelope[] = [];
  private lastSeq = 0;
  private n = 0;

  constructor(readonly clientId: string, private readonly actor: Actor, plan: Plan, seq = 0) {
    this.confirmed = { plan: structuredClone(plan), trash: {}, restoredForReview: [] };
    this.lastSeq = seq;
  }

  /** Make a local edit: shown immediately, queued for the server. */
  edit(op: Op): OpEnvelope {
    const env = { opId: `${this.clientId}:${++this.n}`, clientId: this.clientId, op };
    this.pending.push(env);
    return env;
  }

  /** Everything still waiting to be confirmed (re-sent after reconnect). */
  outbox(): OpEnvelope[] {
    return [...this.pending];
  }

  /** Apply a confirmed operation broadcast by the server (in sequence order). */
  receive(a: Applied, today: string): void {
    if (a.seq <= this.lastSeq) return;
    applyOp(this.confirmed, a.effective, a.actor, today);
    this.lastSeq = a.seq;
    this.pending = this.pending.filter((p) => p.opId !== a.env.opId);
  }

  /** What the user sees: confirmed state with pending edits applied on top. */
  view(today: string): Plan {
    const v = structuredClone(this.confirmed);
    for (const p of this.pending) applyOp(v, p.op, this.actor, today);
    return v.plan;
  }
}
