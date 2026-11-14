import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTasks, ClientReplica, newRoom, parsePlan, serverApply, type Actor, type Op, type OpEnvelope, type Plan } from "../src";

const gala = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "gala.ezplan"), "utf8")).plan;
const DAY = "2026-12-08";
const sam: Actor = { userId: "u1", name: "Sam" };
const ana: Actor = { userId: "u2", name: "Ana" };
const leo: Actor = { userId: "u3", name: "Leo" };
const task = (p: Plan, id: string) => allTasks(p).find((t) => t.id === id);

function setup() {
  const room = newRoom(gala);
  const clients = { sam: new ClientReplica("c-sam", sam, gala), ana: new ClientReplica("c-ana", ana, gala), leo: new ClientReplica("c-leo", leo, gala) };
  const actorOf: Record<string, Actor> = { "c-sam": sam, "c-ana": ana, "c-leo": leo };
  /** Sends a client's outbox to the server and broadcasts results to everyone. */
  const sync = (c: ClientReplica) => {
    for (const env of c.outbox()) {
      const applied = serverApply(room, env, actorOf[env.clientId]!, DAY);
      if (applied) for (const other of Object.values(clients)) other.receive(applied, DAY);
    }
  };
  return { room, clients, sync };
}

describe("live editing sync", () => {
  it("shows a local edit immediately, before the server confirms it", () => {
    const { clients } = setup();
    clients.sam.edit({ kind: "setField", taskId: "T3", field: "title", value: "Pitch 12 businesses" });
    expect(task(clients.sam.view(DAY), "T3")!.title).toBe("Pitch 12 businesses");
    expect(task(clients.ana.view(DAY), "T3")!.title).toBe("Pitch 10 local businesses");
  });

  it("concurrent edits to the same field: last to reach the server wins, everyone converges", () => {
    const { room, clients, sync } = setup();
    clients.sam.edit({ kind: "setField", taskId: "T3", field: "owner", value: "Sam" });
    clients.ana.edit({ kind: "setField", taskId: "T3", field: "owner", value: "Ana" });
    sync(clients.sam);
    sync(clients.ana);
    for (const c of Object.values(clients)) expect(c.view(DAY)).toEqual(room.plan);
    expect(task(room.plan, "T3")!.owner).toBe("Ana");
  });

  it("concurrent edits to different fields both survive", () => {
    const { room, clients, sync } = setup();
    clients.sam.edit({ kind: "setField", taskId: "T2", field: "due", value: "2026-12-11" });
    clients.ana.edit({ kind: "setStatus", taskId: "T2", status: "done" });
    sync(clients.ana);
    sync(clients.sam);
    expect(task(room.plan, "T2")).toMatchObject({ due: "2026-12-11", status: "done" });
    for (const c of Object.values(clients)) expect(c.view(DAY)).toEqual(room.plan);
  });

  it("'Done by' always comes from the signed-in person, not the client", () => {
    const { room } = setup();
    const forged: OpEnvelope = { opId: "x:1", clientId: "c-sam", op: { kind: "setStatus", taskId: "T3", status: "done" } };
    serverApply(room, forged, ana, DAY); // the connection is authenticated as Ana
    expect(task(room.plan, "T3")!.done).toEqual({ date: DAY, by: "Ana" });
    serverApply(room, { opId: "x:2", clientId: "c-sam", op: { kind: "setStatus", taskId: "T3", status: "todo" } }, sam, DAY);
    expect(task(room.plan, "T3")!.done).toBeUndefined();
  });

  it("an offline edit to a task someone deleted restores it and flags it for review", () => {
    const { room, clients, sync } = setup();
    clients.leo.edit({ kind: "setField", taskId: "T3", field: "notes", value: ["Called 4 businesses"] }); // Leo is offline
    clients.ana.edit({ kind: "deleteTask", taskId: "T3" });
    sync(clients.ana);
    expect(task(room.plan, "T3")).toBeUndefined();
    expect(room.trash["T3"]).toBeDefined();
    sync(clients.leo); // Leo reconnects
    expect(task(room.plan, "T3")!.notes).toEqual(["Called 4 businesses"]);
    expect(room.restoredForReview).toEqual(["T3"]);
    for (const c of Object.values(clients)) expect(c.view(DAY)).toEqual(room.plan);
  });

  it("re-sending the same edits after a dropped connection applies them once", () => {
    const { room, clients, sync } = setup();
    clients.sam.edit({ kind: "addTask", phaseId: "P2", task: { ...task(gala, "T3")!, id: "T9", title: "Thank sponsors" } });
    const outbox = clients.sam.outbox();
    sync(clients.sam);
    for (const env of outbox) expect(serverApply(room, env, sam, DAY)).toBeNull();
    expect(allTasks(room.plan).filter((t) => t.id === "T9")).toHaveLength(1);
  });

  it("random concurrent and offline edits from three people always converge", () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let round = 0; round < 200; round++) {
      const { room, clients, sync } = setup();
      const list = Object.values(clients);
      const ids = ["T1", "T2", "M1", "T3", "T4"];
      let next = 10;
      for (let step = 0; step < 25; step++) {
        const c = list[rnd(3)]!;
        const id = ids[rnd(ids.length)]!;
        const choice = rnd(6);
        const op: Op =
          choice === 0 ? { kind: "setStatus", taskId: id, status: (["todo", "progress", "done", "skipped"] as const)[rnd(4)]! }
          : choice === 1 ? { kind: "setField", taskId: id, field: "title", value: `Title ${step}` }
          : choice === 2 ? { kind: "deleteTask", taskId: id }
          : choice === 3 ? { kind: "moveTask", taskId: id, phaseId: rnd(2) ? "P1" : "P2" }
          : choice === 4 ? { kind: "addTask", phaseId: "P1", task: { ...task(gala, "T1")!, id: `T${next++}` } }
          : { kind: "setField", taskId: id, field: "owner", value: ["Sam", "Ana", "Leo"][rnd(3)] };
        c.edit(op);
        if (rnd(3) === 0) sync(list[rnd(3)]!); // some clients stay offline for a while
      }
      for (const c of list) sync(c);
      for (const c of list) expect(c.view(DAY)).toEqual(room.plan);
    }
  });
});
