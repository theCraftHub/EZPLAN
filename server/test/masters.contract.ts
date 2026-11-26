/**
 * Master plans on the server (step K2): grouping plans, keys, departments, master-aware dates,
 * access (a person on one plan sees the rest only in outline), Discussion and Activity.
 * Written once, run on both hosts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const ALEX = "u-alex|Alex|alex@example.com"; // manages the workspace
const PAT = "u-pat|Pat Plumber|pat@example.com"; // only on Bathroom 2
const EVE = "u-eve|Eve|eve@example.com"; // unrelated
const plan = (title: string, body: string) => `---\nrakuplan: 1\ntitle: ${title}\nstart: 2027-03-01\n---\n## P1: Work\n${body}\n`;

export function mastersContract(hostName: string, factory: HostFactory) {
  describe(`Master plans: ${hostName}`, () => {
    let host: TestHost;
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    let reception = "", bath = "", master = "";

    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      reception = (await req("POST", "/api/plans", { text: plan("Reception", "- [ ] T1: Demolish old front desk (2d) @Kai dept: Facilities\n- [ ] T2: Move network closet (3d) @Ivan dept: IT depends: T1") }, ALEX)).body.id;
      bath = (await req("POST", "/api/plans", { text: plan("Bathroom 2", "- [ ] T1: Strip Bathroom 2 (2d) @Kai\n- [ ] T2: Rough plumbing (3d) @Pat depends: T1, reception/T2") }, ALEX)).body.id;
      const link = (await req("POST", `/api/plans/${bath}/invites`, { email: "pat@example.com", role: "editor" }, ALEX)).body.link as string;
      await req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, PAT);
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("groups plans into a master; keys, departments and one schedule across them", async () => {
      expect((await req("POST", "/api/masters", { title: "HQ remodel", planIds: [] }, ALEX)).status).toBe(400);
      expect((await req("POST", "/api/masters", { title: "HQ remodel", planIds: [reception] }, PAT)).status).toBe(404);
      const made = await req("POST", "/api/masters", { title: "HQ remodel", planIds: [reception, bath], start: "2027-03-01" }, ALEX);
      expect(made.status).toBe(201);
      master = made.body.id;
      expect(made.body.keys).toEqual({ [reception]: "reception", [bath]: "bathroom-2" });
      expect((await req("POST", "/api/masters", { title: "Again", planIds: [bath] }, ALEX)).body.error).toMatch(/already in a master plan/);
      expect((await req("PUT", `/api/masters/${master}/plans/${bath}/departments`, { lead: "Facilities", needs: ["IT", "Facilities", "HR"] }, ALEX)).status).toBe(200);
      expect((await req("PUT", `/api/masters/${master}/departments/IT`, { contact: "Ivan Petrov", role: "IT lead" }, ALEX)).status).toBe(200);

      const m = (await req("GET", `/api/masters/${master}`, undefined, ALEX)).body;
      expect(m.parts.map((p: { key: string }) => p.key)).toEqual(["master", "bathroom-2", "reception"]);
      expect(m.parts.find((p: { key: string }) => p.key === "bathroom-2")).toMatchObject({ lead: "Facilities", needs: ["IT", "HR"] });
      expect(m.departments).toEqual([{ name: "IT", contact: "Ivan Petrov", role: "IT lead" }]);

      // Bathroom 2's plumbing waits on Reception's closet move, and Kai can't strip the bathroom
      // while demolishing the desk: Bathroom 2's own page shows the master's dates.
      const own = (await req("GET", `/api/plans/${bath}`, undefined, ALEX)).body;
      expect(own.master).toMatchObject({ id: master, key: "bathroom-2", isMaster: false, canOpenMaster: true });
      const recv = (await req("GET", `/api/plans/${reception}`, undefined, ALEX)).body;
      expect(own.schedule.tasks.T2.start >= recv.schedule.tasks.T2.end).toBe(true);
      expect(own.schedule.tasks.T1.start).not.toBe(recv.schedule.tasks.T1.start); // Kai does one at a time
      expect(own.check.findings.some((f: { code: string }) => f.code === "unknown-dependency")).toBe(false);
      const home = (await req("GET", "/api/plans", undefined, ALEX)).body.plans as { id: string; master?: { plans: number }; masterId?: string }[];
      expect(home.find((p) => p.id === master)!.master).toEqual({ plans: 2 });
      expect(home.find((p) => p.id === bath)!.masterId).toBe(master);
    });

    it("someone on one plan sees it fully and the rest only in outline; never the master itself", async () => {
      const own = (await req("GET", `/api/plans/${bath}`, undefined, PAT)).body;
      expect(own.master).toMatchObject({ key: "bathroom-2", canOpenMaster: false });
      const outline = JSON.stringify(own.master.view);
      expect(outline).toContain("Move network closet"); // the task Pat's work waits on
      expect(outline).not.toContain("Demolish old front desk");
      expect(outline).not.toContain("Ivan");
      expect((await req("GET", `/api/masters/${master}`, undefined, PAT)).status).toBe(404);
      expect((await req("GET", `/api/plans/${reception}`, undefined, PAT)).status).toBe(404);
      expect((await req("GET", `/api/masters/${master}/activity`, undefined, PAT)).status).toBe(404);
      expect((await req("POST", `/api/masters/${master}/plans`, { planId: reception }, PAT)).status).toBe(404);
      expect((await req("GET", `/api/masters/${master}`, undefined, EVE)).status).toBe(404);
    });

    it("discussion: one thread per plan plus Whole building; mentions notify; Pat sees only his", async () => {
      expect((await req("POST", `/api/masters/${master}/threads/${reception}`, { body: "Closet move starts Monday. @Pat Plumber FYI", about: "T2" }, ALEX)).status).toBe(201);
      expect((await req("POST", `/api/masters/${master}/threads/${master}`, { body: "Permits approved." }, ALEX)).status).toBe(201);
      expect((await req("POST", `/api/masters/${master}/threads/${bath}`, { body: "Drain goes on the left wall.", about: "reception/T2" }, PAT)).status).toBe(201);
      expect((await req("POST", `/api/masters/${master}/threads/${reception}`, { body: "hi" }, PAT)).status).toBe(404);
      expect((await req("POST", `/api/masters/${master}/threads/${bath}`, { body: "how to build a bomb" }, PAT)).status).toBe(422);

      const all = (await req("GET", `/api/masters/${master}/threads`, undefined, ALEX)).body.threads as { title: string; count: number }[];
      expect(all.map((t) => [t.title, t.count])).toEqual([["Whole building", 1], ["Bathroom 2", 1], ["Reception", 1]]);
      const pats = (await req("GET", `/api/masters/${master}/threads`, undefined, PAT)).body.threads as { title: string }[];
      expect(pats.map((t) => t.title)).toEqual(["Whole building", "Bathroom 2"]);
      expect((await req("GET", `/api/masters/${master}/threads/${bath}`, undefined, PAT)).body.messages).toMatchObject([{ author: "Pat Plumber", about: "reception/T2" }]);
      // Pat was mentioned in a thread he can't read, so he isn't told (the mention list is that plan's people).
      expect((await req("GET", "/api/notifications", undefined, PAT)).body.items.some((n: { kind: string }) => n.kind === "mention")).toBe(false);
      expect((await req("GET", `/api/masters/${master}/threads`, undefined, EVE)).status).toBe(404);

      const act = (await req("GET", `/api/masters/${master}/activity`, undefined, ALEX)).body.items as { plan: string; summary: string }[];
      expect(act.some((a) => a.plan === "Bathroom 2" && a.summary === "Pat Plumber posted in the Bathroom 2 discussion")).toBe(true);
      expect(act.some((a) => a.plan === "Whole building" && /made the master plan with 2 plans/.test(a.summary))).toBe(true);
    });

    it("taking a plan out", async () => {
      expect((await req("DELETE", `/api/masters/${master}/plans/${reception}`, undefined, PAT)).status).toBe(404);
      expect((await req("DELETE", `/api/masters/${master}/plans/${reception}`, undefined, ALEX)).status).toBe(200);
      expect((await req("GET", `/api/plans/${reception}`, undefined, ALEX)).body.master).toBeNull();
      expect((await req("GET", `/api/masters/${master}`, undefined, ALEX)).body.parts.map((p: { key: string }) => p.key)).toEqual(["master", "bathroom-2"]);
    });
  });
}
