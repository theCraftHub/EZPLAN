/**
 * Notifications: who hears about what, never about their own actions. Written once, run on both hosts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const ALEX = "u-alex|Alex|alex@example.com";
const SAM = "u-sam|Sam|sam@example.com";
const KIM = "u-kim|Kim|kim@example.com";
const ZED = "u-zed|Zed|zed@example.com";
const OWNER = "u-owner|Owner|owner@example.com";
const PLAN = (title: string) => `---\nezplan: 1\ntitle: ${title}\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: Measure (1d) @Alex\n- [ ] T2: Quotes (2d) @Sam due: 2027-01-05\n- [ ] T3: Permit (1d) @Sam due: 2027-01-01\n- [ ] T4: Paint (1d) @Sam due: 2027-02-01`;

export function notifyContract(hostName: string, factory: HostFactory) {
  describe(`Notifications: ${hostName}`, () => {
    let host: TestHost;
    let id = "";
    let ws = "";
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const inbox = async (user: string) => (await req("GET", "/api/notifications", undefined, user)).body as { unread: number; items: { id: string; kind: string; text: string; link: string; read: boolean }[]; due: { title: string; overdue: boolean }[] };
    const latest = async (user: string) => (await inbox(user)).items[0];

    beforeAll(async () => {
      host = await factory.start({ testAuth: true, testAi: true });
      id = (await req("POST", "/api/plans", { text: PLAN("Kitchen") }, ALEX)).body.id;
      ws = (await req("GET", "/api/me", undefined, ALEX)).body.workspaces[0].id;
      // Sam joins as the "Sam" named on the plan.
      const link = (await req("POST", `/api/plans/${id}/invites`, { email: "sam@example.com", role: "editor", personName: "Sam" }, ALEX)).body.link as string;
      await req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, SAM);
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("mentions and comments on your task; never your own; unread count and marking read", async () => {
      await req("POST", `/api/plans/${id}/tasks/T1/comments`, { body: "@Sam can you measure? cc @Alex" }, ALEX);
      expect(await latest(SAM)).toMatchObject({ kind: "mention", text: "Alex mentioned you on Measure (Kitchen)", link: `/p/${id}/checklist?task=T1`, read: false });
      expect((await inbox(ALEX)).items.filter((n) => n.kind === "mention")).toHaveLength(0); // own mention

      await req("POST", `/api/plans/${id}/tasks/T2/comments`, { body: "Quotes look high" }, ALEX);
      expect(await latest(SAM)).toMatchObject({ kind: "comment", text: "Alex commented on your task Quotes (Kitchen)" });
      await req("POST", `/api/plans/${id}/tasks/T2/comments`, { body: "Noted, @Sam here" }, SAM);
      expect((await inbox(SAM)).items.filter((n) => n.text.startsWith("Sam "))).toHaveLength(0);

      expect((await req("GET", "/api/me", undefined, SAM)).body.unread).toBe(2);
      const first = (await inbox(SAM)).items[1]!;
      expect((await req("POST", "/api/notifications/read", { ids: [first.id] }, ALEX)).body.unread).toBe(0); // someone else's id: no effect
      expect((await req("POST", "/api/notifications/read", { ids: [first.id] }, SAM)).body.unread).toBe(1);
      expect((await req("POST", "/api/notifications/read", { all: true }, SAM)).body.unread).toBe(0);
      expect((await req("POST", "/api/notifications/read", { ids: "x" }, SAM)).status).toBe(400);
    });

    it("assigned to you: when a task's owner becomes your name on the plan", async () => {
      await req("POST", `/api/plans/${id}/ops`, { opId: "o1", clientId: "c", op: { kind: "setField", taskId: "T1", field: "owner", value: "Sam" } }, ALEX);
      expect(await latest(SAM)).toMatchObject({ kind: "assigned", text: "Alex gave you Measure on Kitchen" });
      await req("POST", `/api/plans/${id}/ops`, { opId: "o2", clientId: "c", op: { kind: "setField", taskId: "T1", field: "owner", value: "Alex" } }, SAM);
      await req("POST", `/api/plans/${id}/ops`, { opId: "o3", clientId: "c", op: { kind: "setField", taskId: "T1", field: "owner", value: "Sam" } }, SAM);
      expect((await inbox(SAM)).items.filter((n) => n.kind === "assigned")).toHaveLength(1); // not for giving it to yourself
    });

    it("due soon and overdue are worked out on read for your own tasks", async () => {
      const due = (await inbox(SAM)).due;
      expect(due.map((d) => [d.title, d.overdue])).toEqual([["Permit", true], ["Quotes", false]]);
      expect((await inbox(ALEX)).due).toEqual([]); // Alex's name isn't linked to Alex's account on this plan
    });

    it("invited: people with an account are told, and open the invite by its id (only the invited address can accept)", async () => {
      await req("GET", "/api/me", undefined, KIM); // Kim has an account
      await req("POST", `/api/plans/${id}/invites`, { email: "kim@example.com", role: "commenter" }, ALEX);
      const n = (await latest(KIM))!;
      expect(n).toMatchObject({ kind: "invited", text: "Alex invited you to Kitchen as a Commenter" });
      const inviteId = n.link.split("/invite/id/")[1]!;
      expect((await req("GET", `/api/invites/${inviteId}?by=id`, undefined, KIM)).body).toMatchObject({ planTitle: "Kitchen", problem: null });
      expect((await req("POST", `/api/invites/${inviteId}/accept?by=id`, {}, ZED)).status).toBe(403);
      expect((await req("POST", `/api/invites/${inviteId}/accept?by=id`, {}, KIM)).body.planId).toBe(id);
      expect((await req("GET", `/api/plans/${id}`, undefined, KIM)).body.role).toBe("commenter");
      expect((await inbox(ZED)).items).toEqual([]);
    });

    it("AI credits: running low, a request reaches the manager, the answer reaches the asker", async () => {
      // The test allowance is 4 checks: the 4th passes 80%.
      for (let i = 0; i < 4; i++) expect((await req("POST", `/api/plans/${id}/ai/check`, {}, SAM)).status).toBe(200);
      const low = (await inbox(SAM)).items.filter((x) => x.kind === "ai-low");
      expect(low).toHaveLength(1);
      expect(low[0]!.text).toBe("AI checks are running low: 0 of 4 left this month. You can ask for more.");

      const r = await req("POST", `/api/workspaces/${ws}/ai/requests`, { checks: 5 }, SAM);
      expect(await latest(ALEX)).toMatchObject({ kind: "credit-request", text: "Sam asks for 5 AI checks", link: `/admin/ai/${ws}` });
      await req("POST", `/api/workspaces/${ws}/ai/requests/${r.body.id}`, { decision: "approve", checks: 2 }, ALEX); // the pool (6) has 2 left
      expect(await latest(SAM)).toMatchObject({ kind: "credit-answer", text: "Alex gave you 2 AI checks more this month" });
    });

    it("safety: the person is told when a review releases their plan", async () => {
      const held = (await req("POST", "/api/plans", { text: PLAN("Odd [refuse]") }, KIM)).body.id;
      expect((await req("POST", `/api/plans/${held}/ai/check`, {}, KIM)).status).toBe(423);
      const hold = (await req("GET", "/api/admin/safety", undefined, OWNER)).body.items.find((i: { planId: string }) => i.planId === held);
      await req("POST", `/api/admin/safety/${hold.id}`, { action: "release" }, OWNER);
      expect(await latest(KIM)).toMatchObject({ kind: "safety", text: "The safety review of Odd [refuse] is done: everything works again.", link: `/p/${held}` });
    });
  });
}
