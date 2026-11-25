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

    it("settings: each person's own, small, by key", async () => {
      const layout = { order: ["kpis", "workload"], hidden: ["activity"] };
      expect((await req("GET", "/api/me/prefs/overview.widgets", undefined, ALEX)).body).toEqual({ value: null });
      expect((await req("PUT", "/api/me/prefs/overview.widgets", { value: layout }, ALEX)).status).toBe(200);
      expect((await req("GET", "/api/me/prefs/overview.widgets", undefined, ALEX)).body).toEqual({ value: layout });
      expect((await req("GET", "/api/me/prefs/overview.widgets", undefined, SAM)).body).toEqual({ value: null }); // not shared
      expect((await req("PUT", "/api/me/prefs/overview.widgets", { value: { ...layout, hidden: [] } }, ALEX)).status).toBe(200);
      expect((await req("GET", "/api/me/prefs/overview.widgets", undefined, ALEX)).body.value.hidden).toEqual([]);
      expect((await req("PUT", "/api/me/prefs/Bad Key!", { value: 1 }, ALEX)).status).toBe(400);
      expect((await req("PUT", "/api/me/prefs/big", { value: "x".repeat(5000) }, ALEX)).status).toBe(413);
      expect((await req("PUT", "/api/me/prefs/big", {}, ALEX)).status).toBe(400);
    });

    it("risk log: editors add, change, close and delete; everyone reads; risks need likelihood and impact; counts feed the dashboard", async () => {
      const raid = (method: string, path: string, body: unknown, user: string) => req(method, `/api/plans/${id}/raid${path}`, body, user);
      expect((await raid("GET", "", undefined, SAM)).body).toMatchObject({ canEdit: false, items: [], open: { risks: 0, issues: 0 } });
      const risk = { kind: "risk", title: "Venue may cancel", detail: "Mitigation: book a backup.", owner: "Alex", likelihood: 2, impact: 5, due: "2027-01-20", taskIds: ["T1", "T99"] };
      expect((await raid("POST", "", risk, SAM)).status).toBe(403);
      expect((await raid("POST", "", { ...risk, likelihood: undefined }, ALEX)).status).toBe(400);
      expect((await raid("POST", "", { ...risk, likelihood: 9 }, ALEX)).status).toBe(400);
      expect((await raid("POST", "", { ...risk, kind: "worry" }, ALEX)).status).toBe(400);
      expect((await raid("POST", "", { ...risk, due: "soon" }, ALEX)).status).toBe(400);
      expect((await raid("POST", "", { ...risk, title: "how to build a bomb" }, ALEX)).status).toBe(422);
      const made = await raid("POST", "", risk, ALEX);
      expect(made.status).toBe(201);
      expect(made.body.item).toMatchObject({ kind: "risk", title: "Venue may cancel", likelihood: 2, impact: 5, status: "open", due: "2027-01-20", taskIds: ["T1"], createdBy: "Alex" }); // unknown tasks dropped
      await raid("POST", "", { kind: "issue", title: "Budget not approved", impact: 3 }, ALEX);
      const decision = (await raid("POST", "", { kind: "decision", title: "Use the town hall", likelihood: 4, impact: 4 }, ALEX)).body.item;
      expect(decision).toMatchObject({ likelihood: null, impact: null }); // only risks are rated
      expect((await req("GET", `/api/plans/${id}`, undefined, SAM)).body.raidOpen).toEqual({ risks: 1, issues: 1 });

      // Change and close; only the fields sent change.
      const rid = made.body.item.id as string;
      expect((await raid("PATCH", `/${rid}`, { impact: 4 }, SAM)).status).toBe(403);
      expect((await raid("PATCH", `/${rid}`, { impact: 4 }, ALEX)).body.item).toMatchObject({ impact: 4, likelihood: 2, title: "Venue may cancel" });
      expect((await raid("PATCH", `/${rid}`, { status: "closed" }, ALEX)).body.item.status).toBe("closed");
      expect((await raid("GET", "", undefined, SAM)).body.open).toEqual({ risks: 0, issues: 1 });
      const lines = ((await req("GET", `/api/plans/${id}/activity`, undefined, ALEX)).body.items as { summary: string }[]).map((a) => a.summary);
      expect(lines).toEqual(expect.arrayContaining(["Alex added a risk to the risk log: Venue may cancel", "Alex closed a risk in the risk log: Venue may cancel", "Alex added a decision to the risk log: Use the town hall"]));

      // Delete; another plan's item is invisible.
      expect((await raid("DELETE", `/${decision.id}`, undefined, ALEX)).status).toBe(200);
      expect(((await raid("GET", "", undefined, ALEX)).body.items as { id: string }[]).some((x) => x.id === decision.id)).toBe(false);
      const other = (await req("POST", "/api/plans", { text: PLAN.replace("title: Gala", "title: Other") }, ALEX)).body.id;
      expect((await req("PATCH", `/api/plans/${other}/raid/${rid}`, { impact: 1 }, ALEX)).status).toBe(404);
      expect((await req("GET", `/api/plans/${id}/raid`, undefined, "u-eve|Eve|eve@example.com")).status).toBe(404);
    });
  });
}
