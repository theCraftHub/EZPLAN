import { describe, expect, it } from "vitest";
import { allTasks, ClientReplica, parsePlan, type Plan } from "../src";

const plan = parsePlan(`---\nrakuplan: 1\ntitle: Shed\n---\n## P1: Work\n- [ ] T1: Base (1d)\n- [ ] T2: Walls (1d)`).plan as Plan;
const me = { userId: "u", name: "Kim" };

describe("offline copies of a replica", () => {
  it("a snapshot restores the confirmed plan, unsent edits and the edit counter (IDs never repeat)", () => {
    const a = new ClientReplica("dev1", me, plan, 4);
    a.edit({ kind: "setStatus", taskId: "T1", status: "progress" });
    const snap = a.snapshot();
    expect(snap).toMatchObject({ version: 4, sent: 1, pending: [{ opId: "dev1:1" }] });
    const b = new ClientReplica("dev1", me, snap.confirmed, snap.version, { pending: snap.pending, sent: snap.sent });
    expect(allTasks(b.view("2027-01-04"))[0]!.status).toBe("progress");
    expect(b.edit({ kind: "setStatus", taskId: "T2", status: "progress" }).opId).toBe("dev1:2");
    expect(b.outbox().map((e) => e.opId)).toEqual(["dev1:1", "dev1:2"]);
    // The snapshot is a copy: later edits don't change it.
    expect(snap.pending).toHaveLength(1);
  });
});
