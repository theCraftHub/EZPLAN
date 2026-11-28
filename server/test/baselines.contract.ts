/** Step N5c: named baselines. Editors save and switch; viewers read; older single baselines carry over; up to five. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const MAY = "u-mayb|May Fox|may@base.test"; // maker
const VIC = "u-vicb|Vic|vic@base.test"; // viewer
const OUT = "u-outb|Out|out@base.test";
const PLAN = `---\nrakuplan: 1\ntitle: Fit\nstart: 2027-03-01\nbaseline_set: 2027-02-20\n---\n## P1: Work\n- [ ] T1: Design (2d)\n  planned: 2027-03-01 → 2027-03-02\n- [ ] T2: Build (3d) depends: T1`;

export function baselinesContract(hostName: string, factory: HostFactory) {
  describe(`Named baselines: ${hostName}`, () => {
    let host: TestHost;
    let id = "";
    const req = async (method: string, path: string, body?: unknown, user = MAY) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const get = async (path: string, user = MAY) => {
      const r = await host.fetch(path, {}, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      id = (await req("POST", "/api/plans", { text: PLAN })).body.id;
      const link = (await req("POST", `/api/plans/${id}/invites`, { email: "vic@base.test", role: "viewer" })).body.link;
      await req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, VIC);
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("keeps a baseline from before names as the first one, in use", async () => {
      const list = await get(`/api/plans/${id}/baselines`, VIC);
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ limit: 5, canEdit: false, baselines: [{ name: "Baseline", setOn: "2027-02-20", finish: "2027-03-02", active: true }] });
      expect((await get(`/api/plans/${id}/baselines`, OUT)).status).toBe(404);
    });

    it("saves a named one from today's schedule and switches between them", async () => {
      expect((await req("POST", `/api/plans/${id}/baseline`, { name: "Viewer try" }, VIC)).status).toBe(403);
      const made = await req("POST", `/api/plans/${id}/baseline`, { name: "  Signed contract  " });
      expect(made.status).toBe(200);
      expect(made.body.name).toBe("Signed contract");
      const dup = await req("POST", `/api/plans/${id}/baseline`, { name: "signed contract" });
      expect(dup.body.name).toBe("signed contract (2)");
      const list = (await get(`/api/plans/${id}/baselines`)).body.baselines as { id: string; name: string; active: boolean }[];
      expect(list.map((b) => [b.name, b.active])).toEqual([["Baseline", false], ["Signed contract", false], ["signed contract (2)", true]]);
      const plan = (await get(`/api/plans/${id}`)).body.plan;
      expect(plan.baselineName).toBe("signed contract (2)");
      expect(plan.phases[0].tasks[1].planned).toBeTruthy();

      // Back to the original: T2 had no planned dates then.
      expect((await req("POST", `/api/plans/${id}/baselines/${list[0]!.id}/use`, {}, VIC)).status).toBe(403);
      expect((await req("POST", `/api/plans/${id}/baselines/${list[0]!.id}/use`)).status).toBe(200);
      const back = (await get(`/api/plans/${id}`)).body.plan;
      expect([back.baselineSet, back.baselineName, back.phases[0].tasks[1].planned]).toEqual(["2027-02-20", "Baseline", undefined]);
      expect((await get(`/api/plans/${id}/activity`)).body.items.some((i: { summary: string }) => i.summary.includes('compared the plan to the baseline "Baseline"'))).toBe(true);
    });

    it("removes any but the one in use, and keeps up to five", async () => {
      const list = (await get(`/api/plans/${id}/baselines`)).body.baselines as { id: string; name: string; active: boolean }[];
      const active = list.find((b) => b.active)!;
      expect((await req("DELETE", `/api/plans/${id}/baselines/${active.id}`)).status).toBe(400);
      expect((await req("DELETE", `/api/plans/${id}/baselines/${list[1]!.id}`, {}, VIC)).status).toBe(403);
      expect((await req("DELETE", `/api/plans/${id}/baselines/${list[1]!.id}`)).status).toBe(200);
      expect((await req("DELETE", `/api/plans/${id}/baselines/${list[1]!.id}`)).status).toBe(404);
      for (let i = 0; i < 3; i++) expect((await req("POST", `/api/plans/${id}/baseline`, { name: `B${i}` })).status).toBe(200);
      const over = await req("POST", `/api/plans/${id}/baseline`, { name: "Too many" });
      expect([over.status, over.body.error]).toEqual([400, "A plan keeps up to 5 baselines. Remove one you no longer need first."]);
    });
  });
}
