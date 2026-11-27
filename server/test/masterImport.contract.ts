/** Step M6: a whole master plan pasted as one text; checked part by part, then made in one go. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const MO = "u-mo|Mo|mo@mi.test";
const TEXT = `---\nrakuplan: 1\ntitle: HQ remodel\nstart: 2027-01-04\n---\n## P1: Whole building\n- [ ] M1: Permit approved (milestone)\n\n# Plan: Reception\n## P1: Front\n- [ ] T1: Demolish desk (2d) @Kai depends: master/M1\n- [ ] T2: Move network closet (3d) @Ivan depends: T1\n\n# Plan: Office 2\n## P1: Rooms\n- [ ] T1: Walls (3d) @Kai depends: reception/T2\n- [ ] T2: Paint (1d) depends: kitchen/T9\n`;

export function masterImportContract(hostName: string, factory: HostFactory) {
  describe(`Master plan import: ${hostName}`, () => {
    let host: TestHost;
    const req = async (method: string, path: string, body?: unknown) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, MO);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    beforeAll(async () => { host = await factory.start({ testAuth: true }); }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("dry run lists each plan and warns about links to plans that aren't there; nothing is made", async () => {
      const dry = (await req("POST", "/api/masters/import", { text: TEXT, dryRun: true })).body;
      expect(dry.plans.map((p: { title: string; key: string; tasks: number }) => [p.title, p.key, p.tasks])).toEqual([["Whole building", "master", 1], ["Reception", "reception", 2], ["Office 2", "office-2", 2]]);
      expect(dry.warnings).toEqual([expect.stringContaining(`waits on "kitchen/T9"`)]);
      expect((await req("GET", "/api/plans")).body.plans).toEqual([]);
      expect((await req("POST", "/api/masters/import", { text: "## P1: X\n- [ ] T1: Y (1d)" })).status).toBe(400);
    });

    it("saves the master and its plans, linked and scheduled as one", async () => {
      const made = await req("POST", "/api/masters/import", { text: TEXT });
      expect(made.status).toBe(201);
      const m = (await req("GET", `/api/masters/${made.body.id}`)).body;
      expect(m.title).toBe("HQ remodel");
      expect(m.parts.map((p: { key: string; title: string }) => `${p.key}:${p.title}`).sort()).toEqual(["master:Whole building", "office-2:Office 2", "reception:Reception"]);
      const home = (await req("GET", "/api/plans")).body.plans as { title: string; master?: { plans: number }; masterId?: string }[];
      expect(home.find((p) => p.title === "HQ remodel")?.master).toEqual({ plans: 2 });
      expect(home.filter((p) => p.masterId === made.body.id)).toHaveLength(2);
    });
  });
}
