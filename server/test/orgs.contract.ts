/**
 * Organizations (step L1): companies, org roles and workspace access, invites with a dry run and
 * seat limits, domain verification, and the hash-chained audit log. Written once, run on both hosts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";
import { FAKE_DNS } from "./hostConfig";

const DANA = "u-dana|Dana Reyes|dana@northfield.test"; // creates the company
const IVAN = "u-ivan|Ivan Petrov|ivan@northfield.test";
const MEI = "u-mei|Mei Chen|mei@northfield.test";
const OUT = "u-out|Olga Outside|olga@contractor.test";
const EVE = "u-eve|Eve|eve@example.com";

export function orgsContract(hostName: string, factory: HostFactory) {
  describe(`Organizations: ${hostName}`, () => {
    let host: TestHost;
    let org = "", ws = "";
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const join = async (link: string, user: string) => req("POST", `/api/join/${link.split("/join/")[1]}/accept`, {}, user);

    beforeAll(async () => { host = await factory.start({ testAuth: true }); }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("creates a company with its first workspace; the creator is Owner and manages it", async () => {
      expect((await req("POST", "/api/orgs", { name: "", people: 3 }, DANA)).status).toBe(400);
      expect((await req("POST", "/api/orgs", { name: "Northfield", people: 0 }, DANA)).status).toBe(400);
      const made = await req("POST", "/api/orgs", { name: "Northfield Builders", industry: "Construction", people: 3 }, DANA);
      expect(made.status).toBe(201);
      ({ id: org, workspaceId: ws } = made.body as { id: string; workspaceId: string });
      expect((await req("GET", "/api/orgs", undefined, DANA)).body.orgs).toEqual([{ id: org, name: "Northfield Builders", role: "owner", console: true, setup: { step: "domain" } }]);
      const o = (await req("GET", `/api/orgs/${org}`, undefined, DANA)).body;
      expect(o).toMatchObject({ role: "owner", seats: { total: 3, taken: 1 }, workspaces: [{ id: ws, name: "Northfield Builders" }], can: { settings: true, seats: true, people: true, audit: true } });
      // A plan in the company workspace belongs to the company.
      const me = (await req("GET", "/api/me", undefined, DANA)).body.workspaces as { id: string }[];
      expect(me.some((w) => w.id === ws)).toBe(true);
      expect((await req("GET", `/api/orgs/${org}`, undefined, EVE)).status).toBe(404);
    });

    it("invites: dry run checks every row and changes nothing; seats and roles are enforced; links work once, for that address", async () => {
      const people = [
        { email: "ivan@northfield.test", name: "Ivan Petrov", department: "IT" },
        { email: "mei@northfield.test", name: "Mei Chen", role: "helpdesk" },
        { email: "not-an-email" },
        { email: "ivan@northfield.test" },
        { email: "omar@northfield.test" },
      ];
      const dry = await req("POST", `/api/orgs/${org}/invites`, { people, dryRun: true }, DANA);
      expect(dry.body).toMatchObject({ dryRun: true, willInvite: 2, skipped: 3 });
      expect(dry.body.rows.map((r: { ok: boolean; problem?: string }) => r.problem ?? "ok")).toEqual(["ok", "ok", "Not an email address.", "Listed twice; kept the first.", "No seats left. Add seats in Licenses, or free one."]);
      expect((await req("GET", `/api/orgs/${org}`, undefined, DANA)).body.seats.taken).toBe(1); // nothing changed

      const sent = await req("POST", `/api/orgs/${org}/invites`, { people }, DANA);
      expect(sent.status).toBe(201);
      expect(sent.body.invited.map((i: { email: string }) => i.email)).toEqual(["ivan@northfield.test", "mei@northfield.test"]);
      const [ivanLink, meiLink] = sent.body.invited.map((i: { link: string }) => i.link);
      expect((await req("GET", `/api/orgs/${org}`, undefined, DANA)).body.seats.taken).toBe(3); // open invites hold seats
      const out = await host.sql!(`SELECT to_addr, subject FROM email_outbox WHERE to_addr = 'ivan@northfield.test'`);
      expect(out[0]!.subject).toMatch(/Dana Reyes invited you to Northfield Builders/);

      expect((await join(ivanLink, MEI)).status).toBe(403); // wrong person
      expect((await req("GET", `/api/join/${ivanLink.split("/join/")[1]}`, undefined, IVAN)).body).toMatchObject({ org: "Northfield Builders", role: "Member", problem: null });
      expect((await join(ivanLink, IVAN)).body.orgId).toBe(org);
      expect((await join(meiLink, MEI)).status).toBe(200);
      // Ivan (Member) edits plans in the company workspace; Mei (Helpdesk) gets the console but no workspace.
      const plan = (await req("POST", "/api/plans", { workspaceId: ws, text: "---\nrakuplan: 1\ntitle: Office move\n---\n## P1: Work\n- [ ] T1: Pack (1d)" }, DANA)).body.id;
      expect((await req("GET", `/api/plans/${plan}`, undefined, IVAN)).body.role).toBe("editor"); // company plans reach company members
      expect((await req("GET", `/api/plans/${plan}`, undefined, MEI)).status).toBe(404); // Helpdesk doesn't see plans
      expect((await req("GET", "/api/orgs", undefined, MEI)).body.orgs[0]).toMatchObject({ role: "helpdesk", console: true });
      expect((await req("GET", "/api/orgs", undefined, IVAN)).body.orgs[0]).toMatchObject({ role: "member", console: false });
      expect((await req("GET", `/api/orgs/${org}`, undefined, IVAN)).status).toBe(404);
      expect((await req("GET", `/api/orgs/${org}`, undefined, MEI)).body.can).toMatchObject({ settings: false, seats: false, people: false, support: true, audit: false });
      expect((await req("POST", `/api/orgs/${org}/invites`, { people: [{ email: "x@northfield.test" }] }, MEI)).status).toBe(403);
      const memberIds = await host.sql!(`SELECT user_id, role FROM members WHERE workspace_id = ? ORDER BY user_id`, [ws]);
      expect(memberIds).toEqual([{ user_id: "u-dana", role: "manager" }, { user_id: "u-ivan", role: "editor" }]);
    });

    it("seats: only the Owner changes them, never below what's in use", async () => {
      expect((await req("PUT", `/api/orgs/${org}/seats`, { seats: 10 }, MEI)).status).toBe(403); // Helpdesk opens the console, but not this
      expect((await req("PUT", `/api/orgs/${org}/seats`, { seats: 2 }, DANA)).body.error).toMatch(/3 seats are in use/);
      expect((await req("PUT", `/api/orgs/${org}/seats`, { seats: 10 }, DANA)).status).toBe(200);
      expect((await req("GET", `/api/orgs/${org}`, undefined, DANA)).body.seats).toEqual({ total: 10, taken: 3 });
    });

    it("domains: the TXT record proves it; a verified domain's people can't be guests", async () => {
      const added = await req("POST", `/api/orgs/${org}/domains`, { domain: "https://www.Northfield.test/" }, DANA);
      expect(added.body).toMatchObject({ domain: "northfield.test", record: expect.stringMatching(/^rakuplan-verify=.{20,}$/) });
      const check = () => req("POST", `/api/orgs/${org}/domains/northfield.test/check`, {}, DANA);
      expect((await check()).body).toMatchObject({ verified: false, reason: expect.stringMatching(/couldn't find the record/) });
      FAKE_DNS["northfield.test"] = ["rakuplan-verify=someone-elses-token"];
      expect((await check()).body.reason).toMatch(/not the one for your company/);
      FAKE_DNS["northfield.test"] = ["v=spf1 -all", added.body.record];
      expect((await check()).body).toEqual({ verified: true });
      expect((await req("POST", `/api/orgs/${org}/invites`, { people: [{ email: "pat@northfield.test", role: "guest" }], dryRun: true }, DANA)).body.rows[0].problem).toMatch(/add them as members, not guests/);
      expect((await req("POST", `/api/orgs/${org}/invites`, { people: [{ email: "olga@contractor.test", role: "guest" }], dryRun: true }, DANA)).body.rows[0].ok).toBe(true);
      expect((await req("POST", `/api/orgs/${org}/domains`, { domain: "northfield.test" }, MEI)).status).toBe(403);
      void OUT;
    });

    it("audit log: every step, readable by Owner and Auditor only, CSV, and an edited row is caught", async () => {
      const log = (await req("GET", `/api/orgs/${org}/audit`, undefined, DANA)).body;
      expect(log.intact).toBe(true);
      expect(log.items.map((i: { action: string }) => i.action).reverse()).toEqual(["org.created", "people.invited", "person.joined", "person.joined", "seats.changed", "domain.added", "domain.verified"]);
      expect((await req("GET", `/api/orgs/${org}/audit?q=ivan`, undefined, DANA)).body.items.map((i: { action: string }) => i.action)).toEqual(["person.joined", "people.invited"]);
      expect((await req("GET", `/api/orgs/${org}/audit`, undefined, MEI)).status).toBe(403);
      const csv = await host.fetch(`/api/orgs/${org}/audit?format=csv`, {}, DANA);
      expect(await csv.text()).toMatch(/^Seq,Time \(UTC\),Who,Action,Target,Detail\r\n"7",/);
      await host.sql!(`UPDATE audit_log SET target = 'nobody' WHERE org_id = ? AND seq = 3`, [org]);
      expect((await req("GET", `/api/orgs/${org}/audit`, undefined, DANA)).body).toMatchObject({ intact: false, brokenAt: 3 });
    });
  });
}
