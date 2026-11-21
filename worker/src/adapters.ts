/**
 * Cloud connectors (plan section 7b): Cloudflare D1 (SQLite), R2 files, and live rooms in
 * Durable Objects running the same room code as the self-hosted server.
 */
import { PlanRoomCore, type ApplyResult, type Blobs, type Clock, type Db, type RoomHost, type SqlValue } from "@ezplan/server";
import type { Actor, OpEnvelope } from "@ezplan/shared";

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

/** Sends each edit to the plan's Durable Object (one object per plan, worldwide). */
export class DurableRoomHost implements RoomHost {
  constructor(private readonly ns: DurableObjectNamespace) {}

  async apply(planId: string, envelope: OpEnvelope, actor: Actor): Promise<ApplyResult> {
    const stub = this.ns.get(this.ns.idFromName(planId));
    const body: RoomRequest = { planId, envelope, actor };
    const res = await stub.fetch("https://room/apply", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Room failed: ${res.status}`);
    return (await res.json()) as ApplyResult;
  }
}

/**
 * Body of the PlanRoom Durable Object. Requests can interleave while the room waits on the
 * database, so edits go through a queue and apply one at a time, in order.
 */
export class RoomObjectCore {
  private core: PlanRoomCore | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  handle(request: Request): Promise<Response> {
    const run = this.queue.then(async () => {
      const { planId, envelope, actor } = (await request.json()) as RoomRequest;
      this.core ??= new PlanRoomCore(this.db, planId, this.clock);
      return Response.json(await this.core.apply(envelope, actor));
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
