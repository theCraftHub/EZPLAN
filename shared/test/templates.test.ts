import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTasks, checkPlan, importPlan, levelPlan, parsePlan, pastPlanText, planFromPast, templateText, TEMPLATES } from "../src";

const ctx = { importerName: "Pat", editablePlanIds: new Set<string>(), memberNames: [], today: "2027-01-04" };

describe("starter templates", () => {
  it("cover the industries in the plan, and every one imports strictly with no problems", async () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["blank", "event", "renovation", "launch", "hiring", "research", "move", "wedding", "construction", "marketing"]);
    for (const t of TEMPLATES) {
      const text = templateText(t.id, "2027-01-04");
      const parsed = parsePlan(text);
      expect(parsed.mode, t.id).toBe("strict");
      expect(parsed.issues.filter((i) => i.severity === "error"), t.id).toEqual([]);
      const r = await importPlan({ source: "paste", text }, ctx);
      expect(r.ok, t.id).toBe(true);
      const problems = checkPlan(r.plan!, { today: "2027-01-04" }).findings.filter((f) => f.severity === "problem");
      expect(problems, t.id).toEqual([]);
      expect(levelPlan(r.plan!, { today: "2027-01-04" }).finish >= "2027-01-04").toBe(true);
    }
  });

  it("uses the chosen title and start date", () => {
    const p = parsePlan(templateText("wedding", "2027-03-01", "Sam and Ana's wedding")).plan;
    expect(p.title).toBe("Sam and Ana's wedding");
    expect(p.start).toBe("2027-03-01");
  });
});

describe("start from a past project", () => {
  const gala = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "gala.ezplan"), "utf8")).plan;
  it("keeps the structure and clears progress, dates, baselines and the plan's identity", () => {
    const p = planFromPast(gala, { title: "Gala 2028", start: "2027-11-01" });
    expect(p.title).toBe("Gala 2028");
    expect(p.id).toBeUndefined();
    expect(p.baselineSet).toBeUndefined();
    expect(p.phases.map((x) => x.title)).toEqual(gala.phases.map((x) => x.title));
    for (const t of allTasks(p)) {
      expect(t.status).toBe("todo");
      expect(t.done ?? t.skipped ?? t.planned ?? t.due).toBeUndefined();
      expect(t.subtasks.every((s) => s.status === "todo")).toBe(true);
    }
    expect(allTasks(p).map((t) => t.owner)).toEqual(allTasks(gala).map((t) => t.owner));
    expect(allTasks(gala).some((t) => t.status === "done")).toBe(true); // the original is untouched
  });
  it("round-trips through the plan format", async () => {
    const r = await importPlan({ source: "paste", text: pastPlanText(gala, { start: "2027-11-01" }) }, ctx);
    expect(r.ok).toBe(true);
    expect(r.creditedToImporter).toEqual([]);
  });
});
