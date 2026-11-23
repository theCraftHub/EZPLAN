/**
 * Live editing contract (WebSockets), written once and run on both hosts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClientReplica, parsePlan, type Applied, type Plan, type ServerMessage } from "@ezplan/shared";
import { TODAY, type HostFactory, type TestHost } from "./contract";
import { PUBLIC_URL } from "./signin.contract";

export interface LiveSocket {
  send(text: string): void;
  close(): void;
  onMessage(fn: (text: string) => void): void;
  onClose?(fn: (code: number) => void): void;
}

/** Test client: keeps every message and lets tests wait for the next one that matches. */
export class LiveClient {
  readonly received: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  private consumed = new Set<number>();

  /** Resolves with the close code when the server ends the connection. */
  readonly closedBy: Promise<number>;

  constructor(private readonly socket: LiveSocket) {
    let done: (code: number) => void = () => {};
    this.closedBy = new Promise((r) => (done = r));
    socket.onClose?.((code) => done(code));
    socket.onMessage((text) => {
      const m = JSON.parse(text) as ServerMessage;
      this.received.push(m);
      const i = this.received.length - 1;
      const w = this.waiters.findIndex((x) => x.pred(m));
      if (w >= 0) {
        this.consumed.add(i);
        this.waiters.splice(w, 1)[0]!.resolve(m);
      }
    });
  }

