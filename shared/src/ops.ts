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
import { nextOccurrence } from "./repeat";

export type EditableField = "title" | "owner" | "dept" | "due" | "notBefore" | "notes" | "priority" | "estimate" | "depends" | "tags" | "approver" | "repeat" | "cost";

export type Op =
  | { kind: "setStatus"; taskId: string; status: TaskStatus }
  | { kind: "setField"; taskId: string; field: EditableField; value: unknown }
  | { kind: "addTask"; phaseId: string; task: Task; afterId?: string; first?: true }
  | { kind: "moveTask"; taskId: string; phaseId: string; afterId?: string; first?: true }
  | { kind: "deleteTask"; taskId: string }
  /** The approver approves a done task, or sends it back to Doing (with an optional note). */
  | { kind: "approve"; taskId: string; decision: "approve" | "reject"; note?: string }
  | { kind: "restoreTask"; taskId: string }
  | { kind: "addPhase"; phase: { id: string; title: string; description?: string }; afterId?: string }
  | { kind: "setPhaseField"; phaseId: string; field: "title" | "description"; value: string | undefined }
  | { kind: "setPlanField"; field: PlanField; value: string | undefined }
  /** Server only (Version history restore): never accepted from a client (see opSchema.ts). */
  | { kind: "replacePlan"; plan: Plan }
  /** Server only: saves each task's scheduled dates as its baseline. The server works the dates out itself. */
  | { kind: "setBaseline"; on: string; dates: Record<string, { start: string; end: string }>; name?: string; switched?: boolean };

export type PlanField = "title" | "goal" | "doneWhen";

export interface OpEnvelope {
  /** Unique per client operation, so replays after reconnect are applied once. */
  opId: string;
  clientId: string;
  op: Op;
}

