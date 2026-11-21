/**
 * A live plan room: applies edits in order using the shared rules (shared/src/ops.ts) and
 * saves the result. Both hosts use this unchanged: the cloud inside a Durable Object, the
 * self-hosted server in memory.
 */
import { newRoom, serverApply, type Actor, type OpEnvelope, type Plan, type RoomState } from "@ezplan/shared";
import type { ApplyResult, Clock, Db } from "./ports";

/** How many recent edit IDs a room remembers to ignore replays (sent again after a reconnect). */
const REMEMBERED_OP_IDS = 2000;

interface StoredRoom extends Omit<RoomState, "appliedOpIds"> {
  appliedOpIds: string[];
}

export function roomToJson(state: RoomState): string {
  const ids = [...state.appliedOpIds].slice(-REMEMBERED_OP_IDS);
  const stored: StoredRoom = { ...state, appliedOpIds: ids };
  return JSON.stringify(stored);
}

export function roomFromJson(json: string): RoomState {
  const stored = JSON.parse(json) as StoredRoom;
  return { ...stored, appliedOpIds: new Set(stored.appliedOpIds) };
}

export function newRoomJson(plan: Plan): string {
  return roomToJson(newRoom(plan));
}

export async function loadRoom(db: Db, planId: string): Promise<RoomState | null> {
  const row = await db.first<{ room: string }>(`SELECT room FROM plans WHERE id = ?`, [planId]);
  return row ? roomFromJson(row.room) : null;
}

export async function saveRoom(db: Db, planId: string, state: RoomState, now: number): Promise<void> {
  await db.run(`UPDATE plans SET room = ?, title = ?, version = ?, updated_at = ? WHERE id = ?`, [roomToJson(state), state.plan.title, state.seq, now, planId]);
}

/** One plan's room. Not safe for concurrent use: the host gives each room one caller at a time. */
export class PlanRoomCore {
  private state: RoomState | null = null;

  constructor(
    private readonly db: Db,
    private readonly planId: string,
    private readonly clock: Clock,
  ) {}

  async apply(envelope: OpEnvelope, actor: Actor): Promise<ApplyResult> {
    if (!this.state) this.state = await loadRoom(this.db, this.planId);
    if (!this.state) return { status: "missing" };
    const applied = serverApply(this.state, envelope, actor, this.clock.today());
    if (!applied) return { status: "duplicate", version: this.state.seq };
    await saveRoom(this.db, this.planId, this.state, this.clock.now());
    return { status: "applied", applied, version: this.state.seq };
  }
}
