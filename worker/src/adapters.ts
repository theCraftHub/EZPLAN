/**
 * Cloud connectors (plan section 7b): Cloudflare D1 (SQLite), R2 files, and live rooms in
 * Durable Objects running the same room code as the self-hosted server.
 */
import type { ApplyResult, Blobs, Db, LiveRole, RoomHost, SqlValue } from "@ezplan/server";
import type { Actor, OpEnvelope, ServerMessage } from "@ezplan/shared";

export class D1Db implements Db {
  constructor(private readonly d1: D1Database) {}

  private stmt(sql: string, params: SqlValue[] = []) {
    const s = this.d1.prepare(sql);
    return params.length ? s.bind(...params) : s;
  }

  async all<T>(sql: string, params?: SqlValue[]): Promise<T[]> {
    return (await this.stmt(sql, params).all<T>()).results;
  }

  async first<T>(sql: string, params?: SqlValue[]): Promise<T | null> {
    return (await this.stmt(sql, params).first<T>()) ?? null;
  }

  async run(sql: string, params?: SqlValue[]): Promise<{ changes: number }> {
    return { changes: (await this.stmt(sql, params).run()).meta.changes ?? 0 };
  }

  async batch(statements: { sql: string; params?: SqlValue[] }[]): Promise<void> {
    // D1 runs a batch as one transaction.
    await this.d1.batch(statements.map((s) => this.stmt(s.sql, s.params)));
  }
}

export class R2Blobs implements Blobs {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, data: Uint8Array | string, contentType?: string): Promise<void> {
    await this.bucket.put(key, data, contentType ? { httpMetadata: { contentType } } : undefined);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(key);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
      keys.push(...page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return keys.sort();
  }
}

interface RoomRequest {
  planId: string;
  envelope: OpEnvelope;
  actor: Actor;
}

/** Who a live connection belongs to; stored on the socket so it survives hibernation. */
export interface LiveTicket {
  planId: string;
  actor: Actor;
  role: LiveRole;
}

/** Sends edits and live connections to the plan's Durable Object (one object per plan, worldwide). */
export class DurableRoomHost implements RoomHost {
  constructor(private readonly ns: DurableObjectNamespace) {}

  private stub(planId: string) {
    return this.ns.get(this.ns.idFromName(planId));
  }

  async apply(planId: string, envelope: OpEnvelope, actor: Actor): Promise<ApplyResult> {
    const body: RoomRequest = { planId, envelope, actor };
    const res = await this.stub(planId).fetch("https://room/apply", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Room failed: ${res.status}`);
    return (await res.json()) as ApplyResult;
  }

  async notify(planId: string, message: ServerMessage): Promise<void> {
    await this.stub(planId).fetch("https://room/notify", { method: "POST", body: JSON.stringify({ planId, message }) });
  }

  async kick(planId: string, userId: string): Promise<void> {
    await this.stub(planId).fetch("https://room/kick", { method: "POST", body: JSON.stringify({ planId, userId }) });
  }

  async connect(request: Request, planId: string, actor: Actor, role: LiveRole): Promise<Response> {
    const headers = new Headers({ upgrade: "websocket", "x-live": JSON.stringify({ planId, actor, role } satisfies LiveTicket) });
    return this.stub(planId).fetch("https://room/live", { headers });
  }
}
