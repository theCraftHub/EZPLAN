/**
 * Sharing a plan: invites with roles, viewers, removing access, availability reaching everyone.
 * Written once, run on both hosts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@rakuplan/shared";
import type { HostFactory, TestHost } from "./contract";
import { LiveClient, type LiveOpen } from "./live.contract";
import { PUBLIC_URL } from "./signin.contract";

const ALEX = "u-alex|Alex|alex@example.com";
const SAM = "u-sam|Sam|sam@example.com";
const KIM = "u-kim|Kim|kim@example.com";
const PLAN = "---\nrakuplan: 1\ntitle: Shared kitchen\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: Measure (1d) @Alex\n- [ ] T2: Quotes (2d) @Sam depends: T1";

export function sharingContract(hostName: string, factory: HostFactory) {
  describe(`Sharing a plan: ${hostName}`, () => {
    let host: TestHost;
    let open: LiveOpen;
    let planId = "";
    const clients: LiveClient[] = [];
    const req = (method: string, path: string, body: unknown, user: string) => host.fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, user);
    const invite = async (email: string, role: string, personName?: string) => {
      const r = await req("POST", `/api/plans/${planId}/invites`, { email, role, ...(personName ? { personName } : {}) }, ALEX);
      return { status: r.status, body: (await r.json()) as { link: string; id: string; error?: string } };
    };
    const token = (link: string) => link.split("/invite/")[1]!;
    const connect = async (user: string) => {
      const c = await open(`/api/plans/${planId}/live`, { user, origin: PUBLIC_URL });
      if (!(c instanceof LiveClient)) throw new Error(`refused: ${c.status}`);
      clients.push(c);
      c.send({ t: "hello" });
      await c.next((m) => m.t === "welcome");
      return c;
    };

    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      open = host.live!;
      planId = ((await (await req("POST", "/api/plans", { text: PLAN }, ALEX)).json()) as { id: string }).id;
    }, 60_000);
    afterAll(async () => {
      for (const c of clients) c.close();
      await host?.stop();
    });

    it("invites someone as an editor: the link works once, only for that email, and shows the plan to them", async () => {
      expect((await host.fetch(`/api/plans/${planId}`, {}, SAM)).status).toBe(404);
      const { status, body } = await invite("Sam@Example.com", "editor", "Sam");
      expect(status).toBe(201);
      expect(body.link).toMatch(new RegExp(`^${PUBLIC_URL}/invite/[A-Za-z0-9_-]{30,}$`));
      // Someone else signed in can't use it, and learns only a masked address.
      const wrong = (await (await host.fetch(`/api/invites/${token(body.link)}`, {}, KIM)).json()) as { problem: string; planTitle: string | null };
      expect(wrong.problem).toMatch(/This invite is for s•+@example\.com/);
      expect(wrong.planTitle).toBeNull();
      expect((await req("POST", `/api/invites/${token(body.link)}/accept`, {}, KIM)).status).toBe(403);

      const info = (await (await host.fetch(`/api/invites/${token(body.link)}`, {}, SAM)).json()) as { planTitle: string; inviter: string; role: string; problem: null };
      expect(info).toMatchObject({ planTitle: "Shared kitchen", inviter: "Alex", role: "editor", problem: null });
      const accepted = (await (await req("POST", `/api/invites/${token(body.link)}/accept`, {}, SAM)).json()) as { planId: string };
      expect(accepted.planId).toBe(planId);
      const plan = (await (await host.fetch(`/api/plans/${planId}`, {}, SAM)).json()) as { role: string };
      expect(plan.role).toBe("editor");
      const list = (await (await host.fetch("/api/plans", {}, SAM)).json()) as { plans: { id: string; shared: boolean }[] };
      expect(list.plans.find((p) => p.id === planId)?.shared).toBe(true);
      // Sam can edit, and "Done by" is Sam.
      const op = (await (await req("POST", `/api/plans/${planId}/ops`, { opId: "s1", clientId: "s", op: { kind: "setStatus", taskId: "T2", status: "done" } }, SAM)).json()) as { applied: { actor: { name: string } } };
      expect(op.applied.actor.name).toBe("Sam");
      // Used once: it can't be used again by someone else, and isn't listed as pending.
      expect((await req("POST", `/api/invites/${token(body.link)}/accept`, {}, KIM)).status).toBe(403);
      const sharing = (await (await host.fetch(`/api/plans/${planId}/sharing`, {}, ALEX)).json()) as { members: { name: string; role: string; via: string }[]; invites: unknown[] };
      expect(sharing.members).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Sam", role: "editor", via: "invite" })]));
      expect(sharing.invites).toEqual([]);
    });

    it("refuses bad invites, duplicates, and invites from people who were only invited", async () => {
      expect((await invite("not-an-email", "editor")).status).toBe(400);
      expect((await invite("kim@example.com", "owner")).status).toBe(400);
      expect((await invite("sam@example.com", "viewer")).status).toBe(409); // already has access
      expect((await req("POST", `/api/plans/${planId}/invites`, { email: "kim@example.com", role: "viewer" }, SAM)).status).toBe(403);
      expect((await host.fetch(`/api/invites/not-a-real-token`, {}, SAM)).status).toBe(404);
      // A cancelled invite stops working.
      const { body } = await invite("kim@example.com", "viewer");
      expect((await req("DELETE", `/api/plans/${planId}/invites/${body.id}`, {}, ALEX)).status).toBe(200);
      expect((await req("POST", `/api/invites/${token(body.link)}/accept`, {}, KIM)).status).toBe(403);
    });

    it("viewers see the plan but can't change it, over the API or live", async () => {
      const { body } = await invite("kim@example.com", "viewer");
      await req("POST", `/api/invites/${token(body.link)}/accept`, {}, KIM);
      expect(((await (await host.fetch(`/api/plans/${planId}`, {}, KIM)).json()) as { role: string }).role).toBe("viewer");
      expect((await req("POST", `/api/plans/${planId}/ops`, { opId: "k1", clientId: "k", op: { kind: "setStatus", taskId: "T1", status: "done" } }, KIM)).status).toBe(403);
      expect((await req("POST", `/api/plans/${planId}/update`, { ops: [{ kind: "setPlanField", field: "goal", value: "x" }] }, KIM)).status).toBe(403);
      expect((await req("PUT", `/api/plans/${planId}/people/Kim`, { hoursPerWeek: 10 }, KIM)).status).toBe(403);
      expect((await req("POST", `/api/plans/${planId}/invites`, { email: "x@example.com", role: "viewer" }, KIM)).status).toBe(403);
      const k = await connect(KIM);
      k.send({ t: "edit", opId: "k2", clientId: "k", op: { kind: "setStatus", taskId: "T1", status: "done" } });
      expect(await k.next((m) => m.t === "ack" && m.opId === "k2")).toMatchObject({ status: "rejected", error: "You can view this plan but not change it." });
    });

    it("availability changes reach everyone with the plan open", async () => {
      const a = await connect(ALEX);
      await req("PUT", `/api/plans/${planId}/people/Sam`, { hoursPerWeek: 12 }, ALEX);
      const m = await a.next<Extract<ServerMessage, { t: "people" }>>((x) => x.t === "people");
      expect(m.people).toEqual({ Sam: { hoursPerWeek: 12 } });
    });

    it("changing a role or removing someone ends their live connection; removed people lose access at once", async () => {
      const s = await connect(SAM);
      expect((await req("PUT", `/api/plans/${planId}/members/u-sam`, { role: "viewer" }, ALEX)).status).toBe(200);
      expect(await s.closedBy).toBe(4003);
      expect(((await (await host.fetch(`/api/plans/${planId}`, {}, SAM)).json()) as { role: string }).role).toBe("viewer");
      const again = await connect(SAM);
      expect((await req("DELETE", `/api/plans/${planId}/members/u-sam`, {}, ALEX)).status).toBe(200);
      expect(await again.closedBy).toBe(4003);
      expect((await host.fetch(`/api/plans/${planId}`, {}, SAM)).status).toBe(404);
      expect(await open(`/api/plans/${planId}/live`, { user: SAM, origin: PUBLIC_URL })).toEqual({ status: 404 });
      // Workspace members can't be removed here (that's the workspace's people list).
      expect((await req("DELETE", `/api/plans/${planId}/members/u-alex`, {}, ALEX)).status).toBe(404);
    });
  });
}
