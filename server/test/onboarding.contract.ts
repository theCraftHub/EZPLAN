/**
 * Business onboarding (step L2): saved progress, the company's rules (Standard / Strict / Open)
 * and where they're enforced, and Go live inviting exactly the people the dry run said it would.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const HANA = "u-hana|Hana Kim|hana@harbor.test"; // Owner
const JO = "u-jo|Jo Park|jo@harbor.test"; // joins as Member
const LEE = "u-lee|Lee Admin|lee@harbor.test"; // joins as Admin
const GUS = "u-gus|Gus Guest|gus@outside.test"; // from outside the company
const EVE = "u-eve2|Eve|eve2@example.com";

const PLAN = "---\nrakuplan: 1\ntitle: Dock repair\n---\n## P1: Work\n- [ ] T1: Survey (1d)";

export function onboardingContract(hostName: string, factory: HostFactory) {
  describe(`Business onboarding and rules: ${hostName}`, () => {
    let host: TestHost;
    let org = "", ws = "", plan = "";
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const join = async (link: string, user: string) => req("POST", `/api/join/${link.split("/join/")[1]}/accept`, {}, user);
    const accept = async (link: string, user: string) => req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, user);

    beforeAll(async () => { host = await factory.start({ testAuth: true }); }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("saves progress step by step and resumes; only Owners and Admins can", async () => {
      ({ id: org, workspaceId: ws } = (await req("POST", "/api/orgs", { name: "Harbor Works", industry: "Construction", people: 4 }, HANA)).body as { id: string; workspaceId: string });
      expect((await req("PUT", `/api/orgs/${org}/onboarding`, { step: "nowhere" }, HANA)).status).toBe(400);
      expect((await req("PUT", `/api/orgs/${org}/onboarding`, { people: "x" }, HANA)).status).toBe(400);
      const people = [
        { email: "jo@harbor.test", name: "Jo Park", department: "Yard", extra: "dropped" },
        { email: "lee@harbor.test", name: "Lee Admin", role: "admin" },
        { email: "broken" },
        { email: "gus@outside.test", role: "superuser" },
      ];
      const saved = await req("PUT", `/api/orgs/${org}/onboarding`, { step: "rules", email: "hana@harbor.test", people }, HANA);
      expect(saved.body.onboarding).toEqual({ step: "rules", email: "hana@harbor.test", people: [{ email: "jo@harbor.test", name: "Jo Park", department: "Yard" }, { email: "lee@harbor.test", name: "Lee Admin", role: "admin" }, { email: "broken" }, { email: "gus@outside.test" }] });
      expect((await req("GET", `/api/orgs/${org}`, undefined, HANA)).body.onboarding.step).toBe("rules");
      expect((await req("GET", "/api/orgs", undefined, HANA)).body.orgs[0].setup).toEqual({ step: "rules" });
      expect((await req("PUT", `/api/orgs/${org}/onboarding`, { step: "live" }, EVE)).status).toBe(404);
      // A first plan must be one of the company's.
      const personal = (await req("POST", "/api/plans", { text: PLAN }, EVE)).body.id;
      expect((await req("PUT", `/api/orgs/${org}/onboarding`, { firstPlanId: personal }, HANA)).status).toBe(400);
      plan = (await req("POST", "/api/plans", { workspaceId: ws, text: PLAN }, HANA)).body.id;
      expect((await req("PUT", `/api/orgs/${org}/onboarding`, { firstPlanId: plan, step: "live" }, HANA)).body.onboarding).toMatchObject({ firstPlanId: plan, step: "live" });
    });

    it("rules: Standard until picked; a preset is saved and logged", async () => {
      expect((await req("GET", `/api/orgs/${org}`, undefined, HANA)).body.rules).toEqual({ preset: "standard", outsideInvites: "managers", exports: "everyone", guestDays: 90 });
      expect((await req("PUT", `/api/orgs/${org}/settings`, { preset: "lax" }, HANA)).status).toBe(400);
      expect((await req("PUT", `/api/orgs/${org}/settings`, { preset: "strict" }, HANA)).body.rules).toEqual({ preset: "strict", outsideInvites: "admins", exports: "admins", guestDays: 30 });
      const log = (await req("GET", `/api/orgs/${org}/audit`, undefined, HANA)).body.items;
      expect(log[0]).toMatchObject({ action: "rules.changed", detail: { from: "standard", to: "strict" } });
    });

    it("Go live: the dry run lists who gets invited; going live invites exactly them and finishes setup", async () => {
      const dry = (await req("POST", `/api/orgs/${org}/golive`, { dryRun: true }, HANA)).body;
      expect(dry.willInvite.map((r: { email: string }) => r.email)).toEqual(["jo@harbor.test", "lee@harbor.test", "gus@outside.test"]);
      expect(dry.skipped).toEqual([expect.objectContaining({ email: "broken", problem: "Not an email address." })]);
      expect((await req("GET", `/api/orgs/${org}`, undefined, HANA)).body.seats.taken).toBe(1); // dry run changed nothing
      const live = await req("POST", `/api/orgs/${org}/golive`, {}, HANA);
      expect(live.status).toBe(201);
      expect(live.body.invited.map((r: { email: string }) => r.email)).toEqual(dry.willInvite.map((r: { email: string }) => r.email));
      expect((await req("GET", "/api/orgs", undefined, HANA)).body.orgs[0].setup).toBeNull();
      expect((await req("GET", `/api/orgs/${org}`, undefined, HANA)).body.onboarding).toMatchObject({ done: true, step: "live" });
      const links = Object.fromEntries(live.body.invited.map((r: { email: string; link: string }) => [r.email, r.link]));
      expect((await join(links["jo@harbor.test"], JO)).status).toBe(200);
      expect((await join(links["lee@harbor.test"], LEE)).status).toBe(200);
      const actions = (await req("GET", `/api/orgs/${org}/audit`, undefined, HANA)).body.items.map((i: { action: string }) => i.action);
      expect(actions.slice(2, 4)).toEqual(["org.live", "people.invited"]);
    });

    it("Strict: only Owners and Admins invite outsiders or download plan files; guests' access ends after 30 days", async () => {
      // Jo (Member, editor in the workspace) may invite a colleague but not an outsider.
      expect((await req("POST", `/api/plans/${plan}/invites`, { email: "gus@outside.test", role: "viewer" }, JO)).body.error).toMatch(/only lets Owners and Admins invite people from outside/);
      const inside = await req("POST", `/api/plans/${plan}/invites`, { email: "newhire@harbor.test", role: "viewer" }, JO);
      expect(inside.status).toBe(403); // harbor.test isn't verified, so a new address there still counts as outside
      expect((await req("GET", `/api/plans/${plan}/export`, undefined, JO)).body.error).toMatch(/only lets Owners and Admins download plan files/);
      expect((await host.fetch(`/api/plans/${plan}/export`, {}, LEE)).status).toBe(200);
      const inv = await req("POST", `/api/plans/${plan}/invites`, { email: "gus@outside.test", role: "viewer" }, LEE);
      expect(inv.status).toBe(201);
      expect((await accept(inv.body.link, GUS)).status).toBe(200);
      const row = (await host.sql!(`SELECT added_at, expires_at FROM plan_members WHERE plan_id = ? AND user_id = 'u-gus'`, [plan]))[0]!;
      expect(Number(row.expires_at) - Number(row.added_at)).toBe(30 * 86_400_000);
      expect((await req("GET", `/api/plans/${plan}`, undefined, GUS)).status).toBe(200);
      await host.sql!(`UPDATE plan_members SET expires_at = 1 WHERE plan_id = ? AND user_id = 'u-gus'`, [plan]);
      expect((await req("GET", `/api/plans/${plan}`, undefined, GUS)).status).toBe(404);
      expect((await req("GET", "/api/plans", undefined, GUS)).body.plans).toEqual([]);
      const exported = (await req("GET", `/api/orgs/${org}/audit?action=plan.exported`, undefined, HANA)).body.items;
      expect(exported).toEqual([expect.objectContaining({ actor: "Lee Admin", target: "Dock repair" })]);
    });

    it("Open: anyone who can share invites outsiders, and their access doesn't end; Standard lets managers", async () => {
      await req("PUT", `/api/orgs/${org}/settings`, { preset: "open" }, HANA);
      const inv = await req("POST", `/api/plans/${plan}/invites`, { email: "olga@outside.test", role: "viewer" }, JO);
      expect(inv.status).toBe(201);
      expect((await req("GET", `/api/plans/${plan}/export`, undefined, JO)).status).not.toBe(403);
      await req("PUT", `/api/orgs/${org}/settings`, { preset: "standard" }, HANA);
      expect((await req("POST", `/api/plans/${plan}/invites`, { email: "max@outside.test", role: "viewer" }, JO)).body.error).toMatch(/only lets managers invite/);
      expect((await req("POST", `/api/plans/${plan}/invites`, { email: "max@outside.test", role: "viewer" }, HANA)).status).toBe(201);
      // Personal plans have no company rules.
      const mine = (await req("POST", "/api/plans", { text: PLAN }, EVE)).body.id;
      expect((await req("POST", `/api/plans/${mine}/invites`, { email: "gus@outside.test", role: "viewer" }, EVE)).status).toBe(201);
    });
  });
}
