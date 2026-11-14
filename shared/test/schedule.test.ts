import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Calendar, checkPlan, parsePlan, progressOf, schedulePlan, workloadByWeek } from "../src";

const gala = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "gala.ezplan"), "utf8")).plan;
const plan = (body: string, header = "title: Test\nstart: 2026-12-01") => parsePlan(`---\nezplan: 1\n${header}\n---\n## P1: Work\n${body}`).plan;

describe("calendar", () => {
  const cal = new Calendar({ holidays: ["2026-12-25"] });
  it("skips weekends and holidays", () => {
    expect(cal.nextWorkday("2026-12-05")).toBe("2026-12-07"); // Saturday -> Monday
    expect(cal.dateAt("2026-12-01", 4)).toBe("2026-12-07");
    expect(cal.dateAt("2026-12-24", 1)).toBe("2026-12-28"); // over Christmas + weekend
    expect(cal.workdaysBetween("2026-12-01", "2026-12-08")).toBe(5);
    expect(cal.workdaysBetween("2026-12-08", "2026-12-01")).toBe(-5);
  });
});

describe("schedule (hand-checked on the gala plan)", () => {
  const s = schedulePlan(gala, { today: "2026-12-08" });
  const at = (id: string) => s.tasks.get(id)!;

  it("dates every task from estimates and dependencies", () => {
    expect(s.projectStart).toBe("2026-12-01");
    expect([at("T1").start, at("T1").end]).toEqual(["2026-12-01", "2026-12-02"]);
    expect([at("T2").start, at("T2").end]).toEqual(["2026-12-03", "2026-12-09"]);
    expect(at("M1").end).toBe("2026-12-10");
    expect([at("T3").start, at("T3").end]).toEqual(["2026-12-03", "2026-12-16"]);
    expect(s.finish).toBe("2026-12-16");
  });

  it("finds the critical path and slack", () => {
    expect(s.criticalPath).toEqual(["T1", "T3"]);
    expect(at("T2").slack).toBe(5);
    expect(at("M1").slack).toBe(5);
    expect(at("T4").slack).toBe(9);
  });

  it("computes progress, baseline variance, forecast and health", () => {
    const p = progressOf(gala, s, { today: "2026-12-08" });
    expect(p.percent).toBe(26); // (2 done + 5/2 in progress) of 17 working days
    expect(p.baselineVarianceDays).toBe(5); // baseline Dec 9 vs scheduled Dec 16
    expect(p.forecastFinish).toBe("2026-12-25"); // pace 0.9 days/day, 12.5 days left
    expect(p.suggestedHealth).toBe("Off track"); // 12 working days late vs baseline
  });

  it("spreads workload over weeks per owner", () => {
    const w = workloadByWeek(gala, s);
    expect(w.get("Sam")!.get("2026-11-30")).toBe(16); // T3 starts Thu Dec 3: 2 days in week 1
    expect(w.get("Sam")!.get("2026-12-07")).toBe(40);
    expect(w.get("Sam")!.get("2026-12-14")).toBe(24);
    expect(w.get("Ana")!.get("2026-11-30")).toBe(16); // T2 Thu-Fri (T4 skipped is excluded)
  });
});

describe("dependency types and lag", () => {
  it("handles start-to-start, finish-to-finish and lag", () => {
    const p = plan(["- [ ] T1: A (4d)", "- [ ] T2: B (2d) depends: T1 SS+1d", "- [ ] T3: C (1d) depends: T1 FF", "- [ ] T4: D (1d) depends: T1 +2d"].join("\n"));
    const s = schedulePlan(p);
    expect(s.tasks.get("T2")!.startOffset).toBe(1);
    expect(s.tasks.get("T3")!.endOffset).toBe(4);
    expect(s.tasks.get("T4")!.startOffset).toBe(6);
  });

  it("assumes 1 day for missing estimates and reports loops instead of hanging", () => {
    const p = plan(["- [ ] T1: A depends: T2", "- [ ] T2: B (1d) depends: T1", "- [ ] T3: C (1d)"].join("\n"));
    const s = schedulePlan(p);
    expect(s.tasks.get("T1")!.assumedDuration).toBe(true);
    expect(s.cycles).toHaveLength(1);
    expect(new Set(s.cycles[0])).toEqual(new Set(["T1", "T2"]));
  });

  it("marks unfinished work overdue after its end date", () => {
    const p = plan("- [ ] T1: Late (1d)\n- [x] T2: Done (1d)");
    const s = schedulePlan(p, { today: "2026-12-10" });
    expect(s.tasks.get("T1")!.overdue).toBe(true);
    expect(s.tasks.get("T2")!.overdue).toBe(false);
  });

  it("handles 2,000 tasks quickly", () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `- [ ] T${i + 1}: Task ${i + 1} (1d) @P${i % 7}${i > 0 ? ` depends: T${i}` : ""}`);
    const p = plan(lines.join("\n"));
    const t0 = performance.now();
    const s = schedulePlan(p);
    checkPlan(p, { schedule: s });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(s.tasks.get("T2000")!.startOffset).toBe(1999);
  });
});

describe("free Plan Check", () => {
  it("finds nothing wrong with a healthy plan", () => {
    const r = checkPlan(gala, { today: "2026-12-01" });
    expect(r.findings).toEqual([]);
    expect(r.score).toBe(100);
  });

  it("explains problems in plain language with the tasks involved", () => {
    const p = parsePlan(
      ["---", "ezplan: 1", "title: Messy", "start: 2026-12-01", "---", "## P1: Work",
        "- [ ] T1: A (2d) depends: T9", "- [ ] T1: Duplicate (1d)", "- [ ] T2: Loop one (1d) depends: T3",
        "- [ ] T3: Loop two (1d) depends: T2", "- [ ] T4: Huge job (4w) @Kim due: 2026-12-02", "## P2: Empty"].join("\n"),
    ).plan;
    const r = checkPlan(p, { today: "2026-12-01" });
    const codes = r.findings.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["duplicate-id", "unknown-dependency", "dependency-loop", "missing-goal", "missing-done-when", "no-owner", "after-due-date", "long-task"]));
    expect(r.findings[0]!.severity).toBe("problem");
    expect(r.findings.find((f) => f.code === "after-due-date")!.taskIds).toEqual(["T4"]);
    expect(r.score).toBeLessThan(50);
  });
});
