import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTasks, estimateToDays, exportPlan, parseDepends, parseEstimate, parsePlan, Plan } from "../src";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
const task = (plan: Plan, id: string) => allTasks(plan).find((t) => t.id === id)!;

describe("strict EZPLAN format", () => {
  const { plan, issues, mode } = parsePlan(fixture("gala.ezplan"));

  it("reads the front matter", () => {
    expect(mode).toBe("strict");
    expect(plan).toMatchObject({
      id: "7f3a",
      title: "Spring Charity Gala",
      goal: "Host a 200-guest fundraising dinner raising $50k.",
      doneWhen: "Event held, $50k raised, thank-you notes sent.",
      start: "2026-12-01",
      baselineSet: "2026-12-01",
    });
    expect(plan.team).toEqual([
      { name: "Sam", email: "sam@co.com" },
      { name: "Ana", email: "ana@co.com" },
    ]);
  });

  it("reads phases, descriptions and every task", () => {
    expect(plan.phases.map((p) => [p.id, p.title])).toEqual([
      ["P1", "Venue and budget"],
      ["P2", "Sponsors and tickets"],
    ]);
    expect(plan.phases[0]!.description).toBe("Lock the basics before anything else.");
    expect(allTasks(plan).map((t) => t.id)).toEqual(["T1", "T2", "M1", "T3", "T4"]);
  });

  it("reads statuses, owners, estimates and completion attribution", () => {
    expect(task(plan, "T1")).toMatchObject({ status: "done", owner: "Sam", estimate: { amount: 2, unit: "d" }, done: { date: "2026-12-02", by: "Ana" } });
    expect(task(plan, "T2")).toMatchObject({ status: "progress", due: "2026-12-10", planned: { start: "2026-12-03", end: "2026-12-09" } });
    expect(task(plan, "T2").notes).toEqual(["Two venues hold the date; deposit due Friday."]);
    expect(task(plan, "T2").subtasks).toEqual([
      { title: "Shortlist 3 venues", status: "done" },
      { title: "Sign contract", status: "todo" },
    ]);
    expect(task(plan, "M1")).toMatchObject({ milestone: true, title: "Venue confirmed", depends: [{ id: "T2", type: "FS", lagDays: 0 }] });
    expect(task(plan, "T3")).toMatchObject({ priority: "high", tags: ["sponsors"], estimate: { amount: 2, unit: "w" } });
    expect(task(plan, "T4")).toMatchObject({ status: "skipped", skipped: { date: "2026-12-05", by: "Sam" } });
  });

  it("has no problems", () => {
    expect(issues).toEqual([]);
  });
});

