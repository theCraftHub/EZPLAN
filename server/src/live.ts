/**
 * Live connections to a plan room, the same on both hosts. A host supplies the open connections
 * (Durable Object sockets in the cloud, `ws` sockets self-hosted); this class handles messages,
 * applies edits through PlanRoomCore one at a time, confirms them to the sender, broadcasts
 * them to everyone, and keeps presence up to date.
 */
import { LIVE_MAX_MESSAGE, parseOp, type Actor, type ClientMessage, type OpEnvelope, type PresencePerson, type ServerMessage } from "@ezplan/shared";
import { PlanRoomCore } from "./room";
import type { ApplyResult } from "./ports";

export type LiveRole = "manager" | "editor" | "viewer";

export interface Peer {
  actor: Actor;
  role: LiveRole;
  send(message: string): void;
  /** Ends this connection (access removed or role changed). */
  close?(code: number, reason: string): void;
}

/** Close code telling the app its access changed: it reloads the plan (or shows it's gone). */
export const ACCESS_CHANGED = 4003;

export class LiveRoom {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly core: PlanRoomCore,
    /** The open connections right now (a function, because hibernating hosts rebuild the list). */
    private readonly peers: () => Peer[],
  ) {}

  /** Runs `fn` after everything queued before it, so edits apply strictly in order. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** A message for everyone in the room (e.g. availability changed). */
  notify(message: ServerMessage): void {
    this.broadcast(message);
  }

  /** Ends a person's connections here; they reconnect with their new role, or are refused. */
  kick(userId: string): void {
    for (const p of this.peers()) if (p.actor.userId === userId) p.close?.(ACCESS_CHANGED, "Access changed");
  }

  private broadcast(message: ServerMessage, except?: Peer) {
    const text = JSON.stringify(message);
    for (const p of this.peers()) {
      if (p === except) continue;
      try {
        p.send(text);
      } catch {
        // A connection that just closed; the host removes it.
      }
    }
  }

  presence(): void {
    const people = new Map<string, PresencePerson>();
    for (const p of this.peers()) {
      const known = people.get(p.actor.userId);
      if (known) known.connections++;
      else people.set(p.actor.userId, { userId: p.actor.userId, name: p.actor.name, connections: 1 });
    }
    this.broadcast({ t: "presence", people: [...people.values()] });
  }

  /** An edit from the HTTP API: applied in the same queue and broadcast to every connection. */
  applyFromApi(envelope: OpEnvelope, actor: Actor): Promise<ApplyResult> {
    return this.serial(async () => {
      const result = await this.core.apply(envelope, actor);
      if (result.status === "applied") this.broadcast({ t: "applied", applied: result.applied, version: result.version });
      return result;
    });
  }

  /** A message from one connection. */
  message(peer: Peer, raw: string | ArrayBuffer): Promise<void> {
    const reply = (m: ServerMessage) => peer.send(JSON.stringify(m));
    const size = typeof raw === "string" ? raw.length : raw.byteLength;
    if (typeof raw !== "string" || size > LIVE_MAX_MESSAGE) {
      reply({ t: "error", error: "Messages must be text under 256 KB." });
      return Promise.resolve();
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      reply({ t: "error", error: "That message isn't valid JSON." });
      return Promise.resolve();
    }
    return this.serial(async () => {
      if (msg.t === "hello") {
        const since = typeof msg.since === "number" ? msg.since : undefined;
        const c = await this.core.catchUp(since);
        if (!c) return reply({ t: "error", error: "This plan no longer exists." });
        return reply({ t: "welcome", ...c });
      }
      if (msg.t === "edit") {
        const opId = typeof msg.opId === "string" ? msg.opId : "";
        if (peer.role === "viewer") return reply({ t: "ack", opId, status: "rejected", version: -1, error: "Viewers can't change this plan." });
        const op = parseOp(msg.op);
        const okId = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 64;
        if (!op || !okId(msg.opId) || !okId(msg.clientId)) return reply({ t: "ack", opId, status: "rejected", version: -1, error: "This edit isn't valid." });
        // "Done by" comes from the connection's signed-in person, never the message.
        const result = await this.core.apply({ opId: msg.opId, clientId: msg.clientId, op }, peer.actor);
        if (result.status === "missing") return reply({ t: "error", error: "This plan no longer exists." });
        reply({ t: "ack", opId, status: result.status, version: result.version });
        if (result.status === "applied") this.broadcast({ t: "applied", applied: result.applied, version: result.version });
        return;
      }
      reply({ t: "error", error: "Unknown message." });
    });
  }
}
