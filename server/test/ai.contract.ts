/**
 * AI features against a scripted engine (TEST_AI), written once, run on both hosts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const ALEX = "u-alex|Alex|alex@example.com";
const SAM = "u-sam|Sam|sam@example.com";
const KIM = "u-kim|Kim|kim@example.com";
const plan = (title: string) => `---\nezplan: 1\ntitle: ${title}\nstart: 2027-01-04\n---\n## P1: Work\n- [x] T1: Measure (1d) @Alex done: 2027-01-04 by Alex\n- [ ] T2: Order cabinets (2d) @Alex depends: T1\n- [ ] M1: Ordered (milestone) depends: T2`;

function client(host: () => TestHost) {
  const req = async (method: string, path: string, body: unknown, user: string) => {
    const r = await host().fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
  };
  return {
    req,
    newPlan: async (title: string, user = ALEX) => (await req("POST", "/api/plans", { text: plan(title) }, user)).body.id as string,
    invite: async (planId: string, email: string, user: string, role = "editor") => {
      const link = (await req("POST", `/api/plans/${planId}/invites`, { email, role }, ALEX)).body.link as string;
      await req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, user);
    },
  };
}

export function aiContract(hostName: string, factory: HostFactory) {
  describe(`AI is off without an engine: ${hostName}`, () => {
    let host: TestHost;
    beforeAll(async () => { host = await factory.start({ testAuth: true }); }, 60_000);
    afterAll(async () => { await host?.stop(); });
    it("says so, and everything AI-free keeps working (the plain report)", async () => {
      const c = client(() => host);
      const id = await c.newPlan("Off");
      expect((await c.req("GET", `/api/plans/${id}/ai`, undefined, ALEX)).body.enabled).toBe(false);
      expect((await c.req("POST", `/api/plans/${id}/ai/check`, {}, ALEX)).status).toBe(503);
      const r = await c.req("POST", `/api/plans/${id}/report`, { ai: true }, ALEX);
      expect(r.body.source).toBe("template");
      expect(r.body.note).toMatch(/off on this server/);
    });
  });

  describe(`AI Plan Check, opt-outs, reports and holds: ${hostName}`, () => {
    let host: TestHost;
    const c = client(() => host);
    beforeAll(async () => { host = await factory.start({ testAuth: true, testAi: true }); }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("runs a check, saves it, and notices when the plan changes afterwards", async () => {
      const id = await c.newPlan("Kitchen");
      const r = await c.req("POST", `/api/plans/${id}/ai/check`, {}, ALEX);
      expect(r.status).toBe(200);
      expect(r.body.review.verdict).toBe("needs_work");
      expect(r.body.review.missingSteps.map((m: { title: string }) => m.title)).toContain("Apply for the building permit");
      const got = (await c.req("GET", `/api/plans/${id}/ai`, undefined, ALEX)).body;
      expect(got.review.changedSince).toBe(false);
      expect(got.usage.checks).toEqual({ used: 1, limit: 4 });
      await c.req("POST", `/api/plans/${id}/ops`, { opId: "a1", clientId: "c", op: { kind: "setStatus", taskId: "T2", status: "progress" } }, ALEX);
      expect((await c.req("GET", `/api/plans/${id}/ai`, undefined, ALEX)).body.review.changedSince).toBe(true);
    });

    it("\"don't suggest this again\" holds even when the AI rewords it, and can be undone", async () => {
      const id = await c.newPlan("Opt-outs");
      const s = await c.req("POST", `/api/plans/${id}/ai/suppressions`, { kind: "missingStep", text: "Apply for the building permit", taskIds: ["T1"] }, ALEX);
      expect(s.status).toBe(201);
      const r = (await c.req("POST", `/api/plans/${id}/ai/check`, {}, ALEX)).body;
      // The scripted AI now says "Get the building permit approved first": still hidden by the server.
      expect(r.review.missingSteps.map((m: { title: string }) => m.title)).toEqual(["Book the final inspection"]);
      expect(r.hidden).toBe(1);
      const list = (await c.req("GET", `/api/plans/${id}/ai`, undefined, ALEX)).body.suppressions;
      expect(list).toMatchObject([{ kind: "missingStep", text: "Apply for the building permit", by: "Alex" }]);
      expect((await c.req("DELETE", `/api/plans/${id}/ai/suppressions/${list[0].id}`, undefined, ALEX)).status).toBe(200);
      expect((await c.req("POST", `/api/plans/${id}/ai/check`, {}, ALEX)).body.review.missingSteps).toHaveLength(2);
      expect((await c.req("POST", `/api/plans/${id}/ai/suppressions`, { kind: "nonsense", text: "x" }, ALEX)).status).toBe(400);
    });

    it("viewers can read the AI result but not run checks or change opt-outs", async () => {
      const id = await c.newPlan("Viewers");
      await c.invite(id, "kim@example.com", KIM, "viewer");
      expect((await c.req("GET", `/api/plans/${id}/ai`, undefined, KIM)).status).toBe(200);
      expect((await c.req("POST", `/api/plans/${id}/ai/check`, {}, KIM)).status).toBe(403);
      expect((await c.req("POST", `/api/plans/${id}/ai/suppressions`, { kind: "risk", text: "x", taskIds: [] }, KIM)).status).toBe(403);
      expect((await c.req("POST", `/api/plans/${id}/ai/check`, {}, SAM)).status).toBe(404);
    });

    it("a decline is retried once on the same model; declined twice, the plan is held for review", async () => {
      // Sam, on Sam's own plans and allowance (earlier tests used Alex's small test allowance).
      const once = await c.newPlan("Retry [refuse-once]", SAM);
      expect((await c.req("POST", `/api/plans/${once}/ai/check`, {}, SAM)).status).toBe(200);

      const id = await c.newPlan("Held [refuse]", SAM);
      const r = await c.req("POST", `/api/plans/${id}/ai/check`, {}, SAM);
      expect(r.status).toBe(423);
      expect(r.body).toMatchObject({ held: true, error: expect.stringMatching(/waiting for a safety review/) });
      // Held: AI, exports and invites pause; the plan itself keeps working.
      expect((await c.req("GET", `/api/plans/${id}`, undefined, SAM)).body.state).toBe("review");
      expect((await c.req("GET", `/api/plans/${id}/ai`, undefined, SAM)).body.held).toBe(true);
      expect((await c.req("POST", `/api/plans/${id}/ai/check`, {}, SAM)).status).toBe(423);
      expect((await c.req("POST", `/api/plans/${id}/report`, { ai: true }, SAM)).status).toBe(423);
      expect((await host.fetch(`/api/plans/${id}/export`, {}, SAM)).status).toBe(423);
      expect((await c.req("POST", `/api/plans/${id}/invites`, { email: "x@example.com", role: "viewer" }, SAM)).status).toBe(423);
      expect((await c.req("POST", `/api/plans/${id}/ops`, { opId: "h1", clientId: "c", op: { kind: "setStatus", taskId: "T2", status: "progress" } }, SAM)).status).toBe(200);
      expect((await c.req("POST", `/api/plans/${id}/report`, {}, SAM)).body.source).toBe("template"); // the plain report still works
    });

    it("reports: facts first; AI wording is used only when it adds no numbers", async () => {
      const id = await c.newPlan("Report");
      const plain = (await c.req("POST", `/api/plans/${id}/report`, {}, ALEX)).body;
      expect(plain.source).toBe("template");
      expect(plain.facts.doneSince).toEqual([{ title: "Measure", by: "Alex", date: "2027-01-04" }]);
      const worded = (await c.req("POST", `/api/plans/${id}/report`, { ai: true, since: "2027-01-01" }, ALEX)).body;
      expect(worded.source).toBe("ai");
      expect(worded.text.headline).toBe(`A steady week: ${plain.facts.percent}% done.`);
      const inventive = await c.newPlan("Report [invent]");
      const back = (await c.req("POST", `/api/plans/${inventive}/report`, { ai: true }, ALEX)).body;
      expect(back.source).toBe("template");
      expect(back.note).toMatch(/added numbers that aren't in the plan/);
    });

    it("imports: the AI screen can block, and a declined screen holds the plan for review", async () => {
      const blocked = await c.req("POST", "/api/plans", { text: plan("Bad [ai-block]") }, ALEX);
      expect(blocked.status).toBe(422);
      const held = await c.req("POST", "/api/plans", { text: plan("Odd [mod-refuse]") }, ALEX);
      expect(held.status).toBe(201);
      expect(held.body.state).toBe("review");
    });
  });

  describe(`AI limits per person and per workspace: ${hostName}`, () => {
    let host: TestHost;
    const c = client(() => host);
    beforeAll(async () => { host = await factory.start({ testAuth: true, testAi: true }); }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("stops at the person's monthly allowance, then at the workspace pool", async () => {
      const id = await c.newPlan("Limits");
      for (let i = 0; i < 4; i++) expect((await c.req("POST", `/api/plans/${id}/ai/check`, {}, ALEX)).status).toBe(200);
      const fifth = await c.req("POST", `/api/plans/${id}/ai/check`, {}, ALEX);
      expect(fifth.status).toBe(429);
      expect(fifth.body.error).toMatch(/used all 4 AI checks for this month\. They reset on \d{4}-\d{2}-01/);
      const me = (await c.req("GET", "/api/me/ai", undefined, ALEX)).body;
      expect(me.workspaces[0]).toMatchObject({ checks: { used: 4, limit: 4 }, poolLeft: { checks: 2 } });
      // Sam, invited to the plan, is charged to the plan's workspace: the pool (6) runs out after 2.
      await c.invite(id, "sam@example.com", SAM);
      expect((await c.req("POST", `/api/plans/${id}/ai/check`, {}, SAM)).status).toBe(200);
      expect((await c.req("POST", `/api/plans/${id}/ai/check`, {}, SAM)).status).toBe(200);
      const out = await c.req("POST", `/api/plans/${id}/ai/check`, {}, SAM);
      expect(out.status).toBe(429);
      expect(out.body.error).toMatch(/This workspace has used all its AI checks/);
    });
  });
}
