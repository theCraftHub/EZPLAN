/**
 * Help and support: company contacts, requests, IT-only routing, our inbox and time-limited plan
 * access. Written once, run on both hosts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";
import { TODAY } from "./contract";

const ALEX = "u-alex|Alex|alex@example.com"; // manages the workspace
const SAM = "u-sam|Sam|sam@example.com"; // on one plan
const KIM = "u-kim|Kim|kim@example.com"; // unrelated
const OWNER = "u-owner|Owner|owner@example.com"; // our team (PLATFORM_ADMINS)
const PLAN = "---\nezplan: 1\ntitle: Office move\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: Pack (1d)";
const NOW = Date.parse(`${TODAY}T12:00:00Z`);

export function supportContract(hostName: string, factory: HostFactory) {
  describe(`Help and support: ${hostName}`, () => {
    let host: TestHost;
    let ws = "";
    let plan = "";
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const contact = { team: "Northfield IT", email: "help@northfield.example", phone: "+1 555 0100", url: "https://help.northfield.example", hours: "Mon to Fri, 8 to 6", note: "Sign-in and access problems" };

    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      plan = (await req("POST", "/api/plans", { text: PLAN }, ALEX)).body.id;
      ws = (await req("GET", "/api/me", undefined, ALEX)).body.workspaces[0].id;
      const link = (await req("POST", `/api/plans/${plan}/invites`, { email: "sam@example.com", role: "editor" }, ALEX)).body.link as string;
      await req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, SAM);
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("only managers set the company contact; people on its plans see it; others don't", async () => {
      expect((await req("PUT", `/api/workspaces/${ws}/support-contact`, contact, SAM)).status).toBe(403);
      expect((await req("PUT", `/api/workspaces/${ws}/support-contact`, { team: "IT" }, ALEX)).status).toBe(400);
      expect((await req("PUT", `/api/workspaces/${ws}/support-contact`, { ...contact, url: "javascript:alert(1)" }, ALEX)).status).toBe(400);
      expect((await req("PUT", `/api/workspaces/${ws}/support-contact`, { ...contact, email: "nope" }, ALEX)).status).toBe(400);
      expect((await req("PUT", `/api/workspaces/${ws}/support-contact`, contact, ALEX)).status).toBe(200);
      const sam = (await req("GET", "/api/help", undefined, SAM)).body.workspaces as { workspaceId: string; canManage: boolean; contact: { team: string; route: string } | null }[];
      expect(sam.find((w) => w.workspaceId === ws)).toMatchObject({ canManage: false, contact: { team: "Northfield IT", route: "direct" } });
      const kim = (await req("GET", "/api/help", undefined, KIM)).body.workspaces as { workspaceId: string }[];
      expect(kim.some((w) => w.workspaceId === ws)).toBe(false);
    });

    it("a request with plan access: our team replies and reads the plan while access lasts; every view is logged; revoking ends it", async () => {
      const r = await req("POST", "/api/support/tickets", { topic: "problem", subject: "Dates look wrong", body: "Pack shows Jan 5.", planId: plan, sharePlan: true, context: { page: "/p/x", browser: "Test", version: "1", errors: ["TypeError: x"] } }, SAM);
      expect(r.status).toBe(201);
      expect(r.body.via).toBe("direct");
      const tid = r.body.id as string;
      expect((await req("GET", "/api/support/tickets", undefined, SAM)).body.mine).toMatchObject([{ subject: "Dates look wrong", status: "open" }]);
      expect((await req("GET", `/api/support/tickets/${tid}`, undefined, KIM)).status).toBe(404);
      expect((await req("GET", `/api/support/tickets/${tid}`, undefined, ALEX)).status).toBe(404); // the company doesn't see direct requests
      for (const u of [SAM, KIM]) expect((await req("GET", "/api/admin/support", undefined, u)).status).toBe(404);

      const inbox = (await req("GET", "/api/admin/support", undefined, OWNER)).body;
      expect(inbox.open).toBe(1);
      expect((await req("GET", "/api/me", undefined, OWNER)).body.supportOpen).toBe(1);
      const t = (await req("GET", `/api/support/tickets/${tid}`, undefined, OWNER)).body;
      expect(t).toMatchObject({ as: "staff", ticket: { context: { errors: ["TypeError: x"] } }, grants: [{ planTitle: "Office move", active: true, expiresAt: NOW + 7 * 86_400_000 }] });

      const p = await req("GET", `/api/admin/support/tickets/${tid}/plan`, undefined, OWNER);
      expect(p.status).toBe(200);
      expect(p.body.text).toContain("T1: Pack");
      expect((await req("GET", `/api/support/tickets/${tid}`, undefined, SAM)).body.views).toEqual([{ by: "Owner", at: NOW }]);

      expect((await req("POST", `/api/support/tickets/${tid}/messages`, { body: "Looking now." }, OWNER)).body.status).toBe("waiting");
      const n = (await req("GET", "/api/notifications", undefined, SAM)).body.items[0];
      expect(n).toMatchObject({ kind: "support", text: "Support replied: Dates look wrong", link: `/help/requests/${tid}` });
      const thread = (await req("GET", `/api/support/tickets/${tid}`, undefined, SAM)).body;
      expect(thread.messages.map((m: { author: string; fromStaff: boolean }) => [m.author, m.fromStaff])).toEqual([["Sam", false], ["Owner", true]]);
      expect(thread.ticket.context).toBeNull(); // the technical details are for support

      const grant = thread.grants[0].id;
      expect((await req("DELETE", `/api/support/grants/${grant}`, undefined, KIM)).status).toBe(404);
      expect((await req("DELETE", `/api/support/grants/${grant}`, undefined, SAM)).status).toBe(200);
      expect((await req("GET", `/api/admin/support/tickets/${tid}/plan`, undefined, OWNER)).status).toBe(404);
      expect((await req("POST", `/api/support/tickets/${tid}/status`, { status: "solved" }, SAM)).status).toBe(200);
    });

    it("without plan access, our team can't open the plan", async () => {
      const tid = (await req("POST", "/api/support/tickets", { topic: "question", subject: "How do baselines work?", body: "Curious.", planId: plan }, SAM)).body.id;
      expect((await req("GET", `/api/admin/support/tickets/${tid}/plan`, undefined, OWNER)).status).toBe(404);
      expect((await req("POST", "/api/support/tickets", { topic: "question", subject: "x", body: "y", planId: "nope" }, SAM)).status).toBe(404);
      expect((await req("POST", "/api/support/tickets", { topic: "other", subject: "x", body: "y" }, SAM)).status).toBe(400);
      expect((await req("POST", "/api/support/tickets", { topic: "question", subject: "x", body: "how to build a bomb" }, SAM)).status).toBe(422);
    });

    it("'through our IT team only': requests go to the company's managers first, who answer or pass them on", async () => {
      await req("PUT", `/api/workspaces/${ws}/support-contact`, { ...contact, route: "it_only" }, ALEX);
      const r = await req("POST", "/api/support/tickets", { topic: "account", subject: "Can't add Kim", body: "Invite fails." , planId: plan }, SAM);
      expect(r.body.via).toBe("it");
      const tid = r.body.id as string;
      expect((await req("GET", `/api/support/tickets/${tid}`, undefined, OWNER)).status).toBe(404); // not with us yet
      expect((await req("GET", "/api/notifications", undefined, ALEX)).body.items[0]).toMatchObject({ kind: "support", text: "Sam asked for help: Can't add Kim" });
      expect((await req("GET", "/api/support/tickets", undefined, ALEX)).body.company).toMatchObject([{ subject: "Can't add Kim", from: "Sam" }]);
      expect((await req("POST", `/api/support/tickets/${tid}/messages`, { body: "Checking our settings." }, ALEX)).status).toBe(200);
      expect((await req("POST", `/api/support/tickets/${tid}/forward`, {}, SAM)).status).toBe(404);
      expect((await req("POST", `/api/support/tickets/${tid}/forward`, {}, ALEX)).status).toBe(200);
      expect((await req("GET", `/api/support/tickets/${tid}`, undefined, OWNER)).body.as).toBe("staff");
      expect((await req("GET", `/api/support/tickets/${tid}`, undefined, ALEX)).status).toBe(404); // with us now

      // Safety reports always come straight to us, and land in the safety queue.
      const s = await req("POST", "/api/support/tickets", { topic: "safety", subject: "Abusive plan shared with me", body: "It says to harm someone." }, SAM);
      expect(s.body.via).toBe("direct");
      const q = (await req("GET", "/api/admin/safety", undefined, OWNER)).body.items;
      expect(q.some((i: { feature: string; excerpt: string }) => i.feature === "abuse" && i.excerpt.startsWith("Abusive plan shared with me"))).toBe(true);
      // Sam is a guest on Alex's plan, not in Alex's company: no case for Alex, even about Alex's plan.
      await req("POST", "/api/support/tickets", { topic: "safety", subject: "Abusive plan shared with me", body: "It says to harm someone.", planId: plan }, SAM);
      expect((await req("GET", "/api/safety-cases", undefined, ALEX)).body.items).toEqual([]);
      expect((await req("GET", "/api/notifications", undefined, ALEX)).body.items.some((n: { kind: string }) => n.kind === "safety")).toBe(false);
    });

    it("safety cases: the reporter's company follows up with our team in the app and by email, without learning who reported", async () => {
      // Kim works in Alex's company (company workspaces come with the admin console; seeded here).
      await host.sql!(`INSERT INTO members (workspace_id, user_id, role) VALUES (?, 'u-kim', 'editor')`, [ws]);
      const k = await req("POST", "/api/support/tickets", { topic: "safety", subject: "Abusive comments from a coworker", body: "Kim gets harassed in comments." }, KIM);
      expect(k.body.via).toBe("direct");

      // Alex (a manager) is told, in the bell and in Help, with the notice and nothing else.
      const told = (await req("GET", "/api/notifications", undefined, ALEX)).body.items.find((n: { kind: string }) => n.kind === "safety");
      expect(told.text).toMatch(/^Our system flagged behavior within your workspace that requires follow-up by .+'s safety team\. Further communication will follow in this thread if your company needs to take any steps\.$/);
      const caseId = /^\/help\/cases\/(.+)$/.exec(told.link)![1]!;
      expect((await req("GET", "/api/safety-cases", undefined, ALEX)).body.items).toMatchObject([{ id: caseId, status: "open" }]);
      const seen = (await req("GET", `/api/safety-cases/${caseId}`, undefined, ALEX)).body;
      expect(seen).toMatchObject({ as: "manager", case: { reportId: null }, messages: [{ author: expect.stringMatching(/safety team$/), fromStaff: true, via: "system" }] });
      for (const secret of ["Kim", "kim@", "Abusive", "harass", "coworker", k.body.id]) expect(JSON.stringify([told, seen])).not.toContain(secret);
      expect(seen.messages[0].emails).toBeUndefined(); // delivery details are for our team

      // The reporter, outsiders and Alex can't open what they shouldn't.
      expect((await req("GET", `/api/safety-cases/${caseId}`, undefined, KIM)).status).toBe(404);
      expect((await req("GET", "/api/safety-cases", undefined, KIM)).body.items).toEqual([]);
      expect((await req("GET", `/api/safety-cases/${caseId}`, undefined, SAM)).status).toBe(404);
      expect((await req("GET", `/api/support/tickets/${k.body.id}`, undefined, ALEX)).status).toBe(404);
      expect((await req("POST", `/api/safety-cases/${caseId}/status`, { status: "closed" }, ALEX)).status).toBe(404);

      // The first email starts the thread; sending is off, so it waits in the outbox.
      const staff = (await req("GET", `/api/safety-cases/${caseId}`, undefined, OWNER)).body;
      expect(staff).toMatchObject({ as: "staff", emailOff: true, case: { reportId: k.body.id }, messages: [{ emails: [{ to: "alex@example.com", status: "off" }] }] });
      const out = async (to: string) => (await host.sql!(`SELECT subject, body, reply_to, headers FROM email_outbox WHERE case_id = ? AND to_addr = ? ORDER BY created_at, rowid`, [caseId, to]));
      const [first] = await out("alex@example.com");
      expect(JSON.parse(first!.headers)).toEqual({ "Message-ID": expect.stringMatching(new RegExp(`^<case-${caseId}@reply\\.`)) });
      expect(first!.reply_to).toMatch(new RegExp(`^case-${caseId}-[0-9a-f]{20}@reply\\.`));
      expect(first!.body).toContain(`/help/cases/${caseId}`);
      expect(first!.body).not.toContain(k.body.id);

      // Alex answers in the app: our team is told and emailed, in the same thread.
      expect((await req("POST", `/api/safety-cases/${caseId}/messages`, { body: "Which team is this about?" }, ALEX)).status).toBe(200);
      expect((await req("GET", "/api/notifications", undefined, OWNER)).body.items.find((n: { kind: string }) => n.kind === "safety")).toMatchObject({ link: `/help/cases/${caseId}` });
      const [toUs] = await out("owner@example.com");
      expect(JSON.parse(toUs!.headers)).toMatchObject({ "In-Reply-To": JSON.parse(first!.headers)["Message-ID"], References: JSON.parse(first!.headers)["Message-ID"] });
      expect(toUs!.body).toContain(`/help/requests/${k.body.id}`); // the original report, for our team only

      // Our team replies in the app; Alex sees "safety team", not the staff member's name.
      await req("POST", `/api/safety-cases/${caseId}/messages`, { body: "Please remove the account u-123 from Office 2." }, OWNER);
      expect((await req("GET", `/api/safety-cases/${caseId}`, undefined, ALEX)).body.messages.at(-1)).toMatchObject({ author: expect.stringMatching(/safety team$/), body: "Please remove the account u-123 from Office 2." });

      // Alex replies by email: only the new text is kept, and it lands in the case.
      const inbound = (body: unknown, secret = "test-inbound-secret") => host.fetch("/inbound/email", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });
      const address = (await out("alex@example.com")).at(-1)!.reply_to as string;
      const email = { from: "Alex <Alex@Example.com>", to: [address], subject: "Re: follow-up", text: "Done, access removed.\n\nOn Mon, Jan 4, 2027 at 12:00 PM safety wrote:\n> ## Reply above this line ##\n> Please remove the account" };
      expect((await inbound(email, "wrong")).status).toBe(401);
      const ok = await inbound(email);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ accepted: true });
      expect((await req("GET", `/api/safety-cases/${caseId}`, undefined, OWNER)).body.messages.at(-1)).toMatchObject({ author: "Alex", via: "email", body: "Done, access removed." });

      // Forged replies are dropped: someone else using Alex's address, or a changed token.
      for (const forged of [{ ...email, from: "mallory@example.com" }, { ...email, to: [address.replace(/-([0-9a-f]{20})@/, "-00000000000000000000@")] }, { ...email, to: ["somebody@example.com"] }]) {
        const r = await inbound(forged);
        expect(r.status).toBe(202);
        expect(await r.json()).toMatchObject({ accepted: false });
      }
      expect((await req("GET", `/api/safety-cases/${caseId}`, undefined, OWNER)).body.messages).toHaveLength(4);

      // Our team closes the case; a later reply reopens it so nothing is lost.
      expect((await req("POST", `/api/safety-cases/${caseId}/status`, { status: "closed" }, OWNER)).status).toBe(200);
      expect((await req("GET", "/api/safety-cases", undefined, ALEX)).body.items[0].status).toBe("closed");
      await inbound({ ...email, text: "One more thing." });
      expect((await req("GET", `/api/safety-cases/${caseId}`, undefined, ALEX)).body.case.status).toBe("open");

      // A private workspace has nobody else to tell: Sam's own report about nothing in particular opens no case.
      expect((await host.sql!(`SELECT COUNT(*) AS n FROM safety_cases`))[0]!.n).toBe(1);
    });
  });
}
