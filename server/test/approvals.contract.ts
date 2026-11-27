/** Step M2: approvals. Only the named approver (even as a commenter) or a manager approves; the right people hear about it. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const OWEN = "u-owen|Owen Boss|owen@appr.test"; // plan maker (manager)
const PAT = "u-pat2|Pat Lee|pat@appr.test"; // approver, commenter
const KAI = "u-kai|Kai Ward|kai@appr.test"; // does the work, editor
const RAY = "u-ray|Ray Fox|ray@appr.test"; // another editor
const VI = "u-vi|Vi Viewer|vi@appr.test";
const PLAN = `---\nrakuplan: 1\ntitle: Signs\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: Draft the sign (1d) @Kai approver: Pat\n- [ ] T2: Print it (1d) @Kai approver: Pat\n- [ ] T3: Hang it (1d) @Kai`;

export function approvalsContract(hostName: string, factory: HostFactory) {
  describe(`Approvals: ${hostName}`, () => {
    let host: TestHost;
    let id = "";
    let n = 0;
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const op = (o: Record<string, unknown>, user: string) => req("POST", `/api/plans/${id}/ops`, { opId: `o${++n}`, clientId: "t", op: o }, user);
    const task = async (tid: string) => ((await req("GET", `/api/plans/${id}`, undefined, OWEN)).body.plan.phases[0].tasks as { id: string; status: string; approved?: { by: string } }[]).find((t) => t.id === tid)!;
    const latest = async (user: string) => (await req("GET", "/api/notifications", undefined, user)).body.items[0]?.text as string | undefined;

    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      id = (await req("POST", "/api/plans", { text: PLAN }, OWEN)).body.id;
      for (const [who, email, role, personName] of [[PAT, "pat@appr.test", "commenter", "Pat"], [KAI, "kai@appr.test", "editor", "Kai"], [RAY, "ray@appr.test", "editor", undefined], [VI, "vi@appr.test", "viewer", undefined]] as const) {
        const link = (await req("POST", `/api/plans/${id}/invites`, { email, role, ...(personName ? { personName } : {}) }, OWEN)).body.link;
        await req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, who);
      }
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("done work waits for its approver, who hears about it", async () => {
      expect((await op({ kind: "setStatus", taskId: "T1", status: "done" }, KAI)).status).toBe(200);
      expect(await latest(PAT)).toBe("Draft the sign is done and waiting for your approval (Signs)");
      const plans = (await req("GET", "/api/plans", undefined, OWEN)).body.plans;
      expect(plans[0].summary.health).not.toBe("Complete");
    });

    it("only the approver or a manager approves; the approver may be a commenter; viewers can't", async () => {
      expect((await op({ kind: "approve", taskId: "T1", decision: "approve" }, RAY)).body.error).toBe("Only Pat or a manager can approve this.");
      expect((await op({ kind: "approve", taskId: "T1", decision: "approve" }, VI)).status).toBe(403);
      expect((await op({ kind: "setStatus", taskId: "T2", status: "done" }, PAT)).status).toBe(403); // commenters still can't change work
      expect((await op({ kind: "approve", taskId: "T1", decision: "approve" }, PAT)).status).toBe(200);
      expect((await task("T1")).approved?.by).toBe("Pat Lee");
      expect(await latest(KAI)).toBe("Pat Lee approved Draft the sign");
    });

    it("a manager can send work back with a note; it reopens and the owner is told", async () => {
      await op({ kind: "setStatus", taskId: "T2", status: "done" }, KAI);
      expect((await op({ kind: "approve", taskId: "T2", decision: "reject", note: "Wrong colour" }, OWEN)).status).toBe(200);
      expect(await task("T2")).toMatchObject({ status: "progress" });
      expect(await latest(KAI)).toBe("Owen Boss sent Print it back: Wrong colour");
      const activity = (await req("GET", `/api/plans/${id}/activity`, undefined, OWEN)).body.items.map((i: { summary: string }) => i.summary);
      expect(activity).toContain("Owen Boss sent Print it back: Wrong colour");
      expect(activity).toContain("Pat Lee approved Draft the sign");
    });
  });
}
