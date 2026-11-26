import { describe, expect, it } from "vitest";
import { describeOp, findMentions, parsePlan, taskBefore, type Op } from "../src";

const plan = parsePlan(`---\nrakuplan: 1\ntitle: Gala\nstart: 2027-01-04\n---\n## P1: Venue\n- [ ] T1: Book venue (2d) @Ana\n- [x] T2: Set budget (1d) @Sam done: 2027-01-04 by Sam`).plan;
const line = (op: Op) => describeOp(op, taskBefore(op, plan), plan, "Kim");

describe("activity lines", () => {
  it("say what happened in plain words", () => {
    expect(line({ kind: "setStatus", taskId: "T1", status: "done" })?.summary).toBe("Kim marked Book venue done");
    expect(line({ kind: "setStatus", taskId: "T1", status: "progress" })?.summary).toBe("Kim set Book venue to in progress");
    expect(line({ kind: "setField", taskId: "T1", field: "owner", value: "Priya" })).toMatchObject({ summary: "Kim gave Book venue to Priya", owner: "Priya" });
    expect(line({ kind: "setField", taskId: "T1", field: "owner", value: "" })?.summary).toBe("Kim left Book venue without an owner");
    expect(line({ kind: "setField", taskId: "T1", field: "due", value: "2027-02-01" })?.summary).toBe("Kim changed the due date of Book venue");
    expect(line({ kind: "deleteTask", taskId: "T1" })?.summary).toBe("Kim deleted Book venue (it's in the Trash)");
    expect(line({ kind: "addPhase", phase: { id: "P2", title: "Food" } })?.summary).toBe("Kim added the phase Food");
    expect(line({ kind: "setPlanField", field: "goal", value: "x" })?.summary).toBe("Kim changed the goal");
  });
  it("skip edits that change nothing", () => {
    expect(line({ kind: "setStatus", taskId: "T2", status: "done" })).toBeNull();
    expect(line({ kind: "setField", taskId: "T1", field: "owner", value: "Ana" })).toBeNull();
    expect(line({ kind: "deleteTask", taskId: "T99" })).toBeNull();
  });
  it("renames use the old name", () => {
    const op: Op = { kind: "setField", taskId: "T1", field: "title", value: "Book hall" };
    const before = taskBefore(op, plan);
    const after = parsePlan(`---\nrakuplan: 1\ntitle: Gala\n---\n## P1: Venue\n- [ ] T1: Book hall`).plan;
    expect(describeOp(op, before, after, "Kim")?.summary).toBe("Kim renamed Book venue to Book hall");
  });
});

describe("mentions", () => {
  const names = ["Ana", "Ana Lopez", "Sam Okoye"];
  it("prefers the longest matching name and ignores case", () => {
    expect(findMentions("thanks @ana lopez and @Sam Okoye!", names).sort()).toEqual(["Ana Lopez", "Sam Okoye"]);
    expect(findMentions("@Ana can you check?", names)).toEqual(["Ana"]);
  });
  it("ignores email addresses, unknown names and partial words", () => {
    expect(findMentions("write to ana@example.com", names)).toEqual([]);
    expect(findMentions("@Bob and @Anastasia", names)).toEqual([]);
  });
});
