/** Step N5b: start constraints ("start: no earlier than") and finish dates ("finish: by", the due date). */
import { describe, expect, it } from "vitest";
import { allTasks, applyOp, explainStart, exportPlan, levelPlan, parseOp, parsePlan, schedulePlan, type Plan } from "../src";

const FILE = `---\nrakuplan: 1\ntitle: Move\nstart: 2027-03-01\n---\n## P1: Work\n- [ ] T1: Pack (2d) @Jo\n- [ ] T2: Paint (1d) @Ana start: no earlier than 2027-03-10\n- [ ] T3: Clean (1d) @Ana depends: T1 finish: by 2027-03-02\n  start: 2027-03-04`;
const plan = () => parsePlan(FILE).plan as Plan;
const task = (p: Plan, id: string) => allTasks(p).find((t) => t.id === id)!;

describe("date constraints", () => {
  it("reads start and finish in their forms and round trips", () => {
    const p = plan();
    expect(task(p, "T2")).toMatchObject({ title: "Paint", notBefore: "2027-03-10" });
    expect(task(p, "T3")).toMatchObject({ title: "Clean", due: "2027-03-02", notBefore: "2027-03-04" });
    const again = parsePlan(exportPlan(p)).plan as Plan;
    expect(allTasks(again).map((t) => [t.notBefore ?? null, t.due ?? null])).toEqual([[null, null], ["2027-03-10", null], ["2027-03-04", "2027-03-02"]]);
    expect(exportPlan(p)).toContain("start: no earlier than 2027-03-10");
    // Ordinary words in titles stay titles; unreadable dates warn.
    const words = parsePlan(`---\nrakuplan: 1\ntitle: W\n---\n## P1: A\n- [ ] T1: Plan the start and finish of the race\n- [ ] T2: Go start: someday`);
    expect(task(words.plan as Plan, "T1").title).toBe("Plan the start and finish of the race");
    expect(words.issues.some((i) => i.message.includes("isn't a start date"))).toBe(true);
  });
  it("holds a task back in the schedule, with or without people", () => {
    const p = plan();
    const s = schedulePlan(p, { today: "2027-03-01" });
    expect(s.tasks.get("T2")!.start).toBe("2027-03-10");
    expect(s.tasks.get("T3")!.start).toBe("2027-03-04"); // T1 ends Mar 2, but the constraint is later
    const l = levelPlan(p, { today: "2027-03-01" });
    expect(l.tasks.get("T2")!.start).toBe("2027-03-10");
    expect(explainStart(l, "T2", p)).toBe("Starts Mar 10 because it can't start before then.");
    // A constraint on a weekend: the next working day.
    const wk = parsePlan(FILE.replace("2027-03-10", "2027-03-13")).plan as Plan;
    expect(levelPlan(wk, { today: "2027-03-01" }).tasks.get("T2")!.start).toBe("2027-03-15");
    expect(explainStart(levelPlan(wk, { today: "2027-03-01" }), "T2", wk)).toBe("Starts Mar 15 because it can't start before Mar 13.");
  });
  it("is an ordinary edit, and clearing it lets the task start sooner", () => {
    const p = plan();
    const op = parseOp({ kind: "setField", taskId: "T2", field: "notBefore", value: null });
    expect(op).not.toBeNull();
    const state = { plan: p, trash: {}, restoredForReview: [] as string[] };
    applyOp(state, op!, { userId: "u1", name: "Kim" }, "2027-03-01");
    const next = state.plan;
    expect(task(next, "T2").notBefore).toBeUndefined();
    expect(schedulePlan(next, { today: "2027-03-01" }).tasks.get("T2")!.start).toBe("2027-03-01");
    expect(parseOp({ kind: "setField", taskId: "T2", field: "notBefore", value: "soon" })).toBeNull();
  });
});
