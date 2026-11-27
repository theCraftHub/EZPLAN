import { describe, expect, it } from "vitest";
import { parsePlan, splitMasterText } from "../src";

const TEXT = `---
rakuplan: 1
title: HQ remodel
start: 2027-02-01
---
## P1: Whole building
- [ ] M1: Permit approved (milestone)

# Plan: Reception
## P1: Front
- [ ] T1: Demolish desk (2d) @Kai dept: Facilities depends: master/M1
- [ ] T2: Move network closet (3d) @Ivan dept: IT depends: T1

# Plan: Office 2
## P1: Rooms
- [ ] T1: Walls (3d) @Kai depends: reception/T2
`;

describe("master plan as one text", () => {
  it("splits at # Plan: headings; each part is a plan file with its key and the master's start", () => {
    const m = splitMasterText(TEXT, "rakuplan")!;
    expect(m.title).toBe("HQ remodel");
    expect(m.plans.map((p) => [p.title, p.key])).toEqual([["Reception", "reception"], ["Office 2", "office-2"]]);
    const reception = parsePlan(m.plans[0]!.text);
    expect(reception.plan).toMatchObject({ title: "Reception", start: "2027-02-01" });
    expect(reception.plan!.phases[0]!.tasks[0]!.depends).toEqual([expect.objectContaining({ id: "master/M1" })]);
    expect(parsePlan(m.master).plan!.phases[0]!.tasks[0]!.id).toBe("M1");
  });
  it("is null for an ordinary plan; a master with no whole-building tasks gets an empty phase", () => {
    expect(splitMasterText("---\nrakuplan: 1\ntitle: A\n---\n## P1: X\n- [ ] T1: Y (1d)", "rakuplan")).toBeNull();
    const m = splitMasterText("# Plan: Only one\n## P1: X\n- [ ] T1: Y (1d)", "rakuplan")!;
    expect(m.title).toBe("Master plan");
    expect(parsePlan(m.master).plan!.phases[0]!.title).toBe("Whole building");
  });
});
