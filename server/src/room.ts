/**
 * A live plan room: applies edits in order using the shared rules (shared/src/ops.ts) and
 * saves the result. Both hosts use this unchanged: the cloud inside a Durable Object, the
 * self-hosted server in memory.
 */
import { allTasks, describeOp, newRoom, serverApply, taskBefore, type Actor, type Applied, type OpEnvelope, type Plan, type RoomState } from "@ezplan/shared";
import { recordActivity } from "./activity";
import { notify, userForName } from "./notify";
import type { ApplyResult, Clock, Db } from "./ports";

/** How many recent edit IDs a room remembers to ignore replays (sent again after a reconnect). */
const REMEMBERED_OP_IDS = 2000;
/** How many recent applied edits a room keeps so reconnecting clients can catch up. */
export const CATCH_UP_EDITS = 500;

/** What a room stores: the shared state plus recent applied edits for catch-up. */
export interface StoredRoomState extends RoomState {
  log: Applied[];
}

interface StoredRoomJson extends Omit<StoredRoomState, "appliedOpIds"> {
  appliedOpIds: string[];
}

export function roomToJson(state: StoredRoomState | RoomState): string {
  const ids = [...state.appliedOpIds].slice(-REMEMBERED_OP_IDS);
  const log = "log" in state ? state.log.slice(-CATCH_UP_EDITS) : [];
  const stored: StoredRoomJson = { ...state, appliedOpIds: ids, log };
  return JSON.stringify(stored);
}

export function roomFromJson(json: string): StoredRoomState {
  const stored = JSON.parse(json) as StoredRoomJson;
  return { ...stored, appliedOpIds: new Set(stored.appliedOpIds), log: stored.log ?? [] };
}

export function newRoomJson(plan: Plan): string {
  return roomToJson({ ...newRoom(plan), log: [] });
}

export async function loadRoom(db: Db, planId: string): Promise<StoredRoomState | null> {
  const row = await db.first<{ room: string }>(`SELECT room FROM plans WHERE id = ?`, [planId]);
  return row ? roomFromJson(row.room) : null;
}

export async function saveRoom(db: Db, planId: string, state: StoredRoomState, now: number): Promise<void> {
  await db.run(`UPDATE plans SET room = ?, title = ?, version = ?, updated_at = ? WHERE id = ?`, [roomToJson(state), state.plan.title, state.seq, now, planId]);
}

export type CatchUp = { version: number; missed: Applied[] } | { version: number; plan: Plan; restoredForReview: string[] };

/** One plan's room. Not safe for concurrent use: callers give each room one caller at a time. */
export class PlanRoomCore {
  private state: StoredRoomState | null = null;

  constructor(
    private readonly db: Db,
    readonly planId: string,
    private readonly clock: Clock,
  ) {}

  private async loaded(): Promise<StoredRoomState | null> {
    if (!this.state) this.state = await loadRoom(this.db, this.planId);
    return this.state;
  }

  async apply(envelope: OpEnvelope, actor: Actor): Promise<ApplyResult> {
    const state = await this.loaded();
    if (!state) return { status: "missing" };
    const before = taskBefore(envelope.op, state.plan);
    const applied = serverApply(state, envelope, actor, this.clock.today());
    if (!applied) return { status: "duplicate", version: state.seq };
    state.log.push(applied);
    if (state.log.length > CATCH_UP_EDITS) state.log.splice(0, state.log.length - CATCH_UP_EDITS);
    await saveRoom(this.db, this.planId, state, this.clock.now());
    // Activity comes from the edit as applied and the signed-in person (never from the client).
    // Bulk changes (AI update, version restore) write one summary line from their endpoint instead.
    if (envelope.clientId !== "update" && envelope.clientId !== "restore") {
      const line = describeOp(applied.effective, before, state.plan, applied.actor.name);
      await recordActivity(this.db, this.planId, applied.actor, line, this.clock.now());
      // "Assigned to you": the new owner's name is linked to an account on this plan.
      if (line?.owner && line.taskId) {
        const to = await userForName(this.db, this.planId, line.owner);
        const title = allTasks(state.plan).find((t) => t.id === line.taskId)?.title ?? line.taskId;
        if (to) await notify(this.db, this.clock.now(), { userId: to, planId: this.planId, kind: "assigned", text: `${applied.actor.name} gave you ${title} on ${state.plan.title}`, link: `/p/${this.planId}/checklist?task=${encodeURIComponent(line.taskId)}` }, applied.actor.userId);
      }
    }
    return { status: "applied", applied, version: state.seq };
  }

  /** What a client that last saw `since` needs: the missed edits, or the whole plan. */
  async catchUp(since: number | undefined): Promise<CatchUp | null> {
    const state = await this.loaded();
    if (!state) return null;
    const oldest = state.log[0]?.seq ?? state.seq + 1;
    if (since !== undefined && since > 0 && since <= state.seq && since >= oldest - 1) {
      return { version: state.seq, missed: state.log.filter((a) => a.seq > since) };
    }
    return { version: state.seq, plan: state.plan, restoredForReview: state.restoredForReview };
  }
}
