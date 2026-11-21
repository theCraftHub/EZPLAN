/**
 * Self-hosted connectors (plan section 7b): a SQLite file through Node's built-in node:sqlite,
 * files in a folder, and live rooms held in this server's memory. No native modules to build.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { PlanRoomCore, type ApplyResult, type Blobs, type Clock, type Db, type RoomHost, type SqlValue } from "@ezplan/server";
import type { Actor, OpEnvelope } from "@ezplan/shared";

export class NodeSqliteDb implements Db {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  }

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.raw.prepare(sql).all(...(params as SQLInputValue[])) as T[];
  }

  async first<T>(sql: string, params: SqlValue[] = []): Promise<T | null> {
    return (this.raw.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined) ?? null;
  }

  async run(sql: string, params: SqlValue[] = []): Promise<{ changes: number }> {
    return { changes: Number(this.raw.prepare(sql).run(...(params as SQLInputValue[])).changes) };
  }

  async batch(statements: { sql: string; params?: SqlValue[] }[]): Promise<void> {
    this.raw.exec("BEGIN");
    try {
      for (const s of statements) this.raw.prepare(s.sql).run(...((s.params ?? []) as SQLInputValue[]));
      this.raw.exec("COMMIT");
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }

  close(): void {
    this.raw.close();
  }
}

/** Files in a folder. Keys can't escape it ("..", absolute paths and odd characters are refused). */
export class FolderBlobs implements Blobs {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (!/^[A-Za-z0-9._\/-]{1,512}$/.test(key) || key.split("/").some((p) => p === "" || p === "." || p === "..")) throw new Error(`Invalid file key: ${key}`);
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error(`Invalid file key: ${key}`);
    return p;
  }

  async put(key: string, data: Uint8Array | string): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else out.push(relative(this.root, p).split(sep).join("/"));
      }
    };
    await walk(this.root);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }
}

/**
 * Live rooms in this server's memory, one per open plan. Edits to the same plan run one at a
 * time (a per-plan queue), so they apply in order exactly like the cloud's Durable Objects.
 */
export class MemoryRoomHost implements RoomHost {
  private readonly rooms = new Map<string, PlanRoomCore>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  apply(planId: string, envelope: OpEnvelope, actor: Actor): Promise<ApplyResult> {
    let room = this.rooms.get(planId);
    if (!room) this.rooms.set(planId, (room = new PlanRoomCore(this.db, planId, this.clock)));
    const r = room;
    const run = (this.queues.get(planId) ?? Promise.resolve()).then(() => r.apply(envelope, actor));
    this.queues.set(planId, run.catch(() => undefined));
    return run;
  }
}
