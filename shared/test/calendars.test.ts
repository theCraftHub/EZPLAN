import { describe, expect, it } from "vitest";
import { busyFromIcs, holidayDates, holidaysFor, levelPlan, parsePlan, writeIcs, type Plan } from "../src";

describe("public holidays", () => {
  it("US: rules, Thanksgiving, and weekend holidays observed on a weekday", () => {
    const us = holidaysFor("US", 2027);
    expect(us.find((h) => h.name === "Thanksgiving")!.date).toBe("2027-11-25");
    expect(us.find((h) => h.name === "Memorial Day")!.date).toBe("2027-05-31");
    expect(us.find((h) => h.name.startsWith("Independence Day"))).toEqual({ date: "2027-07-05", name: "Independence Day (observed)" }); // July 4 2027 is a Sunday
    expect(us.find((h) => h.name.startsWith("Christmas"))!.date).toBe("2027-12-24"); // Saturday → Friday
  });
  it("Easter-based holidays and the UK's Christmas swap", () => {
    expect(holidaysFor("GB", 2027).filter((h) => /Easter Monday|Good Friday/.test(h.name)).map((h) => h.date)).toEqual(["2027-03-26", "2027-03-29"]);
    expect(holidaysFor("GB", 2027).filter((h) => /Christmas|Boxing/.test(h.name)).map((h) => h.date)).toEqual(["2027-12-27", "2027-12-28"]); // Sat + Sun
    expect(holidaysFor("DE", 2028).find((h) => h.name === "Christi Himmelfahrt")!.date).toBe("2028-05-25");
    expect(holidayDates("XX", 2027, 2027)).toEqual([]);
  });
  it("the scheduler skips them", () => {
    const plan = parsePlan("---\nrakuplan: 1\ntitle: X\nstart: 2027-11-24\n---\n## P1: W\n- [ ] T1: Two days (2d) @A").plan as Plan;
    const without = levelPlan(plan, { today: "2027-11-24" }).tasks.get("T1")!;
    const withUs = levelPlan(plan, { today: "2027-11-24", workWeek: { hoursPerWeek: 40, workdays: [1, 2, 3, 4, 5], holidays: holidayDates("US", 2027, 2027) } }).tasks.get("T1")!;
    expect([without.start, without.end]).toEqual(["2027-11-24", "2027-11-25"]);
    expect([withUs.start, withUs.end]).toEqual(["2027-11-24", "2027-11-26"]);
  });
});

describe("calendar files", () => {
  it("writes all-day events with stable IDs, escaping and folding", () => {
    const text = writeIcs("Plan; one", [{ uid: "p1-T1@x", title: "Order tiles, grout", start: "2027-01-04", end: "2027-01-05", description: "Plan: Kitchen\nOwner: Kim" }, { uid: "p1-M1@x", title: "A".repeat(100), start: "2027-01-08", end: "2027-01-08", done: true }], new Date("2027-01-01T00:00:00Z"), "Test//Calendar");
    expect(text).toContain("UID:p1-T1@x\r\n");
    expect(text).toContain("DTSTART;VALUE=DATE:20270104\r\nDTEND;VALUE=DATE:20270106");
    expect(text).toContain("SUMMARY:Order tiles\\, grout");
    expect(text).toContain(String.raw`X-WR-CALNAME:Plan\; one`);
    expect(text.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("reads busy hours only: timed, all-day, repeating with exceptions; skips free and cancelled", () => {
    const ics = ["BEGIN:VCALENDAR",
      "BEGIN:VEVENT", "SUMMARY:Secret meeting", "DTSTART:20270104T090000", "DTEND:20270104T113000", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20270105", "DTEND;VALUE=DATE:20270106", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART;TZID=Europe/London:20270104T140000", "DTEND;TZID=Europe/London:20270104T150000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4", "EXDATE;TZID=Europe/London:20270106T140000", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART:20270107T100000Z", "DTEND:20270107T110000Z", "TRANSP:TRANSPARENT", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART:20270107T100000Z", "DTEND:20270107T120000Z", "STATUS:CANCELLED", "END:VEVENT",
      "END:VCALENDAR"].join("\r\n");
    expect(busyFromIcs(ics, "2027-01-04", "2027-01-15")).toEqual({ "2027-01-04": 3.5, "2027-01-05": 24, "2027-01-11": 1, "2027-01-13": 1 });
    expect(JSON.stringify(busyFromIcs(ics, "2027-01-04", "2027-01-15"))).not.toContain("Secret");
  });
});
