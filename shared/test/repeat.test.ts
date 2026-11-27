import { describe, expect, it } from "vitest";
import { allTasks, applyOp, exportPlan, formatRepeat, nextDate, parsePlan, parseRepeat, repeatLabel, type Actor, type Plan } from "../src";

describe("repeat rules", () => {
  it("reads the common ways of saying it", () => {
    expect(parseRepeat("Weekly")).toEqual({ unit: "week", every: 1 });
    expect(parseRepeat("every 2 weeks")).toEqual({ unit: "week", every: 2 });
    expect(parseRepeat("every 3 days")).toEqual({ unit: "day", every: 3 });
    expect(parseRepeat("every weekday")).toEqual({ unit: "weekday", every: 1 });
    expect(parseRepeat("quarterly")).toEqual({ unit: "month", every: 3 });
    expect(parseRepeat("every 2 years")).toEqual({ unit: "month", every: 24 });
    expect(parseRepeat("sometimes")).toBeNull();
    expect(parseRepeat("every 0 days")).toBeNull();
    expect(formatRepeat(parseRepeat("every 1 week")!)).toBe("weekly");
    expect(repeatLabel("every 2 weeks")).toBe("Every 2 weeks");
    expect(repeatLabel("weekdays")).toBe("Every weekday");
  });

  it("next dates: weeks, month ends, leap years, weekdays", () => {
    expect(nextDate("2027-01-04", { unit: "week", every: 2 })).toBe("2027-01-18");
    expect(nextDate("2027-01-31", { unit: "month", every: 1 })).toBe("2027-02-28");
    expect(nextDate("2028-01-31", { unit: "month", every: 1 })).toBe("2028-02-29");
    expect(nextDate("2028-02-29", { unit: "month", every: 12 })).toBe("2029-02-28");
    expect(nextDate("2027-01-08", { unit: "weekday", every: 1 })).toBe("2027-01-11"); // Friday → Monday
    expect(nextDate("2027-12-30", { unit: "day", every: 3 })).toBe("2028-01-02");
  });
});

describe("repeating tasks", () => {
  const FILE = `---\nrakuplan: 1\ntitle: Office\n---\n## P1: Routine\n- [ ] T1: Weekly check-in (1h) @Ana due: 2027-01-04 repeat: weekly approver: Bo\n- [ ] T2: Order paper (1h) repeat: every 2 weeks`;
  const kai: Actor = { userId: "k", name: "Kai" };

  it("round trips the repeat attribute and warns about ones it can't read", () => {
    const p = parsePlan(FILE).plan as Plan;
    expect(allTasks(p).map((t) => t.repeat)).toEqual(["weekly", "every 2 weeks"]);
    expect(allTasks(parsePlan(exportPlan(p)).plan as Plan).map((t) => t.repeat)).toEqual(["weekly", "every 2 weeks"]);
    expect(parsePlan(FILE.replace("repeat: weekly", "repeat: now and then")).issues.some((i) => i.message.includes("repeat"))).toBe(true);
  });

  it("finishing one adds the next right after it, due one interval on; the finished one stops repeating", () => {
    const state = { plan: parsePlan(FILE).plan as Plan, trash: { T3: { phaseId: "P1", task: {} as never, deletedAt: "2027-01-01", by: "Kai" } }, restoredForReview: [] as string[] };
    applyOp(state, { kind: "setStatus", taskId: "T1", status: "done" }, kai, "2027-01-05");
    const tasks = allTasks(state.plan);
    expect(tasks.map((t) => [t.id, t.status, t.repeat ?? null, t.due ?? null])).toEqual([
      ["T1", "done", null, "2027-01-04"],
      ["T4", "todo", "weekly", "2027-01-11"], // T3 is in the trash, so the new one is T4
      ["T2", "todo", "every 2 weeks", null],
    ]);
    expect(tasks[1]).toMatchObject({ title: "Weekly check-in", owner: "Ana", approver: "Bo", estimate: { amount: 1, unit: "h" } });
    // Without a due date, the next one is due an interval after the day it was finished; skipping moves on too.
    applyOp(state, { kind: "setStatus", taskId: "T2", status: "skipped" }, kai, "2027-01-05");
    expect(allTasks(state.plan).at(-1)).toMatchObject({ id: "T5", due: "2027-01-19", repeat: "every 2 weeks" });
    // Marking it done again (or back to To do and done) doesn't add more.
    applyOp(state, { kind: "setStatus", taskId: "T1", status: "done" }, kai, "2027-01-06");
    expect(allTasks(state.plan)).toHaveLength(4);
  });
});
