/**
 * Real replies from other AI assistants to the Get prompt (docs/prompts/generate-plan-prompt.txt),
 * saved exactly as the owner pasted them. Every reply must import with no errors.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTasks, checkPlan, exportPlan, isWaiting, parsePlan, schedulePlan, workloadByWeek } from "../src";

const cases = [
  { file: "chatgpt-renovation.txt", phases: 6, tasks: 36, milestones: 6, people: ["Jordan", "Priya"], start: "2027-01-04" },
  // Pasted as rendered text: no code fence around the plan.
  { file: "copilot-renovation.txt", phases: 6, tasks: 29, milestones: 6, people: ["Jordan", "Priya"], start: "2027-01-04" },
  // No blank line between phase descriptions and tasks; uses subtasks.
  { file: "gemini-renovation.txt", phases: 4, tasks: 16, milestones: 3, subtasks: 5, people: ["Jordan", "Priya"], start: "2027-01-04" },
  // Second run with the waiting-time rule. Reused the ID M2 and left the permit wait unconnected.
  { file: "gemini-renovation-v2.txt", phases: 4, tasks: 16, milestones: 3, subtasks: 2, people: ["Jordan", "Priya"], start: "2027-01-04" },
  // Second run with the waiting-time rule: waits as tasks (some unowned), "depends: T9 !high".
  { file: "copilot-renovation-v2.txt", phases: 6, tasks: 29, milestones: 7, people: ["Jordan", "Priya"], start: "2027-01-04" },
  // Conversation mode, pasted into a long-running chat about a real project (anonymized).
  { file: "claude-existing-chat-signage.txt", phases: 8, tasks: 41, milestones: 6, people: ["Alex"], start: "2026-11-16" },
  // Conversation mode; the reply stops partway through the last phase. Blank lines between tasks.
  { file: "copilot-existing-chat-cutoff.txt", phases: 6, tasks: 24, milestones: 5, people: ["Alex"], start: "2026-11-16" },
  // The same reply, complete. Ends with plan-wide "Assumption:" lines below the last task.
  { file: "copilot-existing-chat.txt", phases: 6, tasks: 28, milestones: 6, people: ["Alex"], start: "2026-11-16" },
];

describe("replies from other AI assistants", () => {
  for (const c of cases) {
    describe(c.file, () => {
      const text = readFileSync(join(import.meta.dirname, "fixtures", "assistants", c.file), "utf8");
      const r = parsePlan(text);
      const tasks = allTasks(r.plan);

      it("imports with no errors", () => {
        expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
        expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
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

  it("a reused ID is renamed with a warning, and an unconnected wait is pointed out", () => {
    const r = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "assistants", "gemini-renovation-v2.txt"), "utf8"));
    expect(r.issues).toContainEqual(expect.objectContaining({ severity: "warning", message: expect.stringMatching(/M2 "Final inspection passed.*new ID/) }));
    const last = allTasks(r.plan).at(-1)!;
    expect(last.id).toBe("M3");
    expect(last.depends.map((d) => d.id)).toEqual(["T13"]);
    const loose = checkPlan(r.plan, { today: "2027-01-04" }).findings.filter((f) => f.code === "loose-end");
    expect(loose.map((f) => f.taskIds[0])).toEqual(["T4"]);
  });

  it("keeps a priority written after depends, and treats waits as calendar time, not work", () => {
    const plan = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "assistants", "copilot-renovation-v2.txt"), "utf8")).plan;
    const t = (id: string) => allTasks(plan).find((x) => x.id === id)!;
    expect(t("T10").priority).toBe("high");
    expect(t("T10").depends.map((d) => d.id)).toEqual(["T9"]);
    expect(["T6", "T8", "T12", "T15", "T20"].every((id) => isWaiting(t(id)))).toBe(true);
    expect(isWaiting(t("T9"))).toBe(false);
    const s = schedulePlan(plan, {});
    expect(s.finish).toBe("2027-04-27");
    const codes = checkPlan(plan, { today: "2027-01-04", schedule: s }).findings.map((f) => f.code);
    expect(codes).not.toContain("no-owner");
    expect(codes).not.toContain("critical-unassigned");
    expect(codes).not.toContain("long-task");
    // Priya "owns" the 3-week permit wait, but it isn't 120 hours of her work.
    const priya = workloadByWeek(plan, s).get("Priya")!;
    expect(Math.max(...priya.values())).toBeLessThanOrEqual(40);
  });

  it("conversation mode: past work comes in done, current work in progress, guesses marked", () => {
    const plan = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "assistants", "claude-existing-chat-signage.txt"), "utf8")).plan;
    const tasks = allTasks(plan);
    expect(tasks.filter((t) => t.status === "done")).toHaveLength(14); // T1-T12, M1, T18
    expect(tasks.filter((t) => t.status === "progress").map((t) => t.id)).toEqual(["T13"]);
    expect(tasks.filter((t) => t.notes.some((n) => n.startsWith("Assumption:"))).map((t) => t.id)).toEqual(["T14", "T23", "T31"]);
    const findings = checkPlan(plan, { today: "2026-11-16" }).findings;
    // A one-person project: no "share the work" advice, no tips about finished milestones,
    // no loose-end tip for a separate follow-up phase; the real risk is one person's load.
    expect(findings.map((f) => f.code).sort()).toEqual(["no-estimate", "overloaded"]);
    expect(findings.find((f) => f.code === "overloaded")!.message).toMatch(/Alex has about 25 working days.*finishes 2026-12-03.*about 2026-12-18/);
  });

  it("warns when a reply was cut off, and stays quiet on complete replies", () => {
    const dir = join(import.meta.dirname, "fixtures", "assistants");
    const cut = parsePlan(readFileSync(join(dir, "copilot-existing-chat-cutoff.txt"), "utf8"));
    expect(cut.issues).toContainEqual(expect.objectContaining({ severity: "warning", message: expect.stringMatching(/stop early after T19 "Perform walkthrough".*send the full plan again/) }));
    for (const c of cases.filter((x) => !x.file.includes("cutoff"))) {
      expect(parsePlan(readFileSync(join(dir, c.file), "utf8")).issues.map((i) => i.message).join()).not.toMatch(/stop early/);
    }
    // A code block that opens but never closes.
    const open = "```\n---\nezplan: 1\ntitle: X\n---\n## P1: A\n- [ ] T1: First (1d)\n- [ ] T2: Second (1d) depends: T1";
    expect(parsePlan(open).issues.map((i) => i.message).join()).toMatch(/stop early after T2/);
  });

  it("keeps plan-wide assumptions written below the tasks, and exports them in the header", () => {
    const r = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "assistants", "copilot-existing-chat.txt"), "utf8"));
    expect(r.issues).toEqual([]);
    expect(r.plan.notes).toEqual([
      expect.stringMatching(/^Assumption: No permit is required/),
      expect.stringMatching(/^Assumption: Target completion is approximately 6-8 weeks/),
    ]);
    const header = exportPlan(r.plan).split("\n---")[0]!;
    expect(header).toMatch(/\nnote: Assumption: No permit is required/);
    expect(parsePlan("---\nezplan: 1\ntitle: X\nassumption: Venue is free\nnote: Ask Sam\n---\n## P1: A\n- [ ] T1: Go (1d)").plan.notes).toEqual(["Assumption: Venue is free", "Ask Sam"]);
  });
});
