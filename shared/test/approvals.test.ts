import { describe, expect, it } from "vitest";
import { allTasks, applyOp, awaitingApproval, countsAsDone, exportPlan, parsePlan, progressOf, sameName, schedulePlan, type Actor, type Plan } from "../src";

const FILE = `---\nrakuplan: 1\ntitle: Signs\nstart: 2027-01-04\n---\n## P1: Work\n- [x] T1: Draft the sign (1d) @Kai approver: "Pat Lee" done: 2027-01-04 by Kai\n- [x] T2: Print it (1d) approver: Pat done: 2027-01-05 by Kai approved: 2027-01-06 by Pat\n- [ ] T3: Hang it (1d)`;
const plan = () => parsePlan(FILE).plan as Plan;
const kai: Actor = { userId: "k", name: "Kai" };
const pat: Actor = { userId: "p", name: "Pat Lee" };
const room = (p: Plan) => ({ plan: p, trash: {}, restoredForReview: [] as string[] });

describe("approvals", () => {
  it("reads and writes approver and approved, round trip", () => {
    const p = plan();
    const [t1, t2] = allTasks(p);
    expect(t1).toMatchObject({ approver: "Pat Lee", status: "done" });
    expect(t1!.approved).toBeUndefined();
    expect(t2!.approved).toEqual({ date: "2027-01-06", by: "Pat" });
    expect(awaitingApproval(t1!)).toBe(true);
    expect(countsAsDone(t2!)).toBe(true);
    const again = parsePlan(exportPlan(p)).plan as Plan;
    expect(allTasks(again).map((t) => [t.approver, t.approved?.by])).toEqual([["Pat Lee", undefined], ["Pat", "Pat"], [undefined, undefined]]);
  });

  it("approving stamps who and when; sending back reopens it; changes clear an approval", () => {
    const r = room(plan());
    applyOp(r, { kind: "approve", taskId: "T1", decision: "approve" }, pat, "2027-01-07");
    expect(allTasks(r.plan)[0]!.approved).toEqual({ date: "2027-01-07", by: "Pat Lee" });
    applyOp(r, { kind: "setField", taskId: "T1", field: "title", value: "Draft the big sign" }, kai, "2027-01-08");
    expect(allTasks(r.plan)[0]!.approved).toBeUndefined();
    applyOp(r, { kind: "approve", taskId: "T1", decision: "reject", note: "Wrong colour" }, pat, "2027-01-08");
    expect(allTasks(r.plan)[0]).toMatchObject({ status: "progress" });
    expect(allTasks(r.plan)[0]!.done).toBeUndefined();
    // Not done, or no approver: nothing to approve.
    applyOp(r, { kind: "approve", taskId: "T3", decision: "approve" }, pat, "2027-01-08");
    expect(allTasks(r.plan)[2]!.approved).toBeUndefined();
  });

  it("waiting for approval counts as half done; Complete only once approved", () => {
    const p = plan();
    applyOp(room(p), { kind: "setStatus", taskId: "T3", status: "done" }, kai, "2027-01-08");
    const prog = progressOf(p, schedulePlan(p, { today: "2027-01-08" }), { today: "2027-01-08" });
    expect(prog).toMatchObject({ doneCount: 2, awaitingApproval: 1, suggestedHealth: expect.not.stringMatching("Complete") });
    applyOp(room(p), { kind: "approve", taskId: "T1", decision: "approve" }, pat, "2027-01-08");
    expect(progressOf(p, schedulePlan(p, { today: "2027-01-08" }), { today: "2027-01-08" })).toMatchObject({ doneCount: 3, awaitingApproval: 0, suggestedHealth: "Complete" });
  });

  it("matches names by full or first name", () => {
    expect(sameName("Pat", "Pat Lee")).toBe(true);
    expect(sameName("pat lee", "Pat Lee")).toBe(true);
    expect(sameName("Patricia", "Pat Lee")).toBe(false);
    expect(sameName(undefined, "Pat Lee")).toBe(false);
  });
});
