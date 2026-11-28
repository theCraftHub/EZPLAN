/** The Board's moves: plain status changes, approval waiting, and who may approve. */
import { describe, expect, it } from "vitest";
import { allTasks, parsePlan, type Plan } from "@rakuplan/shared";
import { columnOf, moveOp } from "../src/pages/plan/board";

const plan = parsePlan(`---\nrakuplan: 1\ntitle: B\n---\n## P1: A\n- [ ] T1: Plain (1d) @Kim\n- [ ] T2: Signed (1d) @Kim approver: Pat\n- [x] T3: Waiting (1d) @Kim approver: Pat\n- [-] T4: Dropped (1d)`).plan as Plan;
const t = (id: string) => allTasks(plan).find((x) => x.id === id)!;

describe("board moves", () => {
  it("puts tasks in columns", () => {
    expect(["T1", "T2", "T3", "T4"].map((id) => columnOf(t(id)))).toEqual(["todo", "todo", "waiting", "done"]);
  });
  it("moves by status, and refuses waiting for tasks without an approver", () => {
    expect(moveOp(t("T1"), "progress", {})).toEqual({ op: { kind: "setStatus", taskId: "T1", status: "progress" } });
    expect(moveOp(t("T1"), "todo", {})).toBeNull();
    expect(moveOp(t("T1"), "waiting", {})).toMatchObject({ why: expect.stringContaining("doesn't need anyone's approval") });
    expect(moveOp(t("T2"), "waiting", {})).toEqual({ op: { kind: "setStatus", taskId: "T2", status: "done" } });
  });
  it("approving from Waiting is for the approver or a manager", () => {
    expect(moveOp(t("T3"), "done", { me: "Kim" })).toMatchObject({ why: "Only Pat or a plan manager can approve Waiting." });
    expect(moveOp(t("T3"), "done", { me: "pat" })).toEqual({ op: { kind: "approve", taskId: "T3", decision: "approve" } });
    expect(moveOp(t("T3"), "done", { manager: true })).toEqual({ op: { kind: "approve", taskId: "T3", decision: "approve" } });
    expect(moveOp(t("T3"), "progress", {})).toEqual({ op: { kind: "setStatus", taskId: "T3", status: "progress" } });
  });
});
