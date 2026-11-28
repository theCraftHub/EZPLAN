import { describe, expect, it } from "vitest";
import { allTasks, budgetOf, exportPlan, money, parseAvailability, parseCost, parsePlan, type Plan } from "../src";

const FILE = `---\nrakuplan: 1\ntitle: Kitchen\ncurrency: USD\n---\n## P1: Build\n- [x] T1: Cabinets (2d) @Jo cost: 1200/1350\n- [ ] T2: Paint (1d) @Ana\n- [ ] T3: Lights (4h) cost: 300\n## P2: Finish\n- [ ] T4: Clean (1d) @Ana cost: /80`;
const plan = () => parsePlan(FILE).plan as Plan;

describe("costs", () => {
  it("reads planned/actual in common shapes, and refuses nonsense", () => {
    expect(parseCost("1200/950")).toEqual({ planned: 1200, actual: 950 });
    expect(parseCost("$1,200.50 / 950")).toEqual({ planned: 1200.5, actual: 950 });
    expect(parseCost("300")).toEqual({ planned: 300 });
    expect(parseCost("/80")).toEqual({ actual: 80 });
    expect(parseCost("lots")).toBeNull();
    expect(parseCost("1/2/3")).toBeNull();
    expect(parseCost("-5")).toBeNull();
  });
  it("round trips through the file", () => {
    const again = parsePlan(exportPlan(plan())).plan as Plan;
    expect(allTasks(again).map((t) => t.cost ?? null)).toEqual([{ planned: 1200, actual: 1350 }, null, { planned: 300 }, { actual: 80 }]);
    expect(again.currency).toBe("USD");
  });
  it("planned from rate × estimate, actual from rate × logged hours where not set; forecast and over budget", () => {
    const b = budgetOf(plan(), { rates: { Ana: 50 }, time: [{ taskId: "T2", minutes: 600 }, { taskId: "T4", minutes: 60 }], workWeek: { hoursPerWeek: 40, workdays: [1, 2, 3, 4, 5] } });
    expect(b.tasks.get("T2")).toMatchObject({ planned: 400, plannedFrom: "rate", actual: 500, actualFrom: "rate", loggedHours: 10, estimateHours: 8 });
    expect(b.tasks.get("T4")).toMatchObject({ planned: 400, actual: 80, actualFrom: "set" });
    expect(b.planned).toBe(1200 + 400 + 300 + 400);
    expect(b.actual).toBe(1350 + 500 + 80);
    // Finished: what it cost. Open: the larger of planned and spent.
    expect(b.forecast).toBe(1350 + 500 + 300 + 400);
    expect(b.overBy).toBe(b.forecast - b.planned);
    expect(b.byPhase.map((p) => [p.title, p.planned])).toEqual([["Build", 1900], ["Finish", 400]]);
    expect(money(1234.5, "USD", "en-US")).toBe("$1,234.50");
    expect(money(1200, "XYZ", "en-US")).toMatch(/^XYZ\s1,200$/);
  });
  it("hourly rate is part of a person's availability", () => {
    expect(parseAvailability({ hoursPerWeek: 20, rate: 62.5 })).toEqual({ hoursPerWeek: 20, rate: 62.5 });
    expect(parseAvailability({ rate: -1 })).toBeNull();
  });
});

describe("budget in the status report", () => {
  it("adds a Budget section only when the plan has money, and the AI check knows its numbers", async () => {
    const { schedulePlan, progressOf, statusFacts, templateReport, onlyKnownNumbers, formatCost } = await import("../src");
    expect(formatCost({ planned: 1200 })).toBe("1200");
    expect(formatCost({ actual: 80 })).toBe("/80");
    expect(formatCost(undefined)).toBe("");
    const p = plan();
    const schedule = schedulePlan(p, { today: "2027-01-04" });
    const facts = statusFacts(p, schedule, progressOf(p, schedule, { today: "2027-01-04" }), { today: "2027-01-04", rates: { Ana: 50 } });
    expect(facts.budget).toMatchObject({ currency: "USD", planned: 1500 + 800, actual: 1430 });
    const text = templateReport(facts);
    const section = text.sections.find((s) => s.title === "Budget")!;
    expect(section.text).toContain("$1,430 spent of $2,300 planned");
    expect(onlyKnownNumbers(text, facts)).toBe(true);
    const bare = parsePlan(`---\nrakuplan: 1\ntitle: X\n---\n## P1: A\n- [ ] T1: Y (1d)`).plan as Plan;
    const s2 = schedulePlan(bare, { today: "2027-01-04" });
    expect(templateReport(statusFacts(bare, s2, progressOf(bare, s2, { today: "2027-01-04" }), { today: "2027-01-04" })).sections.some((s) => s.title === "Budget")).toBe(false);
  });
});
