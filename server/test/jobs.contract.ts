/** Step N2: scheduled jobs. Digests at each person's hour in their time zone, once; status reminders; weekly summaries for followers. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";
import { TODAY } from "./contract";

const DAN = "u-dan|Dan Hale|dan@jobs.test";
const BO = "u-bo2|Bo|bo@jobs.test";
const PLAN = `---\nrakuplan: 1\ntitle: Fitout\nstart: 2026-12-28\n---\n## P1: Work\n- [ ] T1: Old task (1d) @Dan due: 2026-12-29\n- [ ] T2: Long job (5d) @Bo\n- [ ] T3: Today's task (1d) @Dan depends: T2\n- [ ] T4: Next task (1d) @Dan depends: T3\n- [ ] M1: Handover (milestone) depends: T4\n- [x] T5: Snag list (1d) @Bo approver: Dan done: 2027-01-02 by Bo`;
const at = (hhmm: string, day = TODAY) => Date.parse(`${day}T${hhmm}:00Z`);

export function jobsContract(hostName: string, factory: HostFactory) {
  describe(`Scheduled jobs: ${hostName}`, () => {
    let host: TestHost;
    let id = "";
    const req = async (method: string, path: string, body?: unknown, user = DAN) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const run = (when: number) => req("POST", "/api/test/run-jobs", { at: when });
    const notes = async (user = DAN) => (await req("GET", "/api/notifications", undefined, user)).body.items as { kind: string; text: string }[];
    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      id = (await req("POST", "/api/plans", { text: PLAN })).body.id;
      await req("PUT", "/api/me/prefs/digest", { value: { mode: "daily", hour: 8, tz: "America/New_York" } });
      await req("GET", "/api/me", undefined, BO);
      await req("PUT", "/api/me/prefs/digest", { value: { mode: "off" } }, BO);
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("daily digest: waits for 8:00 in the person's time zone, then once; in the app and in the email outbox", async () => {
      expect((await run(at("12:30"))).body.digests).toBe(0); // 7:30 in New York
      expect((await run(at("13:15"))).body.digests).toBe(1);
      const digest = (await notes()).find((n) => n.kind === "digest")!;
      expect(digest.text).toMatch(/^Today: /);
      expect(digest.text).toContain("1 waiting for your approval");
      expect(digest.text).toContain("1 milestone this week");
      const mail = await host.sql!(`SELECT subject, body FROM email_outbox WHERE to_addr = 'dan@jobs.test'`);
      expect(mail).toHaveLength(1);
      expect(String(mail[0]!.body)).toContain("Waiting for your approval:\n- Snag list · Fitout");
      expect(String(mail[0]!.body)).toContain("Handover");
      expect((await run(at("13:45"))).body.digests).toBe(0); // already sent today
      expect((await notes(BO)).filter((n) => n.kind === "digest")).toEqual([]); // Bo turned them off
    });

    it("weekly digest only on the chosen weekday", async () => {
      await req("PUT", "/api/me/prefs/digest", { value: { mode: "weekly", hour: 8, tz: "UTC", weekday: 2 } });
      expect((await run(at("09:00"))).body.digests).toBe(0); // Monday
      expect((await run(at("09:00", "2027-01-05"))).body.digests).toBe(1); // Tuesday
      expect((await notes())[0]!.text).toMatch(/^Your week: /);
    });

    it("status update reminders reach the plan's managers once a week when an update is overdue", async () => {
      const later = at("10:00", "2027-01-20");
      expect((await run(later)).body.statusReminders).toBe(1);
      expect((await notes())[0]).toMatchObject({ kind: "status", text: "Fitout is due a status update" });
      expect((await run(later + 3_600_000)).body.statusReminders).toBe(0);
    });

    it("weekly summary for people who follow a plan, on Mondays", async () => {
      expect((await req("GET", `/api/plans/${id}/follow`)).body.following).toBe(false);
      await req("PUT", `/api/plans/${id}/follow`, { following: true });
      expect((await run(at("10:00", "2027-01-26"))).body.weeklySummaries).toBe(0); // a Tuesday
      expect((await run(at("10:00", "2027-02-01"))).body.weeklySummaries).toBe(1); // a Monday
      expect((await notes())[0]!.text).toBe("Weekly summary of Fitout");
      const runs = (await req("GET", "/api/ops", undefined, `u-own|Owner|owner@example.com`)).body.jobs as { name: string; runs: number; lastError: string | null }[];
      expect(runs.map((r) => r.name)).toEqual(["digests", "statusReminders", "weeklySummaries"]);
      expect(runs.every((r) => r.lastError === null && r.runs > 0)).toBe(true);
    });
  });
}
