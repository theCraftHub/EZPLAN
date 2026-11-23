import { describe, expect, it } from "vitest";
import { parsePlan, parseQuickAdd } from "../src";

const plan = parsePlan("---\nezplan: 1\ntitle: Gala\n---\n## P1: Venue\n- [ ] T1: Set budget (2d)\n- [ ] T2: Shortlist venues (1d)\n- [ ] M1: Venue picked (milestone) depends: T2").plan;
const TODAY = "2027-01-04"; // a Monday

describe("quick-add", () => {
  it("reads estimate, owner, due day, dependency, tag and priority from one line", () => {
    const r = parseQuickAdd("Book venue 3d @Ana due Fri after T1 #venue !high", plan, TODAY)!;
    expect(r.task).toMatchObject({ id: "T3", title: "Book venue", estimate: { amount: 3, unit: "d" }, owner: "Ana", due: "2027-01-08", depends: [{ id: "T1", type: "FS", lagDays: 0 }], tags: ["venue"], priority: "high", status: "todo", milestone: false });
    expect(r.understood).toEqual(["takes 3d", "owner Ana", "due 2027-01-08", "after T1", "high priority", "#venue"]);
  });

  it("understands today, tomorrow, dates and several dependencies", () => {
    expect(parseQuickAdd("Call caterer due tomorrow", plan, TODAY)!.task.due).toBe("2027-01-05");
    expect(parseQuickAdd("Call caterer due today", plan, TODAY)!.task.due).toBe(TODAY);
    expect(parseQuickAdd("Call caterer due 2027-02-01", plan, TODAY)!.task.due).toBe("2027-02-01");
    expect(parseQuickAdd("Pay deposit after T1 T2", plan, TODAY)!.task.depends.map((d) => d.id)).toEqual(["T1", "T2"]);
    expect(parseQuickAdd("Due diligence on Monday", plan, TODAY)!.task.title).toBe("Due diligence on Monday");
  });

  it("keeps words that only look like syntax in the title", () => {
    const r = parseQuickAdd("Think about after T9 party", plan, TODAY)!;
    expect(r.task.title).toBe("Think about after T9 party");
    expect(r.task.depends).toEqual([]);
  });

  it("makes milestones with M ids and no estimate", () => {
    const r = parseQuickAdd("Contract signed milestone after T2", plan, TODAY)!;
    expect(r.task).toMatchObject({ id: "M2", milestone: true, title: "Contract signed" });
    expect(r.task.estimate).toBeUndefined();
  });

  it("returns nothing for a line with no title", () => {
    expect(parseQuickAdd("   ", plan, TODAY)).toBeNull();
    expect(parseQuickAdd("@Ana 2d", plan, TODAY)).toBeNull();
  });
});
