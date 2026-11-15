/**
 * Real replies from other AI assistants to the Get prompt (docs/prompts/generate-plan-prompt.txt),
 * saved exactly as the owner pasted them. Every reply must import with no errors.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTasks, checkPlan, exportPlan, parsePlan, schedulePlan } from "../src";

const cases = [
  { file: "chatgpt-renovation.txt", phases: 6, tasks: 36, milestones: 6, people: ["Jordan", "Priya"], start: "2027-01-04" },
  // Pasted as rendered text: no code fence around the plan.
  { file: "copilot-renovation.txt", phases: 6, tasks: 29, milestones: 6, people: ["Jordan", "Priya"], start: "2027-01-04" },
  // No blank line between phase descriptions and tasks; uses subtasks.
  { file: "gemini-renovation.txt", phases: 4, tasks: 16, milestones: 3, subtasks: 5, people: ["Jordan", "Priya"], start: "2027-01-04" },
];

describe("replies from other AI assistants", () => {
  for (const c of cases) {
    describe(c.file, () => {
      const text = readFileSync(join(import.meta.dirname, "fixtures", "assistants", c.file), "utf8");
      const r = parsePlan(text);
      const tasks = allTasks(r.plan);

      it("imports with no errors", () => {
        expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
        expect(r.plan.phases).toHaveLength(c.phases);
        expect(tasks).toHaveLength(c.tasks);
        expect(tasks.filter((t) => t.milestone)).toHaveLength(c.milestones);
        expect(r.plan.start).toBe(c.start);
        expect(tasks.reduce((n, t) => n + t.subtasks.length, 0)).toBe(c.subtasks ?? 0);
      });

      it("uses only the people named in the notes", () => {
        const owners = [...new Set(tasks.map((t) => t.owner).filter(Boolean))].sort();
        expect(owners).toEqual(c.people);
      });

      it("schedules with no loops and round-trips through export", () => {
        expect(schedulePlan(r.plan, {}).cycles).toEqual([]);
        expect(checkPlan(r.plan, { today: c.start }).findings.filter((f) => f.severity === "problem")).toEqual([]);
        expect(parsePlan(exportPlan(r.plan)).plan).toEqual(r.plan);
      });
    });
  }
});
