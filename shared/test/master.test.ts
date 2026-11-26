/**
 * Master plans (step K1): one schedule across the master and its sub-plans. The Northfield HQ
 * remodel from the approved mockups must come out the same: every date, and move-in on May 6.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPlan, crossRef, formatDepends, masterSchedule, parseDepends, parsePlan, exportPlan, type MasterPart } from "../src";

type Fx = { today: string; start: string; finish: string; people: Record<string, number>; subs: { key: string; title: string; lead: string; needs: string[] }[]; tasks: { id: string; est: string; sub: string; title: string; owner: string; dept: string; status: string; start: string; end: string; deps: string[] }[]; whatIfNoor: { finish: string } };
const fx = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "northfield-engine.json"), "utf8")) as Fx;

/** The remodel as plan files: one per sub-plan, links to other plans written as key/T1. */
function parts(edit: (t: Fx["tasks"][number]) => Fx["tasks"][number] = (t) => t): MasterPart[] {
  return fx.subs.map((s) => {
    const lines = fx.tasks.filter((t) => t.sub === s.key).map(edit).map((t) => {
      const box = t.status === "done" ? "x" : t.status === "progress" ? "/" : " ";
      const deps = t.deps.map((d) => (fx.tasks.find((o) => o.id === d)!.sub === s.key ? d : `${fx.tasks.find((o) => o.id === d)!.sub}/${d}`));
      return `- [${box}] ${t.id}: ${t.title} (${t.est}) @${t.owner} dept: ${t.dept}${deps.length ? ` depends: ${deps.join(", ")}` : ""}`;
    });
    const text = `---\nezplan: 1\ntitle: ${s.title}\nstart: ${fx.start}\n---\n## P1: Work\n${lines.join("\n")}\n`;
    const r = parsePlan(text);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    return { key: s.key, title: s.title, plan: r.plan };
  });
}
const people = (extra: Record<string, number> = {}) => Object.fromEntries(Object.entries({ ...fx.people, ...extra }).map(([n, h]) => [n, { hoursPerWeek: h }]));

describe("master plans", () => {
  it("reads and writes departments and links to other plans", () => {
    expect(parseDepends("reception/T4, T2 SS +1d, master/M1")).toEqual([
      { id: "reception/T4", type: "FS", lagDays: 0 }, { id: "T2", type: "SS", lagDays: 1 }, { id: "master/M1", type: "FS", lagDays: 0 },
    ]);
    expect(crossRef("bathroom-2/T20")).toEqual({ key: "bathroom-2", id: "T20" });
    expect(crossRef("T20")).toBeNull();
    const plan = parsePlan("---\nezplan: 1\ntitle: Office 1\n---\n## P1: Work\n- [ ] T1: Network cabling (2d) @Ivan dept: IT depends: reception/T4\n").plan;
    expect(plan.phases[0]!.tasks[0]).toMatchObject({ dept: "IT", depends: [{ id: "reception/T4" }] });
    expect(exportPlan(plan)).toContain("dept: IT");
    expect(formatDepends(plan.phases[0]!.tasks[0]!.depends)).toBe("reception/T4");
    // On its own, a sub-plan doesn't call a link to another plan an unknown task.
    expect(checkPlan(plan, { today: fx.today }).findings.filter((f) => f.code === "unknown-dependency")).toEqual([]);
  });

  it("schedules the whole remodel as one: the mockup's dates and move-in on May 6", () => {
    const r = masterSchedule(parts(), { today: fx.today, people: people() });
    expect(r.finish).toBe(fx.finish);
    for (const t of fx.tasks) expect([t.id, r.task(t.sub, t.id)?.start, r.task(t.sub, t.id)?.end]).toEqual([t.id, t.start, t.end]);
  });

  it("counts one person's hours across every plan, and a slip in one plan moves the others", () => {
    // A second carpenter for the bathroom tiling frees Kai: move-in comes back to Apr 26.
    const noor = masterSchedule(parts((t) => (["T19", "T23", "T28"].includes(t.id) ? { ...t, owner: "Noor" } : t)), { today: fx.today, people: people({ Noor: 40 }) });
    expect(noor.finish).toBe(fx.whatIfNoor.finish);
    // Reception's network closet move takes a week longer: Office cabling (another plan) starts later.
    const base = masterSchedule(parts(), { today: fx.today, people: people() });
    const slow = masterSchedule(parts((t) => (t.id === "T4" ? { ...t, est: "8d" } : t)), { today: fx.today, people: people() });
    expect(slow.task("office-1", "T30")!.start > base.task("office-1", "T30")!.start).toBe(true);
    // Per plan: each sub-plan's finish, and which plans decide the master's finish.
    expect(base.plans.get("kitchen")!.finish).toBe("2027-03-25");
    expect(base.plans.get("master")!.finish).toBe(fx.finish);
  });
});