export interface Actor {
  userId: string;
  name: string;
  /** Set by the server for plan managers: they may approve any task. */
  approveAny?: boolean;
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
  if (op.kind === "replacePlan") {
    state.plan = structuredClone(op.plan);
    state.restoredForReview = [];
    return op;
  }
  if (op.kind === "setBaseline") {
    for (const task of state.plan.phases.flatMap((p) => p.tasks)) {
      const d = op.dates[task.id];
      if (d) task.planned = { start: d.start, end: d.end };
      else delete task.planned;
    }
    state.plan.baselineSet = op.on;
    if (op.name) state.plan.baselineName = op.name;
    else delete state.plan.baselineName;
    return op;
  }
  if (op.kind === "setPlanField") {
    if (op.field === "title" && !op.value) return op; // a plan always has a title
    if (op.value === undefined) delete state.plan[op.field];
    else state.plan[op.field] = op.value;
    return op;
  }
  if (op.kind === "addPhase") {
    if (findPhase(state.plan, op.phase.id)) return op;
    const phase: Phase = { id: op.phase.id, title: op.phase.title, tasks: [], ...(op.phase.description ? { description: op.phase.description } : {}) };
    const i = op.afterId ? state.plan.phases.findIndex((p) => p.id === op.afterId) : -1;
    if (i >= 0) state.plan.phases.splice(i + 1, 0, phase);
    else state.plan.phases.push(phase);
    return op;
  }
  if (op.kind === "setPhaseField") {
    const phase = findPhase(state.plan, op.phaseId);
    if (!phase || (op.field === "title" && !op.value)) return op;
    if (op.value === undefined) delete phase[op.field];
    else phase[op.field] = op.value;
    return op;
  }
  if (op.kind === "restoreTask") {
    const trashed = state.trash[op.taskId];
    if (!trashed || findTask(state.plan, op.taskId)) return op;
    const phase = findPhase(state.plan, trashed.phaseId) ?? state.plan.phases[0];
    if (!phase) return op;
    phase.tasks.push(trashed.task);
    delete state.trash[op.taskId];
    return op;
  }
  if (op.kind === "addTask") {
    const phase = findPhase(state.plan, op.phaseId) ?? state.plan.phases[0];
    if (!phase || findTask(state.plan, op.task.id)) return op;
    insertAfter(phase, structuredClone(op.task), op.afterId, op.first);
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
    case "approve": {
      if (task.status !== "done" || !task.approver) return op;
      if (op.decision === "approve") task.approved = { date: today, by: actor.name };
      else {
        task.status = "progress";
        delete task.done;
        delete task.approved;
      }
      return op;
    }
    case "setStatus": {
      // A change of status always needs a fresh approval.
      if (task.status !== op.status) delete task.approved;
      const finishing = (op.status === "done" || op.status === "skipped") && task.status !== op.status;
      task.status = op.status;
      // A repeating task, once finished, hands its repeat on to the next one, added right after it.
      if (finishing && task.repeat) {
        const id = freeTaskId(state);
        const next = nextOccurrence(task, id, today);
        const phase = state.plan.phases.find((p) => p.tasks.includes(task!));
        if (next && phase) insertAfter(phase, next, task.id);
        delete task.repeat;
      }
      task.done = op.status === "done" ? { date: today, by: actor.name } : undefined;
      task.skipped = op.status === "skipped" ? { date: today, by: actor.name } : undefined;
      if (!task.done) delete task.done;
      if (!task.skipped) delete task.skipped;
      return op;
    }
    case "setField": {
      // Approval is for the work as it was: changing what it is or when clears it.
      if (["title", "estimate", "due", "notBefore", "approver"].includes(op.field) && JSON.stringify((task as Record<string, unknown>)[op.field]) !== JSON.stringify(op.value)) delete task.approved;
      (task as Record<string, unknown>)[op.field] = structuredClone(op.value);
      if (op.value === undefined) delete (task as Record<string, unknown>)[op.field];
      return op;
    }
    case "moveTask": {
      const from = findTask(state.plan, op.taskId)!;
      const to = findPhase(state.plan, op.phaseId);
      if (!to || op.afterId === op.taskId) return op;
      from.phase.tasks.splice(from.index, 1);
      insertAfter(to, task, op.afterId, op.first);
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

/** After `afterId`, at the start when `first`, else at the end. */
/** The next "T" number not used by any task, in the plan or the trash. */
function freeTaskId(state: Pick<RoomState, "plan" | "trash">): string {
  const used = new Set([...state.plan.phases.flatMap((p) => p.tasks.map((t) => t.id.toUpperCase())), ...Object.keys(state.trash).map((k) => k.toUpperCase())]);
  let n = 1;
  for (const id of used) { const m = /^T(\d+)$/.exec(id); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return `T${n}`;
}

function insertAfter(phase: Phase, task: Task, afterId?: string, first?: true): void {
  if (!afterId && first) {
    phase.tasks.unshift(task);
    return;
  }
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

  /** `restore`: edits made earlier on this device that the server hasn't confirmed (offline copy). */
  constructor(readonly clientId: string, private readonly actor: Actor, plan: Plan, seq = 0, restore?: { pending: OpEnvelope[]; sent: number }) {
    this.confirmed = { plan: structuredClone(plan), trash: {}, restoredForReview: [] };
    this.lastSeq = seq;
    if (restore) {
      this.pending = restore.pending.map((p) => structuredClone(p));
      this.n = restore.sent;
    }
  }

  /** What to keep on the device: the confirmed plan and version, and unsent edits (with the edit counter, so IDs never repeat). */
  snapshot(): { confirmed: Plan; version: number; sent: number; pending: OpEnvelope[] } {
    return { confirmed: structuredClone(this.confirmed.plan), version: this.lastSeq, sent: this.n, pending: this.pending.map((p) => structuredClone(p)) };
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

  /** The last server version this client has applied. */
  get version(): number {
    return this.lastSeq;
  }

  /** How many local edits are still waiting for the server. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** After a long disconnect the server sends the whole plan: start from it, keep unsent edits. */
  reset(plan: Plan, seq: number, restoredForReview: string[] = []): void {
    this.confirmed = { plan: structuredClone(plan), trash: {}, restoredForReview: [...restoredForReview] };
    this.lastSeq = seq;
  }

  /** The server refused this edit (e.g. not allowed): stop showing and re-sending it. */
  drop(opId: string): void {
    this.pending = this.pending.filter((p) => p.opId !== opId);
  }

  /** What the user sees: confirmed state with pending edits applied on top. */
  view(today: string): Plan {
    const v = structuredClone(this.confirmed);
    for (const p of this.pending) applyOp(v, p.op, this.actor, today);
    return v.plan;
  }
}
