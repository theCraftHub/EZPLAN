/** Step N3: calendar downloads and private feeds; busy times from your own calendar; public holidays. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";
import { FAKE_ICS } from "./hostConfig";

const LIA = "u-lia|Lia Chen|lia@cal.test";
const PLAN = `---\nrakuplan: 1\ntitle: Porch, front\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: Frame (2d) @Lia\n- [ ] T2: Deck (1d) @Ray depends: T1\n- [ ] M1: Porch done (milestone) depends: T2`;
const BUSY = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Dentist", "DTSTART;VALUE=DATE:20270104", "DTEND;VALUE=DATE:20270106", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

export function calendarsContract(hostName: string, factory: HostFactory) {
  describe(`Calendars: ${hostName}`, () => {
    let host: TestHost;
    let id = "";
    const req = async (method: string, path: string, body?: unknown, user: string | undefined = LIA) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      const text = await r.text();
      let json: Record<string, any> = {};
      try { json = JSON.parse(text); } catch { /* a calendar file */ }
      return { status: r.status, headers: r.headers, text, body: json };
    };
    const t1 = async () => ((await req("GET", `/api/plans/${id}`)).body.plan, (await req("GET", "/api/plans")).body.plans[0].summary.finish as string);
    beforeAll(async () => { host = await factory.start({ testAuth: true }); id = (await req("POST", "/api/plans", { text: PLAN })).body.id; }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("a plan as a calendar file: every task and milestone, stable IDs", async () => {
      const f = await req("GET", `/api/plans/${id}/calendar.ics`);
      expect(f.headers.get("content-type")).toContain("text/calendar");
      expect(f.headers.get("content-disposition")).toContain(".ics");
      expect(f.text).toContain(`UID:${id}-T1@`);
      expect(f.text).toContain("SUMMARY:◆ Porch done");
      expect(f.text).toContain("X-WR-CALNAME:Porch\\, front");
      expect((await req("GET", `/api/plans/${id}/calendar.ics`)).text.match(/UID:.*/g)).toEqual(f.text.match(/UID:.*/g));
    });

    it("a private live feed of my tasks and milestones, opened without signing in; a new link stops the old one", async () => {
      expect((await req("GET", "/api/me/calendar-feed")).body).toEqual({ active: false, createdAt: null });
      const url = (await req("POST", "/api/me/calendar-feed")).body.url as string;
      const path = new URL(url).pathname;
      const feed = await req("GET", path, undefined, undefined);
      expect(feed.status).toBe(200);
      expect(feed.text).toContain("SUMMARY:Frame");
      expect(feed.text).not.toContain("SUMMARY:Deck"); // Ray's task
      expect(feed.text).toContain("Porch done");
      const again = (await req("POST", "/api/me/calendar-feed")).body.url as string;
      expect((await req("GET", path, undefined, undefined)).status).toBe(404);
      expect((await req("GET", new URL(again).pathname, undefined, undefined)).status).toBe(200);
      await req("DELETE", "/api/me/calendar-feed");
      expect((await req("GET", new URL(again).pathname, undefined, undefined)).status).toBe(404);
    });

    it("busy times: only known calendar services; busy days push my work later; only hours are kept", async () => {
      const before = await t1();
      expect((await req("PUT", "/api/me/calendar-busy", { url: "http://calendar.google.com/x.ics" })).status).toBe(400);
      expect((await req("PUT", "/api/me/calendar-busy", { url: "https://169.254.169.254/latest" })).body.error).toMatch(/isn't a calendar service we can read/);
      expect((await req("PUT", "/api/me/calendar-busy", { url: "https://calendar.google.com/calendar/ical/missing/basic.ics" })).body.error).toMatch(/didn't work/);
      FAKE_ICS["/calendar/ical/lia/private-abc/basic.ics"] = BUSY;
      const ok = await req("PUT", "/api/me/calendar-busy", { url: "webcal://calendar.google.com/calendar/ical/lia/private-abc/basic.ics" });
      expect(ok.body).toMatchObject({ connected: true, host: "calendar.google.com", days: 2 });
      const status = (await req("GET", "/api/me/calendar-busy")).body;
      expect(status.next).toEqual([{ date: "2027-01-04", hours: 24 }, { date: "2027-01-05", hours: 24 }]);
      expect(JSON.stringify(await host.sql!(`SELECT * FROM calendar_sources`))).not.toContain("Dentist");
      const after = await t1();
      expect(after > before).toBe(true); // Lia is busy for two days, so the porch finishes later
      await req("DELETE", "/api/me/calendar-busy");
      expect(await t1()).toBe(before);
    });

    it("public holidays by country are days off for the whole workspace", async () => {
      const ws = (await req("GET", "/api/me")).body.workspaces[0].id as string;
      expect((await req("PUT", `/api/workspaces/${ws}/work-week`, { hoursPerWeek: 40, workdays: [1, 2, 3, 4, 5], holidayCountry: "XX" })).status).toBe(400);
      const p = (await req("POST", "/api/plans", { text: "---\nrakuplan: 1\ntitle: Holiday week\nstart: 2027-11-24\n---\n## P1: W\n- [ ] T1: Two days (2d) @Lia" })).body.id;
      const finish = async () => ((await req("GET", "/api/plans")).body.plans as { id: string; summary: { finish: string } }[]).find((x) => x.id === p)!.summary.finish;
      expect(await finish()).toBe("2027-11-25");
      const saved = await req("PUT", `/api/workspaces/${ws}/work-week`, { hoursPerWeek: 40, workdays: [1, 2, 3, 4, 5], holidayCountry: "US" });
      expect(saved.body.workWeek.holidayCountry).toBe("US");
      expect(await finish()).toBe("2027-11-26"); // Thanksgiving is off
      expect((await req("GET", `/api/plans/${p}`)).body.workWeek.holidays).toContain("2027-11-25");
    });
  });
}