  send(msg: unknown) {
    this.socket.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  /** The first not-yet-consumed message matching `pred` (already received or still to come). */
  next<T extends ServerMessage>(pred: (m: ServerMessage) => boolean, ms = 5000): Promise<T> {
    const i = this.received.findIndex((m, idx) => !this.consumed.has(idx) && pred(m));
    if (i >= 0) {
      this.consumed.add(i);
      return Promise.resolve(this.received[i] as T);
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No matching message within ${ms} ms; got ${JSON.stringify(this.received.slice(-5))}`)), ms);
      this.waiters.push({ pred, resolve: (m) => (clearTimeout(timer), resolve(m as T)) });
    });
  }

  applied(): Extract<ServerMessage, { t: "applied" }>[] {
    return this.received.filter((m): m is Extract<ServerMessage, { t: "applied" }> => m.t === "applied");
  }

  private closed = false;

  /** Safe to call more than once (some socket implementations throw on a second close). */
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      // already closed by the other side
    }
  }
}

export type LiveOpen = (path: string, opts: { user?: string; origin?: string; upgrade?: boolean }) => Promise<LiveClient | { status: number }>;

const ALEX = "u-alex|Alex|alex@example.com";
const SAM = "u-sam|Sam|sam@example.com";
const kind = (t: string) => (m: ServerMessage) => m.t === t;
const isClient = (c: LiveClient | { status: number }): c is LiveClient => c instanceof LiveClient;

export function liveContract(hostName: string, factory: HostFactory) {
  describe(`Live editing: ${hostName}`, () => {
    let host: TestHost;
    let open: LiveOpen;
    let planId = "";
    const clients: LiveClient[] = [];
    const connect = async (user = ALEX) => {
      const c = await open(`/api/plans/${planId}/live`, { user, origin: PUBLIC_URL });
      if (!isClient(c)) throw new Error(`refused: ${c.status}`);
      clients.push(c);
      return c;
    };

    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      open = host.live!;
      const res = await host.fetch(
        "/api/plans",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "---\nezplan: 1\ntitle: Live\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: First (1d)\n- [ ] T2: Second (2d) depends: T1\n- [ ] T3: Third (1d)" }) },
        ALEX,
      );
      planId = ((await res.json()) as { id: string }).id;
    }, 60_000);
    afterAll(async () => {
      for (const c of clients) c.close();
      await host?.stop();
    });

    it("refuses signed-out, other-workspace, cross-site and non-WebSocket requests", async () => {
      expect(await open(`/api/plans/${planId}/live`, {})).toEqual({ status: 401 });
      expect(await open(`/api/plans/${planId}/live`, { user: SAM })).toEqual({ status: 404 });
      expect(await open(`/api/plans/${planId}/live`, { user: ALEX, origin: "https://evil.test" })).toEqual({ status: 403 });
      expect((await host.fetch(`/api/plans/${planId}/live`, {}, ALEX)).status).toBe(426);
    });

    it("welcomes with the whole plan and shows who is here", async () => {
      const a = await connect();
      a.send({ t: "hello" });
      const w = await a.next<Extract<ServerMessage, { t: "welcome" }>>(kind("welcome"));
      expect(w.version).toBe(0);
      expect("plan" in w && w.plan.title).toBe("Live");
      const b = await connect();
      const p = await a.next<Extract<ServerMessage, { t: "presence" }>>((m) => m.t === "presence" && m.people[0]?.connections === 2);
      expect(p.people).toEqual([{ userId: "u-alex", name: "Alex", connections: 2 }]);
      b.send({ t: "hello" });
      await b.next(kind("welcome"));
    });

    it("confirms an edit to its sender, sends it to everyone, and ignores a replay", async () => {
      const [a, b] = clients as [LiveClient, LiveClient];
      a.send({ t: "edit", opId: "e1", clientId: "ca", op: { kind: "setStatus", taskId: "T1", status: "done" } });
      expect(await a.next((m) => m.t === "ack" && m.opId === "e1")).toEqual({ t: "ack", opId: "e1", status: "applied", version: 1 });
      const seenA = await a.next<Extract<ServerMessage, { t: "applied" }>>((m) => m.t === "applied" && m.version === 1);
      const seenB = await b.next<Extract<ServerMessage, { t: "applied" }>>((m) => m.t === "applied" && m.version === 1);
      expect(seenB.applied).toEqual(seenA.applied);
      expect(seenB.applied.effective).toMatchObject({ kind: "setStatus", taskId: "T1", status: "done" });
      expect(seenB.applied.actor).toEqual({ userId: "u-alex", name: "Alex" });
      a.send({ t: "edit", opId: "e1", clientId: "ca", op: { kind: "setStatus", taskId: "T1", status: "done" } });
      expect(await a.next((m) => m.t === "ack" && m.opId === "e1")).toMatchObject({ status: "duplicate", version: 1 });
    });

    it("sends edits made through the API to every connection", async () => {
      const [a, b] = clients as [LiveClient, LiveClient];
      const res = await host.fetch(`/api/plans/${planId}/ops`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opId: "http-1", clientId: "web", op: { kind: "setField", taskId: "T3", field: "owner", value: "Sam" } }) }, ALEX);
      expect(((await res.json()) as { version: number }).version).toBe(2);
      for (const c of [a, b]) expect((await c.next<Extract<ServerMessage, { t: "applied" }>>((m) => m.t === "applied" && m.version === 2)).applied.env.opId).toBe("http-1");
    });

    it("catches up a reconnecting client with just the edits it missed", async () => {
      const c = await connect();
      c.send({ t: "hello", since: 1 });
      const w = await c.next<Extract<ServerMessage, { t: "welcome" }>>(kind("welcome"));
      expect(w.version).toBe(2);
      expect("missed" in w && w.missed.map((x: Applied) => x.seq)).toEqual([2]);
      c.close();
    });

    it("rejects bad edits and bad messages, and keeps the connection working", async () => {
      const a = clients[0]!;
      a.send({ t: "edit", opId: "bad-1", clientId: "ca", op: { kind: "setField", taskId: "T1", field: "done", value: { date: TODAY, by: "Mallory" } } });
      expect(await a.next((m) => m.t === "ack" && m.opId === "bad-1")).toMatchObject({ status: "rejected" });
      a.send("{not json");
      expect(await a.next(kind("error"))).toEqual({ t: "error", error: "That message isn't valid JSON." });
      a.send({ t: "dance" });
      expect(await a.next(kind("error"))).toEqual({ t: "error", error: "Unknown message." });
      a.send({ t: "edit", opId: "ok-after", clientId: "ca", op: { kind: "setStatus", taskId: "T3", status: "progress" } });
      expect(await a.next((m) => m.t === "ack" && m.opId === "ok-after")).toMatchObject({ status: "applied", version: 3 });
    });

    it("keeps a burst from two clients in one order that everyone agrees on", async () => {
      const [a, b] = clients as [LiveClient, LiveClient];
      const N = 40;
      for (let i = 0; i < N; i++) {
        a.send({ t: "edit", opId: `ba-${i}`, clientId: "ca", op: { kind: "setField", taskId: "T2", field: "title", value: `A ${i}` } });
        b.send({ t: "edit", opId: `bb-${i}`, clientId: "cb", op: { kind: "setField", taskId: "T2", field: "title", value: `B ${i}` } });
      }
      const last = 3 + 2 * N;
      await a.next((m) => m.t === "applied" && m.version === last, 15_000);
      await b.next((m) => m.t === "applied" && m.version === last, 15_000);
      const seqA = a.applied().map((m) => m.version);
      const seqB = b.applied().map((m) => m.version);
      expect(seqA).toEqual(Array.from({ length: last }, (_, i) => i + 1));
      expect(seqB).toEqual(seqA);
      expect(b.applied().map((m) => m.applied.env.opId)).toEqual(a.applied().map((m) => m.applied.env.opId));

      // A client that applies what it received ends up with exactly the server's plan.
      const start = parsePlan("---\nezplan: 1\ntitle: Live\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: First (1d)\n- [ ] T2: Second (2d) depends: T1\n- [ ] T3: Third (1d)").plan;
      const server = ((await (await host.fetch(`/api/plans/${planId}`, {}, ALEX)).json()) as { plan: Plan }).plan;
      const replica = new ClientReplica("check", { userId: "u-alex", name: "Alex" }, { ...start, id: server.id });
      for (const m of a.applied()) replica.receive(m.applied, TODAY);
      expect(replica.view(TODAY)).toEqual(server);
    }, 30_000);

    it("updates presence when someone leaves", async () => {
      const [a, b] = clients as [LiveClient, LiveClient];
      b.close();
      const p = await a.next<Extract<ServerMessage, { t: "presence" }>>((m) => m.t === "presence" && m.people[0]?.connections === 1);
      expect(p.people).toEqual([{ userId: "u-alex", name: "Alex", connections: 1 }]);
    });
  });
}
