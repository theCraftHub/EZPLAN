/** Step N5d: "Try a change" on one plan. */
import { describe, expect, it } from "vitest";
import { allTasks, parsePlan, tryWhatIf, withWhatIf, type Plan } from "../src";

const plan = parsePlan(`---\nrakuplan: 1\ntitle: Launch\nstart: 2027-03-01\n---\n## P1: Work\n- [ ] T1: Write copy (2d) @Ana\n- [ ] T2: Build page (3d) @Jo depends: T1\n- [ ] T3: Photos (8h) @Ana\n- [ ] M1: Live (milestone) depends: T2, T3`).plan as Plan;
const opts = { today: "2027-03-01", people: { Jo: { hoursPerWeek: 40 } } };

describe("try a change", () => {
  it("a task taking longer moves the finish and the milestones after it", () => {
    const r = tryWhatIf(plan, opts, { kind: "longer", taskId: "T1", days: 2 });
    expect(r).toMatchObject({ finishBefore: "2027-03-05", finishAfter: "2027-03-09", finishDays: 2, milestones: [{ id: "M1", title: "Live", before: "2027-03-05", after: "2027-03-09" }], summary: "Write copy takes 2 more working days" });
    expect(r.tasksMoved).toBe(3); // Write copy, Build page, and Photos (Ana does it after Write copy)
    // Hours are turned into days: Photos 8h + 1 day = 2 days.
    expect(allTasks(withWhatIf(plan, opts, { kind: "longer", taskId: "T3", days: 1 }).plan).find((t) => t.id === "T3")!.estimate).toEqual({ amount: 2, unit: "d" });
    // The plan itself is untouched.
    expect(allTasks(plan).find((t) => t.id === "T1")!.estimate).toEqual({ amount: 2, unit: "d" });
  });
  it("someone's hours, or time away, change dates the same way the Team page would", () => {
    const half = tryWhatIf(plan, opts, { kind: "hours", person: "jo", hours: 20 });
    expect(half.finishAfter > half.finishBefore).toBe(true);
    expect(withWhatIf(plan, opts, { kind: "hours", person: "jo", hours: 20 }).people).toEqual({ Jo: { hoursPerWeek: 20 } });
    const away = tryWhatIf(plan, opts, { kind: "away", person: "Ana", from: "2027-03-01", days: 3 });
    expect(away).toMatchObject({ finishDays: 3, summary: "Ana is away 3 working days from 2027-03-01" });
    const none = tryWhatIf(plan, opts, { kind: "away", person: "Ana", from: "2027-04-01", days: 3 });
    expect([none.finishDays, none.milestones, none.tasksMoved]).toEqual([0, [], 0]);
  });
});
