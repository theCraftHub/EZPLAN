/**
 * AI credits, spending and the safety review queue, written once, run on both hosts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";
import { csvCell } from "../src/ai/admin";

const ALEX = "u-alex|Alex|alex@example.com";
const SAM = "u-sam|Sam|sam@example.com";
const KIM = "u-kim|Kim|kim@example.com";
const OWNER = "u-owner|Owner|owner@example.com"; // on PLATFORM_ADMINS in the test config
const plan = (title: string) => `---\nezplan: 1\ntitle: ${title}\nstart: 2027-01-04\n---\n## P1: Work\n- [x] T1: Measure (1d) @Alex done: 2027-01-04 by Alex\n- [ ] T2: Order cabinets (2d) @Alex depends: T1\n- [ ] M1: Ordered (milestone) depends: T2`;

export function aiAdminContract(hostName: string, factory: HostFactory) {
  describe(`AI credits, spending and safety review: ${hostName}`, () => {
    let host: TestHost;
    let ws = "";
    let kitchen = "";
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      const text = await r.text();
      let json: Record<string, any> = {};
      try { json = JSON.parse(text); } catch { /* CSV */ }
      return { status: r.status, body: json, text, headers: r.headers };
    };
    const newPlan = async (title: string, user = ALEX) => (await req("POST", "/api/plans", { text: plan(title) }, user)).body.id as string;

    beforeAll(async () => {
      host = await factory.start({ testAuth: true, testAi: true });
      kitchen = await newPlan("Kitchen");
      ws = (await req("GET", "/api/me", undefined, ALEX)).body.workspaces[0].id;
      const link = (await req("POST", `/api/plans/${kitchen}/invites`, { email: "sam@example.com", role: "editor" }, ALEX)).body.link as string;
      await req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, SAM);
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("a person asks for more; only a credit manager approves (from the pool) or declines", async () => {
      expect((await req("POST", `/api/workspaces/${ws}/ai/requests`, { checks: 0 }, SAM)).status).toBe(400);
      const asked = await req("POST", `/api/workspaces/${ws}/ai/requests`, { checks: 3, note: "Big week" }, SAM);
      expect(asked.status).toBe(201);
      expect((await req("POST", `/api/workspaces/${ws}/ai/requests`, { checks: 1 }, SAM)).status).toBe(409); // one waiting at a time
      expect((await req("POST", `/api/workspaces/${ws}/ai/requests`, { checks: 1 }, KIM)).status).toBe(404); // not in this workspace at all

      const mine = (await req("GET", `/api/workspaces/${ws}/ai/requests`, undefined, SAM)).body;
      expect(mine).toMatchObject({ canManage: false, approvers: ["Alex"], requests: [{ name: "Sam", checks: 3, status: "pending" }] });
      // Sam (on one plan only) can't approve, see the pool, change allowances or top up.
      expect((await req("POST", `/api/workspaces/${ws}/ai/requests/${asked.body.id}`, { decision: "approve" }, SAM)).status).toBe(403);
      expect((await req("GET", `/api/workspaces/${ws}/ai/admin`, undefined, SAM)).status).toBe(403);
      expect((await req("PUT", `/api/workspaces/${ws}/ai/allowances/*`, { checks: 99, reports: 9 }, SAM)).status).toBe(403);
      expect((await req("POST", `/api/workspaces/${ws}/ai/topup`, { checks: 5 }, SAM)).status).toBe(403);

      expect((await req("GET", `/api/workspaces/${ws}/ai/requests`, undefined, ALEX)).body.requests).toHaveLength(1);
      expect((await req("POST", `/api/workspaces/${ws}/ai/requests/${asked.body.id}`, { decision: "approve", checks: 100 }, ALEX)).status).toBe(409); // more than the pool has
      expect((await req("POST", `/api/workspaces/${ws}/ai/requests/${asked.body.id}`, { decision: "approve", checks: 2 }, ALEX)).status).toBe(200);
      expect((await req("POST", `/api/workspaces/${ws}/ai/requests/${asked.body.id}`, { decision: "decline" }, ALEX)).status).toBe(409); // already answered
      expect((await req("GET", `/api/plans/${kitchen}/ai`, undefined, SAM)).body.usage.checks).toEqual({ used: 0, limit: 6 });

      const again = await req("POST", `/api/workspaces/${ws}/ai/requests`, { reports: 2 }, SAM);
      expect((await req("POST", `/api/workspaces/${ws}/ai/requests/${again.body.id}`, { decision: "decline" }, ALEX)).status).toBe(200);
      const after = (await req("GET", `/api/workspaces/${ws}/ai/requests`, undefined, SAM)).body.requests;
      expect(after.map((r: { status: string; decidedBy: string }) => [r.status, r.decidedBy])).toEqual([["declined", "Alex"], ["approved", "Alex"]]);
    });

    it("allowances, top-ups up to the ceiling, and department labels: credit managers only", async () => {
      expect((await req("PUT", `/api/workspaces/${ws}/ai/allowances/*`, { checks: 10, reports: 5 }, ALEX)).status).toBe(200);
      expect((await req("PUT", `/api/workspaces/${ws}/ai/allowances/u-alex`, { checks: -1, reports: 5 }, ALEX)).status).toBe(400);
      expect((await req("PUT", `/api/workspaces/${ws}/ai/allowances/u-nobody`, { checks: 1, reports: 1 }, ALEX)).status).toBe(404);
      expect((await req("POST", `/api/workspaces/${ws}/ai/topup`, { checks: 10, reason: "Launch month" }, ALEX)).status).toBe(200);
      expect((await req("POST", `/api/workspaces/${ws}/ai/topup`, { checks: 50 }, ALEX)).status).toBe(400); // 16 + 50 > 60
      expect((await req("PUT", `/api/workspaces/${ws}/members/u-alex/department`, { department: "=Operations" }, ALEX)).status).toBe(200);
      expect((await req("PUT", `/api/workspaces/${ws}/members/u-sam/department`, { department: "Sales" }, ALEX)).status).toBe(404); // Sam is on a plan, not the workspace
      expect((await req("PUT", `/api/workspaces/${ws}/members/u-alex/department`, { department: "x" }, SAM)).status).toBe(403);
      const admin = (await req("GET", `/api/workspaces/${ws}/ai/admin`, undefined, ALEX)).body;
      expect(admin.pool.total.checks).toBe(16);
      expect(admin.pool.max).toBe(60);
      expect(admin.defaultAllowance).toEqual({ checks: 10, reports: 5 });
      expect(admin.people).toMatchObject([{ name: "Alex", department: "=Operations", checks: { limit: 10 } }]);
    });

    it("spending: totals, people, projects and departments add up to the usage log, with drill-downs and safe CSV", async () => {
      await req("POST", `/api/plans/${kitchen}/ai/check`, {}, ALEX);
      await req("POST", `/api/plans/${kitchen}/ai/check`, {}, SAM);
      await req("POST", `/api/plans/${kitchen}/report`, { ai: true }, ALEX);
      const idle = await newPlan("Unused");

      expect((await req("GET", `/api/workspaces/${ws}/ai/spending`, undefined, SAM)).status).toBe(403);
      expect((await req("GET", `/api/workspaces/${ws}/ai/spending`, undefined, KIM)).status).toBe(403);
      const s = (await req("GET", `/api/workspaces/${ws}/ai/spending`, undefined, ALEX)).body;
      expect(s.totals).toMatchObject({ checks: 2, reports: 1 });
      expect(s.totals.cost).toBeGreaterThan(0);
      const sum = (xs: { cost: number }[]) => xs.reduce((n, x) => n + x.cost, 0);
      expect(sum(s.people)).toBeCloseTo(s.totals.cost, 10);
      expect(sum(s.departments)).toBeCloseTo(s.totals.cost, 10);
      expect(sum(s.projects)).toBeCloseTo(s.totals.cost, 10);
      expect(sum(s.daily.map((cost: number) => ({ cost })))).toBeCloseTo(s.totals.cost, 10);
      expect(s.departments.map((d: { name: string }) => d.name).sort()).toEqual(["=Operations", "Invited to a plan"]);
      expect(s.idle.projects).toContain("Unused");
      expect(s.projects.find((p: { key: string }) => p.key === idle).runs).toBe(0);

      const last = (await req("GET", `/api/workspaces/${ws}/ai/spending?period=last-month`, undefined, ALEX)).body;
      expect(last).toMatchObject({ from: "2026-12-01", to: "2026-12-31", totals: { runs: 0 } });
      expect(last.previousTotals.runs).toBe(0);
      expect((await req("GET", `/api/workspaces/${ws}/ai/spending?period=90d`, undefined, ALEX)).body).toMatchObject({ to: "2027-01-04", totals: { checks: 2 } });
      expect(s.previousTotals.cost).toBe(0);
      expect(s.daily).toHaveLength(4); // Jan 1 to Jan 4
      const sam = (await req("GET", `/api/workspaces/${ws}/ai/spending/person/u-sam`, undefined, ALEX)).body;
      expect(sam.item).toMatchObject({ name: "Sam", checks: 1 });
      expect(sam.byFeature.map((f: { key: string }) => f.key)).toEqual(["check"]);
      expect(sam.related).toContainEqual({ type: "project", key: kitchen, name: "Kitchen" });
      const proj = (await req("GET", `/api/workspaces/${ws}/ai/spending/project/${kitchen}`, undefined, ALEX)).body;
      expect(proj.related.map((r: { name: string }) => r.name).sort()).toEqual(["Alex", "Sam"]);
      const dep = (await req("GET", `/api/workspaces/${ws}/ai/spending/department/${encodeURIComponent("=Operations")}`, undefined, ALEX)).body;
      expect(dep.item.reports).toBe(1);
      expect((await req("GET", `/api/workspaces/${ws}/ai/spending/person/u-nobody`, undefined, ALEX)).status).toBe(404);

      const csv = await req("GET", `/api/workspaces/${ws}/ai/spending.csv?view=departments`, undefined, ALEX);
      expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
      expect(csv.text.split("\n")[0]).toMatch(/^name,cost_usd/);
      expect(csv.text).toContain("'=Operations");
      expect(csv.text).not.toMatch(/^=Operations/m);
      expect((await req("GET", `/api/workspaces/${ws}/ai/spending.csv`, undefined, SAM)).status).toBe(403);
    });

    it("the safety queue is only for the owner's team: release, keep (with a note) or suspend", async () => {
      const held = await newPlan("Held [refuse]", SAM);
      expect((await req("POST", `/api/plans/${held}/ai/check`, {}, SAM)).status).toBe(423);
      const other = await newPlan("Also held [refuse]", KIM);
      expect((await req("POST", `/api/plans/${other}/ai/check`, {}, KIM)).status).toBe(423);

      for (const u of [ALEX, SAM, KIM]) expect((await req("GET", "/api/admin/safety", undefined, u)).status).toBe(404);
      expect((await req("GET", "/api/me", undefined, ALEX)).body).toMatchObject({ platformAdmin: false, safetyOpen: 0 });
      expect((await req("GET", "/api/me", undefined, OWNER)).body).toMatchObject({ platformAdmin: true, safetyOpen: 2 });
      const q = (await req("GET", "/api/admin/safety", undefined, OWNER)).body;
      const hold = q.items.find((i: { planId: string }) => i.planId === held);
      expect(hold).toMatchObject({ status: "held", person: "Sam", planTitle: "Held [refuse]" });
      expect(hold.excerpt.length).toBeLessThanOrEqual(600);
      expect((await req("POST", `/api/admin/safety/${hold.id}`, { action: "release" }, SAM)).status).toBe(404);
      expect((await req("POST", `/api/admin/safety/${hold.id}`, { action: "keep" }, OWNER)).status).toBe(400); // a note is needed

      expect((await req("POST", `/api/admin/safety/${hold.id}`, { action: "release", note: "Reviewed: fine" }, OWNER)).status).toBe(200);
      expect((await req("GET", `/api/plans/${held}`, undefined, SAM)).body.state).toBe("active");
      expect((await req("POST", `/api/plans/${held}/report`, {}, SAM)).status).toBe(200);

      const kimHold = q.items.find((i: { planId: string }) => i.planId === other);
      expect((await req("GET", "/api/me", undefined, KIM)).status).toBe(200);
      expect((await req("POST", `/api/admin/safety/${kimHold.id}`, { action: "suspend", note: "Repeated" }, OWNER)).status).toBe(200);
      const refused = await req("GET", "/api/me", undefined, KIM);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toMatch(/suspended/);
      const after = (await req("GET", "/api/admin/safety", undefined, OWNER)).body;
      expect(after.open).toBe(0);
      expect(after.items.map((i: { status: string; decidedBy: string }) => [i.status, i.decidedBy]).sort()).toEqual([["released", "Owner"], ["suspended", "Owner"]]);
    });
  });
}

describe("CSV cells", () => {
  it("neutralizes spreadsheet formulas and quotes separators", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(null)).toBe("");
  });
});
