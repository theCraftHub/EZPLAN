import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTasks, changesToOps, diffPlans, newRoom, parseOp, parsePlan, serverApply, updatePrompt, whatChanged, type Op, type Plan } from "../src";

const gala = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "gala.rakuplan"), "utf8")).plan;
const DAY = "2026-12-08";
const codeBlock = (s: string) => /```\n([\s\S]*?)\n```/.exec(s.slice(s.indexOf("CURRENT PLAN")))![1]!;

/** An assistant's reply to the update prompt: chatter, the full plan, and a WHAT CHANGED list. */
function reply(hideNames = false) {
  const { prompt, nameMap } = updatePrompt(gala, { hideNames, versionTag: "v7" });
  const sam = hideNames ? Object.keys(nameMap).find((k) => nameMap[k] === "Sam")! : "Sam";
  const ana = hideNames ? Object.keys(nameMap).find((k) => nameMap[k] === "Ana")! : "Ana";
  let plan = codeBlock(prompt)
    .replace("goal: Host a 200-guest fundraising dinner raising $50k.", "goal: Host a 250-guest fundraising dinner raising $60k.")
    .replace(`- [/] T2: Book venue (1w) @${ana}`, `- [x] T2: Book venue (1w) @${ana}`) // tries to change progress
    .replace(/(- \[x\] T1: Set budget[^\n]*)/, "$1\n  remove: yes") // tries to remove a done task
    .replace(/- \[ \] T3: Pitch 10 local businesses \(2w\) @\S+/, `- [ ] T3: Pitch 10 local businesses (3w) @${ana}`)
    .replace(/- \[-\] T4: Live band[^\n]*\n?/, "") // T4 left out of the reply
    .replace(/- \[ \] M1: Venue confirmed[^\n]*\n?/, "");
  plan = plan.replace(/(## P2: Sponsors and tickets\n)/, "$1\n- [ ] M1: Venue confirmed (milestone) depends: T2\n");
  plan += `\n- [x] T5: Print tickets (2d) @${sam} depends: T3\n\n## P3: Thank-yous\n\n- [ ] T6: Send thank-you notes (1d) @${ana}\n`;
  const text = `Sure! Here is the updated plan:\n\n\`\`\`\n${plan}\n\`\`\`\n\n**WHAT CHANGED**\n- Raised the goal to 250 guests and $60k.\n- Gave sponsor pitching to ${ana} and more time.\n- Added printing tickets and a thank-you phase.\n`;
  return { text, plan: parsePlan(text).plan, nameMap };
}

function apply(plan: Plan, ops: Op[]) {
  const room = newRoom(plan);
  ops.forEach((op, i) => serverApply(room, { opId: `u${i}`, clientId: "update", op }, { userId: "u-pat", name: "Pat" }, DAY));
  return room.plan;
}

describe("Update with my AI: compare and merge", () => {
  const r = reply();
  const changes = diffPlans(gala, r.plan);
  const byKey = new Map(changes.map((c) => [c.key, c]));

  it("finds every kind of change in a realistic reply", () => {
    expect(byKey.get("plan:goal")).toMatchObject({ applicable: true, defaultOn: true });
    expect(byKey.get("edit:T3:estimate")).toMatchObject({ text: '"Pitch 10 local businesses": time needed 2w → 3w' });
    expect(byKey.get("edit:T3:owner")).toMatchObject({ to: "Ana" });
    expect(byKey.get("add:T5")).toMatchObject({ kind: "addTask", phaseId: "P2", afterId: "T3" });
    expect(byKey.get("phase:P3")).toMatchObject({ kind: "addPhase", afterId: "P2" });
    expect(byKey.get("add:T6")).toMatchObject({ phaseId: "P3" });
    expect(byKey.get("move:M1")).toMatchObject({ kind: "move", phaseId: "P2" });
  });

  it("never takes progress from the reply: status changes are suggestions, done tasks can't be removed", () => {
    expect(byKey.get("status:T2")).toMatchObject({ applicable: false });
    expect(byKey.get("remove:T1")).toMatchObject({ applicable: false, text: expect.stringMatching(/kept, because done tasks can't be removed/) });
    const accepted = new Set(changes.map((c) => c.key));
    const after = apply(gala, changesToOps(changes, accepted));
    const t1 = allTasks(after).find((t) => t.id === "T1")!;
    const t2 = allTasks(after).find((t) => t.id === "T2")!;
    expect(t1.done).toEqual({ date: "2026-12-02", by: "Ana" }); // the original "Done by" is untouched
    expect(t2.status).toBe("progress");
    // A new task ticked done in the reply starts as to do, credited to nobody.
    const t5 = allTasks(after).find((t) => t.id === "T5")!;
    expect(t5.status).toBe("todo");
    expect(t5.done).toBeUndefined();
  });

  it("keeps tasks missing from the reply unless the person ticks them", () => {
    const missing = byKey.get("missing:T4")!;
    expect(missing).toMatchObject({ defaultOn: false, applicable: true });
    const defaults = new Set(changes.filter((c) => c.defaultOn).map((c) => c.key));
    expect(allTasks(apply(gala, changesToOps(changes, defaults))).some((t) => t.id === "T4")).toBe(true);
    defaults.add("missing:T4");
    expect(allTasks(apply(gala, changesToOps(changes, defaults))).some((t) => t.id === "T4")).toBe(false);
  });

  it("applies the accepted changes into the plan the reply describes (apart from progress)", () => {
    const after = apply(gala, changesToOps(changes, new Set(changes.filter((c) => c.defaultOn).map((c) => c.key))));
    expect(after.goal).toBe("Host a 250-guest fundraising dinner raising $60k.");
    expect(after.phases.map((p) => p.id)).toEqual(["P1", "P2", "P3"]);
    expect(after.phases[1]!.tasks.map((t) => t.id)).toEqual(["M1", "T3", "T5", "T4"]); // T4 kept where it was
    expect(allTasks(after).find((t) => t.id === "T3")).toMatchObject({ owner: "Ana", estimate: { amount: 3, unit: "w" } });
    // Comparing again finds nothing left to do except the progress suggestions and kept tasks.
    const again = diffPlans(after, r.plan).filter((c) => c.applicable && c.defaultOn);
    expect(again).toEqual([]);
  });

  it("a rejected change is not applied", () => {
    const keys = new Set(changes.filter((c) => c.defaultOn).map((c) => c.key));
    keys.delete("edit:T3:owner");
    expect(allTasks(apply(gala, changesToOps(changes, keys))).find((t) => t.id === "T3")!.owner).toBe("Sam");
  });

  it("puts hidden names back before comparing", () => {
    const hidden = reply(true);
    const c = diffPlans(gala, hidden.plan, { nameMap: hidden.nameMap });
    expect(c.find((x) => x.key === "edit:T3:owner")).toMatchObject({ to: "Ana" });
    expect(c.some((x) => x.kind === "edit" && x.field === "owner" && x.taskId !== "T3")).toBe(false);
  });

  it("every edit it makes is one a client is allowed to send", () => {
    for (const op of changesToOps(changes, new Set(changes.map((c) => c.key)))) expect(parseOp(op), JSON.stringify(op)).not.toBeNull();
  });

  it("reads the assistant's WHAT CHANGED list", () => {
    expect(whatChanged(r.text)).toEqual(["Raised the goal to 250 guests and $60k.", "Gave sponsor pitching to Ana and more time.", "Added printing tickets and a thank-you phase."]);
    expect(whatChanged("no list here")).toEqual([]);
  });

  it("an unchanged reply has no changes", () => {
    expect(diffPlans(gala, parsePlan(codeBlock(updatePrompt(gala).prompt)).plan).filter((c) => c.kind !== "status")).toEqual([]);
  });
});

describe("new edits: phases, plan fields, restore from Trash, replace (server only)", () => {
  it("restores a deleted task, renames a phase, and refuses replacePlan from clients", () => {
    const after = apply(gala, [{ kind: "deleteTask", taskId: "T3" }, { kind: "restoreTask", taskId: "T3" }, { kind: "setPhaseField", phaseId: "P1", field: "title", value: "Venue" }, { kind: "setPlanField", field: "doneWhen", value: undefined }]);
    expect(allTasks(after).some((t) => t.id === "T3")).toBe(true);
    expect(after.phases[0]!.title).toBe("Venue");
    expect(after.doneWhen).toBeUndefined();
    expect(parseOp({ kind: "replacePlan", plan: gala })).toBeNull();
    expect(parseOp({ kind: "setPlanField", field: "title", value: "" })).not.toBeNull(); // allowed, but a plan keeps its title
    expect(apply(gala, [{ kind: "setPlanField", field: "title", value: "" }]).title).toBe(gala.title);
    expect(apply(gala, [{ kind: "replacePlan", plan: { ...gala, title: "Restored" } }]).title).toBe("Restored");
  });
});
