/**
 * Offboarding (step L3b): the preview, then access ending, signing out, plans and open tasks handed
 * over, invites turned off; orphaned plans given a new owner; the rules preview.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const OLU = "u-olu|Olu Owner|olu@elm.test";
const MAX = "u-max|Max Stone|max@elm.test";
const ZOE = "u-zoe|Zoe Lane|zoe@elm.test";
const KIT = "u-kit|Kit Ray|kit@elm.test";
const GUS = "u-gus4|Gus Out|gus@out.test";
const plan = (title: string) => `---\nrakuplan: 1\ntitle: ${title}\n---\n## P1: Work\n- [ ] T1: Survey (1d) @Max\n- [x] T2: Order (1d) @\"Max Stone\"\n- [ ] T3: Build (2d) @Zoe`;

export function offboardContract(hostName: string, factory: HostFactory) {
  describe(`Offboarding: ${hostName}`, () => {
    let host: TestHost;
    let org = "", ws = "", a = "", b = "", inviteLink = "";
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const owners = async (id: string) => ((await req("GET", `/api/plans/${id}`, undefined, OLU)).body.plan.phases[0].tasks as { id: string; owner?: string }[]).map((t) => `${t.id}:${t.owner}`);

    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      ({ id: org, workspaceId: ws } = (await req("POST", "/api/orgs", { name: "Elm Co", people: 6 }, OLU)).body as { id: string; workspaceId: string });
      await req("PUT", `/api/orgs/${org}/settings`, { preset: "open" }, OLU);
      const sent = (await req("POST", `/api/orgs/${org}/invites`, { people: [{ email: "max@elm.test" }, { email: "zoe@elm.test" }, { email: "kit@elm.test" }] }, OLU)).body.invited as { email: string; link: string }[];
      for (const [who, i] of [[MAX, 0], [ZOE, 1], [KIT, 2]] as const) await req("POST", `/api/join/${sent[i]!.link.split("/join/")[1]}/accept`, {}, who);
      a = (await req("POST", "/api/plans", { workspaceId: ws, text: plan("Dock A") }, MAX)).body.id;
      b = (await req("POST", "/api/plans", { workspaceId: ws, text: plan("Dock B") }, OLU)).body.id;
      inviteLink = (await req("POST", `/api/plans/${a}/invites`, { email: "gus@out.test", role: "viewer" }, MAX)).body.link;
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("previews what offboarding will do, and refuses what isn't allowed", async () => {
      const dry = (await req("POST", `/api/orgs/${org}/offboard/u-max`, { dryRun: true }, OLU)).body;
      expect(dry.plans).toEqual([{ id: a, title: "Dock A" }]);
      expect(dry.tasks).toEqual([{ planId: a, title: "Dock A", count: 1 }, { planId: b, title: "Dock B", count: 1 }]);
      expect(dry.invites).toBe(1);
      expect(dry.recipients.map((r: { name: string }) => r.name)).toEqual(["Kit Ray", "Olu Owner", "Zoe Lane"]);
      expect((await req("POST", `/api/orgs/${org}/offboard/u-max`, {}, OLU)).body.error).toBe("Choose who takes over their work.");
      expect((await req("POST", `/api/orgs/${org}/offboard/u-max`, { dryRun: true }, ZOE)).status).toBe(404);
      expect((await req("POST", `/api/orgs/${org}/offboard/u-olu`, { dryRun: true }, OLU)).body.error).toMatch(/That's you/);
      expect((await req("GET", `/api/plans/${a}`, undefined, MAX)).status).toBe(200); // nothing changed
    });

    it("offboards: access ends, plans and open tasks move (per plan if chosen), invites stop, people are told", async () => {
      const done = await req("POST", `/api/orgs/${org}/offboard/u-max`, { transferTo: "u-zoe", planOwners: { [b]: "u-kit" } }, OLU);
      expect(done.body.done).toBe(true);
      expect((await req("GET", `/api/plans/${a}`, undefined, MAX)).status).toBe(404);
      expect(await owners(a)).toEqual(["T1:Zoe", "T2:Max Stone", "T3:Zoe"]); // written as the plan names Zoe; done work keeps its name
      expect(await owners(b)).toEqual(["T1:Kit Ray", "T2:Max Stone", "T3:Zoe"]); // Kit isn't in plan B yet: full name
      expect(await host.sql!(`SELECT created_by FROM plans WHERE id = ?`, [a])).toEqual([{ created_by: "u-zoe" }]);
      expect((await req("POST", `/api/invites/${inviteLink.split("/invite/")[1]}/accept`, {}, GUS)).status).toBe(403);
      expect((await req("GET", "/api/notifications", undefined, ZOE)).body.items[0].text).toBe("You now have 1 plan and 1 open task from Max Stone");
      expect((await req("GET", "/api/notifications", undefined, KIT)).body.items[0].text).toBe("You now have 1 open task from Max Stone");
      const log = (await req("GET", `/api/orgs/${org}/audit?action=person.offboarded`, undefined, OLU)).body;
      expect(log.items[0]).toMatchObject({ target: "max@elm.test", detail: { plans: 1, tasks: 2, invites: 1 } });
      expect(log.actions).toContain("person.offboarded");
      expect((await req("GET", `/api/orgs/${org}/people`, undefined, OLU)).body.people.find((p: { name: string }) => p.name === "Max Stone").status).toBe("deactivated");
    });

    it("orphaned plans: listed when their maker is gone, until someone is given them", async () => {
      const c = (await req("POST", "/api/plans", { workspaceId: ws, text: plan("Dock C") }, KIT)).body.id;
      expect((await req("GET", `/api/orgs/${org}/orphans`, undefined, OLU)).body.plans).toEqual([]);
      await req("POST", `/api/orgs/${org}/people/bulk`, { action: "deactivate", ids: ["u-kit"] }, OLU);
      const orphans = (await req("GET", `/api/orgs/${org}/orphans`, undefined, OLU)).body;
      expect(orphans.plans).toEqual([{ id: c, title: "Dock C", workspace: "Elm Co", maker: "Kit Ray" }]);
      expect((await req("POST", `/api/orgs/${org}/plans/${c}/owner`, { userId: "u-kit" }, OLU)).status).toBe(400);
      expect((await req("POST", `/api/orgs/${org}/plans/${c}/owner`, { userId: "u-zoe" }, OLU)).status).toBe(200);
      expect((await req("GET", `/api/orgs/${org}/orphans`, undefined, OLU)).body.plans).toEqual([]);
    });

    it("rules preview: who can invite outsiders and download, before and after; guests with access now", async () => {
      await req("POST", `/api/invites/${(await req("POST", `/api/plans/${b}/invites`, { email: "gus@out.test", role: "viewer" }, ZOE)).body.link.split("/invite/")[1]}/accept`, {}, GUS);
      const p = (await req("GET", `/api/orgs/${org}/settings/preview?preset=strict`, undefined, OLU)).body;
      expect(p).toMatchObject({ before: { preset: "open" }, after: { preset: "strict", guestDays: 30 }, guestsNow: 1, inviters: { before: 2, after: 1 }, exporters: { before: 2, after: 1 } });
      expect((await req("GET", `/api/orgs/${org}/settings/preview?preset=wild`, undefined, OLU)).status).toBe(400);
    });
  });
}
