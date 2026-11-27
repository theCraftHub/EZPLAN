/** Step M3: a repeating task, finished through the server, leaves the next one saved in the plan. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const ROSA = "u-rosa|Rosa|rosa@rep.test";
const PLAN = `---\nrakuplan: 1\ntitle: Routine\n---\n## P1: Weekly\n- [ ] T1: Team check-in (1h) @Rosa due: 2027-01-04 repeat: weekly`;

export function recurringContract(hostName: string, factory: HostFactory) {
  describe(`Recurring tasks: ${hostName}`, () => {
    let host: TestHost;
    const req = async (method: string, path: string, body?: unknown) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, ROSA);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    beforeAll(async () => { host = await factory.start({ testAuth: true }); }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("done → the next one is saved, due a week later; invalid repeat rules are refused", async () => {
      const id = (await req("POST", "/api/plans", { text: PLAN })).body.id;
      expect((await req("POST", `/api/plans/${id}/ops`, { opId: "r1", clientId: "t", op: { kind: "setStatus", taskId: "T1", status: "done" } })).status).toBe(200);
      const tasks = (await req("GET", `/api/plans/${id}`)).body.plan.phases[0].tasks as { id: string; status: string; due?: string; repeat?: string }[];
      expect(tasks.map((t) => [t.id, t.status, t.due, t.repeat ?? null])).toEqual([["T1", "done", "2027-01-04", null], ["T2", "todo", "2027-01-11", "weekly"]]);
      expect((await req("POST", `/api/plans/${id}/ops`, { opId: "r2", clientId: "t", op: { kind: "setField", taskId: "T2", field: "repeat", value: "now and then" } })).status).toBe(400);
      expect((await req("POST", `/api/plans/${id}/ops`, { opId: "r3", clientId: "t", op: { kind: "setField", taskId: "T2", field: "repeat", value: null } })).status).toBe(200);
      const file = await (await host.fetch(`/api/plans/${id}/export`, {}, ROSA)).text();
      expect(file).not.toMatch(/repeat:/);
    });
  });
}