describe("AI assistant formatting (fences, chatter, bold, numbered, emoji checkboxes)", () => {
  const { plan, issues, mode } = parsePlan(fixture("chatgpt-style.md"));

  it("finds the plan inside the code block and reads it strictly", () => {
    expect(mode).toBe("strict");
    expect(plan.title).toBe("Kitchen Renovation");
    expect(plan.phases.map((p) => p.id)).toEqual(["P1", "P2"]);
  });

  it("reads bold IDs with dots, word estimates and numbered items", () => {
    expect(task(plan, "T1")).toMatchObject({ title: "Measure the kitchen", estimate: { amount: 4, unit: "h" }, owner: "Sam" });
    expect(task(plan, "T2")).toMatchObject({ title: "Pick cabinets and counters", estimate: { amount: 1, unit: "w" }, depends: [{ id: "T1" }] });
    expect(task(plan, "T3")).toMatchObject({ status: "done", estimate: { amount: 2, unit: "d" } });
    expect(task(plan, "T4")).toMatchObject({ status: "done", title: "Electrical rough-in" });
    expect(task(plan, "T5")).toMatchObject({ milestone: true, title: "Inspection" });
  });

  it("reports no errors", () => {
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("tolerant mode for plain checklists", () => {
  const { plan, issues, mode } = parsePlan(fixture("plain-checklist.md"));

  it("uses the top heading as title and headings as phases", () => {
    expect(mode).toBe("tolerant");
    expect(plan.title).toBe("Website relaunch");
    expect(plan.phases.map((p) => p.title)).toEqual(["Content", "Launch"]);
  });

  it("assigns IDs and reads subtasks and bare estimates", () => {
    expect(allTasks(plan).map((t) => t.id)).toEqual(["T1", "T2", "T3", "T4"]);
    expect(task(plan, "T2").subtasks).toHaveLength(2);
    expect(task(plan, "T3")).toMatchObject({ title: "Set up redirects", estimate: { amount: 3, unit: "d" } });
    expect(issues.some((i) => /no ID/.test(i.message))).toBe(true);
    expect(issues.some((i) => /plain checklist/.test(i.message))).toBe(true);
  });
});

describe("unsafe content is neutralized", () => {
  const { plan, issues } = parsePlan(fixture("attack.ezplan"));

  it("strips HTML, script, unsafe links and hidden characters", () => {
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/<script|onerror|javascript:|​/i);
    expect(plan.title).toBe("Attack Plan");
    expect(issues.some((i) => /HTML/.test(i.message))).toBe(true);
    expect(issues.some((i) => /unsafe link/.test(i.message))).toBe(true);
    expect(issues.some((i) => /Hidden characters/.test(i.message))).toBe(true);
  });
});

describe("friendly line-numbered problems", () => {
  const { plan, issues } = parsePlan(fixture("errors.ezplan"));

  it("skips bad dates with a hint and keeps going", () => {
    expect(plan.start).toBeUndefined();
    expect(issues).toContainEqual(expect.objectContaining({ line: 4, severity: "warning" }));
    expect(issues).toContainEqual(expect.objectContaining({ line: 9 }));
    expect(issues).toContainEqual(expect.objectContaining({ line: 11 }));
    expect(allTasks(plan)).toHaveLength(3);
  });

  it("keeps unknown attributes so newer files survive", () => {
    expect(task(plan, "T3").extra).toEqual({ future_field: "some value" });
  });
});

describe("limits", () => {
  it("caps the number of tasks", () => {
    const body = Array.from({ length: 5_010 }, (_, i) => `- [ ] Task ${i}`).join("\n");
    const { plan, issues } = parsePlan(`---\nezplan: 1\ntitle: Big\n---\n## P1: All\n${body}`);
    expect(allTasks(plan)).toHaveLength(5_000);
    expect(issues.some((i) => i.severity === "error" && /Too many tasks/.test(i.message))).toBe(true);
  });

  it("never throws on junk", () => {
    for (const junk of ["", "   ", "---", "---\nezplan: 1\n---", "####", "- [", "\u0000\u0001", "x".repeat(10_000)]) {
      expect(() => parsePlan(junk)).not.toThrow();
    }
  });
});

describe("helpers", () => {
  it("parses estimates in many spellings", () => {
    expect(parseEstimate("2d")).toEqual({ amount: 2, unit: "d" });
    expect(parseEstimate("16 hrs")).toEqual({ amount: 16, unit: "h" });
    expect(parseEstimate("1.5 weeks")).toEqual({ amount: 1.5, unit: "w" });
    expect(parseEstimate("soon")).toBeUndefined();
    expect(estimateToDays({ amount: 16, unit: "h" })).toBe(2);
    expect(estimateToDays({ amount: 2, unit: "w" })).toBe(10);
  });

  it("parses dependency types and lag", () => {
    expect(parseDepends("T1, T2 SS+2d, M3 FF -1d")).toEqual([
      { id: "T1", type: "FS", lagDays: 0 },
      { id: "T2", type: "SS", lagDays: 2 },
      { id: "M3", type: "FF", lagDays: -1 },
    ]);
  });
});

describe("round trip: export then parse returns the same plan", () => {
  for (const name of ["gala.ezplan", "chatgpt-style.md", "plain-checklist.md", "errors.ezplan"]) {
    it(name, () => {
      const first = parsePlan(fixture(name)).plan;
      const exported = exportPlan(first);
      const second = parsePlan(exported);
      expect(second.plan).toEqual(first);
      expect(second.mode).toBe("strict");
      expect(exportPlan(second.plan)).toBe(exported);
    });
  }

  it("a box ticked by hand in another app comes back as done", () => {
    const exported = exportPlan(parsePlan(fixture("gala.ezplan")).plan);
    const edited = exported.replace("- [ ] T3:", "- [x] T3:");
    expect(task(parsePlan(edited).plan, "T3").status).toBe("done");
  });
});
