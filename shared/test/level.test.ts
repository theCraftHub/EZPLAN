import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTasks, availableHours, Calendar, checkPlan, explainStart, levelPlan, parsePlan, schedulePlan } from "../src";

const plan = (body: string, start = "2026-11-16") => parsePlan(`---\nezplan: 1\ntitle: T\nstart: ${start}\n---\n## P1: Work\n${body}`).plan;
const signage = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "assistants", "claude-existing-chat-signage.txt"), "utf8")).plan;

describe("person-aware scheduling", () => {
  it("one person's independent tasks run one after another, not side by side", () => {
    const p = plan("- [ ] T1: A (2d) @Alex\n- [ ] T2: B (3d) @Alex\n- [ ] T3: C (1d) @Sam");
    expect(schedulePlan(p).finish).toBe("2026-11-18"); // unlimited people: 3 days
    const s = levelPlan(p);
    expect(s.finish).toBe("2026-11-20"); // Alex: 2d + 3d = 5 working days
    // T2 is longer, so it decides the finish and goes first; T1 follows.
    expect(s.tasks.get("T2")!.start).toBe("2026-11-16");
    expect(s.tasks.get("T1")!.start).toBe("2026-11-19");
    expect(s.tasks.get("T3")!.start).toBe("2026-11-16"); // Sam isn't held up
    expect(explainStart(s, "T1", p)).toBe('Starts Nov 19 because Alex is on T2 "B" until then.');
  });

  it("part-time availability stretches the work", () => {
    const p = plan("- [ ] T1: A (5d) @Alex");
    expect(levelPlan(p).finish).toBe("2026-11-20");
    expect(levelPlan(p, { people: { alex: { hoursPerWeek: 10 } } }).finish).toBe("2026-12-11"); // 40h at 2h/day = 20 workdays
  });

  it("time off and calendar-busy hours are skipped, and the reason is given", () => {
    const p = plan("- [ ] T1: A (1d) @Alex\n- [ ] T2: B (1d) @Alex depends: T1");
    const s = levelPlan(p, { people: { Alex: { timeOff: [{ start: "2026-11-17", end: "2026-11-18", label: "Vacation" }] } } });
    expect(s.tasks.get("T2")!.start).toBe("2026-11-19");
    expect(explainStart(s, "T2", p)).toBe("Starts Nov 19 because Alex is off Nov 17 to Nov 18 (Vacation).");
    const busy = levelPlan(plan("- [ ] T1: A (1d) @Alex"), { people: { Alex: { busy: { "2026-11-16": 6 } } } });
    expect(busy.finish).toBe("2026-11-17"); // 2h free Monday, 6h Tuesday
    expect(busy.bookings.get("Alex")!.get("2026-11-16")).toEqual([{ taskId: "T1", hours: 2 }]);
  });

  it("dependencies still hold; waiting tasks and milestones use nobody's hours", () => {
    const p = plan("- [ ] T1: Order cabinets (1d) @Alex\n- [ ] T2: Delivery lead time (2w) #wait @Alex depends: T1\n- [ ] T3: Plan the party (3d) @Alex\n- [ ] T4: Install (2d) @Alex depends: T2\n- [ ] M1: Done depends: T4");
    const s = levelPlan(p);
    // Alex plans the party while the cabinets are on their way.
    expect(s.tasks.get("T3")!.start).toBe("2026-11-17");
    expect(s.tasks.get("T4")!.start).toBe("2026-12-01");
    expect(s.finish).toBe("2026-12-02");
    expect(s.criticalPath).toEqual(["T1", "T2", "T4", "M1"]);
    expect([...s.bookings.get("Alex")!.values()].flat().some((b) => b.taskId === "T2")).toBe(false);
  });

  it("the most urgent ready task goes first (finish-date-deciding, then due date, then priority)", () => {
    const p = plan("- [ ] T1: Side job (1d) @Alex\n- [ ] T2: Urgent (1d) @Alex !high\n- [ ] T3: Chain start (1d) @Alex\n- [ ] T4: Chain end (5d) @Sam depends: T3");
    const s = levelPlan(p);
    expect(s.tasks.get("T3")!.start).toBe("2026-11-16"); // T4 waits on it, so it decides the finish
    expect(s.finish).toBe("2026-11-23");
  });

  it("finished work takes no time, and people with no availability set are listed", () => {
    const s = levelPlan(signage, { people: { Alex: { hoursPerWeek: 40 } } });
    expect(s.assumedFullTime).toEqual([]);
    expect(levelPlan(signage).assumedFullTime).toEqual(["Alex"]);
    // The unleveled schedule said Dec 3 while Alex's work alone runs to about Dec 18.
    expect(schedulePlan(signage).finish).toBe("2026-12-03");
    expect(s.finish >= "2026-12-18").toBe(true);
    const tenHours = levelPlan(signage, { people: { Alex: { hoursPerWeek: 10 } } });
    expect(tenHours.finish > "2027-03-01").toBe(true);
    // Hours booked never exceed what Alex has.
    for (const day of tenHours.bookings.get("Alex")!.values()) expect(day.reduce((n, b) => n + b.hours, 0)).toBeLessThanOrEqual(2 + 1e-9);
  });

  it("an owner with no hours at all is reported, not looped forever", () => {
    const s = levelPlan(plan("- [ ] T1: A (1d) @Alex"), { people: { Alex: { hoursPerWeek: 0 } } });
    expect(s.unplaceable).toEqual(["T1"]);
    expect(s.reasons.get("T1")).toEqual({ kind: "no-hours", person: "Alex" });
  });

  it("availableHours respects workdays, part time, time off and busy hours", () => {
    const cal = new Calendar();
    const a = { hoursPerWeek: 20, workdays: [1, 3, 5], timeOff: [{ start: "2026-11-20", end: "2026-11-20" }], busy: { "2026-11-18": 4 } };
    expect(availableHours(a, "2026-11-16", cal)).toBeCloseTo(20 / 3);
    expect(availableHours(a, "2026-11-17", cal)).toBe(0); // Tuesday: not a workday for them
    expect(availableHours(a, "2026-11-18", cal)).toBe(4);
    expect(availableHours(a, "2026-11-20", cal)).toBe(0);
    expect(availableHours(undefined, "2026-11-21", cal)).toBe(0); // Saturday
  });

  it("matches the plain schedule when nobody is double-booked", () => {
    const p = plan("- [ ] T1: A (2d) @Ana\n- [ ] T2: B (3d) @Ben depends: T1\n- [ ] T3: C (4h) @Cy\n- [ ] T4: D (1d) @Cy depends: T3\n- [ ] M1: Done depends: T2, T4");
    const a = schedulePlan(p);
    const b = levelPlan(p);
    for (const t of allTasks(p)) {
      expect(b.tasks.get(t.id)!.start).toBe(a.tasks.get(t.id)!.start);
      expect(b.tasks.get(t.id)!.end).toBe(a.tasks.get(t.id)!.end);
    }
    expect(b.criticalPath).toEqual(["T1", "T2", "M1"]);
  });

  it("Plan Check uses real availability instead of guessing at overload", () => {
    const codes = (o: Parameters<typeof checkPlan>[1]) => checkPlan(signage, { today: "2026-11-16", ...o }).findings.map((f) => f.code).sort();
    expect(codes({})).toContain("overloaded"); // plain schedule: the guess
    expect(codes({ level: true })).toEqual(["assumed-availability", "no-estimate"]);
    expect(codes({ people: { alex: { hoursPerWeek: 10 } } })).toEqual(["no-estimate"]);
    expect(codes({ people: { alex: { hoursPerWeek: 0 } } })).toContain("no-hours");
  });
});
