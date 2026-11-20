import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { availableHours, Calendar, checkPlan, estimateToDays, exportPlan, hoursPerDay, levelPlan, parsePlan, schedulePlan, workloadByWeek } from "../src";

const plan = (body: string, header = "") => parsePlan(`---\nezplan: 1\ntitle: T\nstart: 2026-11-16\n${header}---\n## P1: Work\n${body}`).plan;
const kitchen = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "assistants", "copilot-renovation-v2.txt"), "utf8")).plan;

describe("workspace standard work week (full time)", () => {
  it("a day is the week's hours over its working days", () => {
    expect(hoursPerDay()).toBe(8);
    expect(hoursPerDay({ hoursPerWeek: 37.5 })).toBe(7.5);
    expect(hoursPerDay({ hoursPerWeek: 36, workdays: [1, 2, 3, 4] })).toBe(9);
    expect(estimateToDays({ amount: 15, unit: "h" }, 7.5)).toBe(2);
    expect(estimateToDays({ amount: 1, unit: "w" }, 9, 4)).toBe(4);
  });

  it("hour estimates take longer in a shorter workspace day; day estimates stay days", () => {
    const p = plan("- [ ] T1: A (30h) @Alex\n- [ ] T2: B (2d) @Alex depends: T1");
    expect(schedulePlan(p).tasks.get("T1")!.end).toBe("2026-11-19"); // 30h / 8 = 3.75 days
    const short = schedulePlan(p, { workWeek: { hoursPerWeek: 30 } }); // 6 h days
    expect(short.tasks.get("T1")!.end).toBe("2026-11-20"); // 30h / 6 = 5 days
    expect(short.tasks.get("T2")!.end).toBe("2026-11-24");
  });

  it("a four-day week skips the fifth day", () => {
    const p = plan("- [ ] T1: A (1w) @Alex");
    const s = schedulePlan(p, { workWeek: { hoursPerWeek: 36, workdays: [1, 2, 3, 4] } });
    expect([s.tasks.get("T1")!.start, s.tasks.get("T1")!.end]).toEqual(["2026-11-16", "2026-11-19"]);
  });

  it("people with no availability set work the workspace's full time", () => {
    const cal = new Calendar();
    expect(availableHours(undefined, "2026-11-16", cal, 7.5)).toBe(7.5);
    const p = plan("- [ ] T1: A (15h) @Alex\n- [ ] T2: B (15h) @Alex");
    const s = levelPlan(p, { workWeek: { hoursPerWeek: 37.5 } });
    expect(s.finish).toBe("2026-11-19"); // 30 h at 7.5 h a day = 4 days
    expect(s.fullTimeHours).toBe(37.5);
    const tip = checkPlan(p, { level: true, workWeek: { hoursPerWeek: 37.5 } }).findings.find((f) => f.code === "assumed-availability")!;
    expect(tip.message).toMatch(/full time on this project \(37\.5 h a week\)/);
  });

  it("someone working more than the standard day isn't capped at it, and meetings come out of their day", () => {
    const cal = new Calendar();
    expect(availableHours({ hoursPerWeek: 50 }, "2026-11-16", cal, 8)).toBe(10);
    expect(availableHours({ hoursPerWeek: 50, busy: { "2026-11-16": 3 } }, "2026-11-16", cal, 8)).toBe(7);
    expect(availableHours({ hoursPerWeek: 20, busy: { "2026-11-16": 3 } }, "2026-11-16", cal, 8)).toBe(4);
  });

  it("workload hours follow the day length", () => {
    const p = plan("- [ ] T1: A (1d) @Alex");
    const w = workloadByWeek(p, schedulePlan(p, { workWeek: { hoursPerWeek: 37.5 } }), { workWeek: { hoursPerWeek: 37.5 } });
    expect(w.get("Alex")!.get("2026-11-16")).toBe(7.5);
  });

  it("the default (40 h, Mon to Fri) leaves every earlier result unchanged", () => {
    expect(levelPlan(kitchen, { workWeek: { hoursPerWeek: 40 } }).finish).toBe(levelPlan(kitchen).finish);
    expect(schedulePlan(kitchen, { workWeek: {} }).finish).toBe(schedulePlan(kitchen).finish);
  });
});

describe("plan files keep their day length (hours_per_day)", () => {
  it("is written only when the day isn't 8 hours, and read back", () => {
    const p = plan("- [ ] T1: A (2d)");
    expect(exportPlan(p)).not.toMatch(/hours_per_day/);
    expect(exportPlan(p, { hoursPerDay: 8 })).not.toMatch(/hours_per_day/);
    const out = exportPlan(p, { hoursPerDay: 7.5 });
    expect(out).toMatch(/\nhours_per_day: 7\.5\n/);
    const back = parsePlan(out).plan;
    expect(back.hoursPerDay).toBe(7.5);
    expect(exportPlan(back)).toBe(out);
  });

  it("a plan's own day length wins over the workspace's", () => {
    const p = plan("- [ ] T1: A (15h) @Alex", "hours_per_day: 7.5h\n");
    expect(p.hoursPerDay).toBe(7.5);
    expect(schedulePlan(p, { workWeek: { hoursPerWeek: 40 } }).tasks.get("T1")!.end).toBe("2026-11-17"); // 2 days of 7.5 h
  });

  it("an unreadable value is skipped with a hint", () => {
    const r = parsePlan("---\nezplan: 1\ntitle: T\nhours_per_day: lots\n---\n## P1: A\n- [ ] T1: A (1d)");
    expect(r.plan.hoursPerDay).toBeUndefined();
    expect(r.issues).toContainEqual(expect.objectContaining({ severity: "warning", message: expect.stringMatching(/working-day length/) }));
  });
});
