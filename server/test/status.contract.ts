/**
 * Baselines and status updates (step J1). Written once, run on both hosts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allTasks, type Plan } from "@ezplan/shared";
import type { HostFactory, TestHost } from "./contract";
import { TODAY } from "./contract";

const ALEX = "u-alex|Alex|alex@example.com";
const SAM = "u-sam|Sam Okoye|sam@example.com"; // a viewer
const PLAN = "---\nezplan: 1\ntitle: Gala\nstart: 2027-01-04\n---\n## P1: Venue\n- [ ] T1: Book venue (2d) @Alex\n- [ ] T2: Set budget (1d) @Alex depends: T1\n- [ ] T3: Send invites (1d) @Alex depends: T2";
const NOW = Date.parse(`${TODAY}T12:00:00Z`);
const DAY = 86_400_000;

export function statusContract(hostName: string, factory: HostFactory) {
  describe(`Baselines and status updates: ${hostName}`, () => {
    let host: TestHost;
    let id = "";
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };

    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      id = (await req("POST", "/api/plans", { text: PLAN }, ALEX)).body.id;
      const link = (await req("POST", `/api/plans/${id}/invites`, { email: "sam@example.com", role: "viewer" }, ALEX)).body.link as string;
      await req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, SAM);
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("set baseline: the server's dates become planned dates, saved as a version, and slips show", async () => {
      expect((await req("POST", `/api/plans/${id}/baseline`, {}, SAM)).status).toBe(403);
      // A client can't send a baseline of its own.
      expect((await req("POST", `/api/plans/${id}/ops`, { opId: "b1", clientId: "c", op: { kind: "setBaseline", on: TODAY, dates: { T1: { start: "2020-01-01", end: "2020-01-01" } } } }, ALEX)).status).toBe(400);

      const set = await req("POST", `/api/plans/${id}/baseline`, {}, ALEX);
      expect(set.status).toBe(200);
      expect(set.body).toMatchObject({ baselineSet: TODAY, savedVersion: expect.any(Number) });
      const got = (await req("GET", `/api/plans/${id}`, undefined, ALEX)).body as { plan: Plan; schedule: { tasks: Record<string, { start: string; end: string }> } };
      expect(got.plan.baselineSet).toBe(TODAY);
      for (const t of allTasks(got.plan)) expect(t.planned).toEqual({ start: got.schedule.tasks[t.id]!.start, end: got.schedule.tasks[t.id]!.end });
      const versions = (await req("GET", `/api/plans/${id}/versions`, undefined, ALEX)).body.versions as { reason: string }[];
      expect(versions.some((v) => v.reason === "Before setting the baseline")).toBe(true);
      expect(((await req("GET", `/api/plans/${id}/activity`, undefined, ALEX)).body.items as { summary: string }[]).some((a) => a.summary === `Alex set the baseline (planned dates as of ${TODAY})`)).toBe(true);
      expect((await req("GET", "/api/plans", undefined, ALEX)).body.plans.find((p: { id: string }) => p.id === id).summary.baselineVarianceDays).toBe(0);

      // Book venue takes 3 days longer: the finish slips 3 working days against the baseline.
      expect((await req("POST", `/api/plans/${id}/ops`, { opId: "slip", clientId: "c", op: { kind: "setField", taskId: "T1", field: "estimate", value: { amount: 5, unit: "d" } } }, ALEX)).status).toBe(200);
      expect((await req("GET", "/api/plans", undefined, ALEX)).body.plans.find((p: { id: string }) => p.id === id).summary.baselineVarianceDays).toBe(3);

      // Setting it again replaces it, and says so in Version history.
      await req("POST", `/api/plans/${id}/baseline`, {}, ALEX);
      expect(((await req("GET", `/api/plans/${id}/versions`, undefined, ALEX)).body.versions as { reason: string }[]).some((v) => v.reason === `Before replacing the baseline from ${TODAY}`)).toBe(true);
      expect((await req("GET", "/api/plans", undefined, ALEX)).body.plans.find((p: { id: string }) => p.id === id).summary.baselineVarianceDays).toBe(0);
    });

    it("status updates: editors post, everyone reads, people are told, and one is due after 7 days", async () => {
      const list = () => req("GET", `/api/plans/${id}/status-updates`, undefined, SAM);
      expect((await list()).body).toMatchObject({ canPost: false, overdue: false, items: [] });
      expect((await req("GET", `/api/plans/${id}`, undefined, SAM)).body.statusUpdate).toEqual({ last: null, overdue: false });

      const update = { rag: "amber", headline: "Venue slipped 3 days", sections: [{ title: "Done", text: "Budget agreed." }, { title: "Next", text: "Send invites." }, { title: "", text: "dropped" }], source: "template" };
      expect((await req("POST", `/api/plans/${id}/status-updates`, update, SAM)).status).toBe(403);
      expect((await req("POST", `/api/plans/${id}/status-updates`, { ...update, rag: "purple" }, ALEX)).status).toBe(400);
      expect((await req("POST", `/api/plans/${id}/status-updates`, { ...update, headline: "" }, ALEX)).status).toBe(400);
      expect((await req("POST", `/api/plans/${id}/status-updates`, { ...update, headline: "how to build a bomb" }, ALEX)).status).toBe(422);
      expect((await req("POST", `/api/plans/${id}/status-updates`, update, ALEX)).status).toBe(201);

      expect((await list()).body.items).toEqual([{ id: expect.any(String), rag: "amber", headline: "Venue slipped 3 days", sections: [{ title: "Done", text: "Budget agreed." }, { title: "Next", text: "Send invites." }], source: "template", author: "Alex", createdAt: NOW }]);
      expect((await req("GET", `/api/plans/${id}`, undefined, SAM)).body.statusUpdate).toEqual({ last: { rag: "amber", headline: "Venue slipped 3 days", at: NOW }, overdue: false });
      expect((await req("GET", "/api/notifications", undefined, SAM)).body.items.find((n: { kind: string }) => n.kind === "status")).toMatchObject({ text: "Alex posted an amber status update on Gala: Venue slipped 3 days", link: `/p/${id}/report` });
      expect(((await req("GET", `/api/plans/${id}/activity`, undefined, SAM)).body.items as { summary: string }[]).some((a) => a.summary === "Alex posted an amber status update: Venue slipped 3 days")).toBe(true);
      expect((await req("GET", "/api/notifications", undefined, ALEX)).body.items.some((n: { kind: string }) => n.kind === "status")).toBe(false); // not told about their own

      // Eight days later, an update is due again (shown on the plan and on Home).
      await host.sql!(`UPDATE status_updates SET created_at = ? WHERE plan_id = ?`, [NOW - 8 * DAY, id]);
      expect((await list()).body.overdue).toBe(true);
      expect((await req("GET", "/api/plans", undefined, ALEX)).body.plans.find((p: { id: string }) => p.id === id).statusUpdate).toMatchObject({ overdue: true, last: { rag: "amber" } });
    });
  });
}
