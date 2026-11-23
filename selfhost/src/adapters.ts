/**
 * Self-hosted connectors (plan section 7b): a SQLite file through Node's built-in node:sqlite,
 * files in a folder, and live rooms held in this server's memory. No native modules to build.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { LiveRoom, PlanRoomCore, type ApplyResult, type Blobs, type Clock, type Db, type LiveRole, type Peer, type RoomHost, type SqlValue } from "@ezplan/server";
import type { WebSocket } from "ws";
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

/** A self-hosted live connection (a `ws` socket). */
interface NodePeer extends Peer {
  socket: WebSocket;
}

/** Marks requests coming from this server's own upgrade handler (see server.ts). */
export const INTERNAL_UPGRADE_HEADER = "x-internal-upgrade";

/**
 * Live rooms in this server's memory, one per open plan. Edits to a plan (from the API or a live
 * connection) run one at a time in its LiveRoom, exactly like the cloud's Durable Objects.
 */
export class MemoryRoomHost implements RoomHost {
  private readonly rooms = new Map<string, { live: LiveRoom; peers: Set<NodePeer> }>();
  private readonly tickets = new Map<string, { planId: string; actor: Actor; role: LiveRole; expires: number }>();
  /** Per-process secret: only our own upgrade handler can turn a request into a live connection. */
  readonly upgradeSecret = crypto.randomUUID();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  private room(planId: string) {
    let r = this.rooms.get(planId);
    if (!r) {
      const peers = new Set<NodePeer>();
      r = { live: new LiveRoom(new PlanRoomCore(this.db, planId, this.clock), () => [...peers]), peers };
      this.rooms.set(planId, r);
    }
    return r;
  }

  apply(planId: string, envelope: OpEnvelope, actor: Actor): Promise<ApplyResult> {
    return this.room(planId).live.applyFromApi(envelope, actor);
  }

  async connect(request: Request, planId: string, actor: Actor, role: LiveRole): Promise<Response> {
    if (request.headers.get(INTERNAL_UPGRADE_HEADER) !== this.upgradeSecret) return Response.json({ error: "Connect with a WebSocket." }, { status: 426 });
    const ticket = crypto.randomUUID();
    this.tickets.set(ticket, { planId, actor, role, expires: Date.now() + 30_000 });
    return new Response(null, { status: 200, headers: { "x-live-ticket": ticket } });
  }

  /** Called by the upgrade handler once the WebSocket is open. */
  attach(ticket: string, socket: WebSocket): void {
    const t = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!t || t.expires < Date.now()) {
      socket.close(1008, "Expired");
      return;
    }
    const r = this.room(t.planId);
    const peer: NodePeer = { actor: t.actor, role: t.role, socket, send: (m) => socket.send(m) };
    r.peers.add(peer);
    socket.on("message", (data, isBinary) => {
      void r.live.message(peer, isBinary ? new ArrayBuffer(0) : data.toString());
    });
    socket.on("close", () => {
      r.peers.delete(peer);
      r.live.presence();
    });
    r.live.presence();
  }

  /** Closes every live connection (server shutdown). */
  closeAll(): void {
    for (const r of this.rooms.values()) for (const p of r.peers) p.socket.close(1001, "Server stopping");
  }
}
