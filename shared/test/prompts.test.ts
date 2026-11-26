import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTasks, generatePrompt, helperPrompt, parsePlan, promptExample, restoreNames, updatePrompt, WIZARD_QUESTIONS, wizardNotes, wizardPrompt } from "../src";

const gala = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "gala.rakuplan"), "utf8")).plan;
const codeBlock = (s: string) => /```\n([\s\S]*?)\n```/.exec(s.slice(s.indexOf("CURRENT PLAN")))![1]!;

describe("AI-neutral prompts", () => {
  it("the example inside the prompt is a perfect plan file", () => {
    const r = parsePlan(promptExample());
    expect(r.mode).toBe("strict");
    expect(r.issues).toEqual([]);
    expect(allTasks(r.plan)).toHaveLength(5);
  });

  it("names no AI vendor and includes the user's notes", () => {
    const p = generatePrompt("Plan my sister's wedding in June, budget $20k");
    expect(p).toContain("Plan my sister's wedding in June, budget $20k");
    expect(p).not.toMatch(/claude|chatgpt|openai|gemini|copilot|anthropic|llama/i);
    expect(p).toMatch(/Do not invent people/);
  });

  it("the update prompt carries the full current plan, the version tag and the safety rules", () => {
    const { prompt, nameMap } = updatePrompt(gala, { versionTag: "v42" });
    expect(nameMap).toEqual({});
    expect(prompt).toMatch(/Keep every existing ID/);
    expect(prompt).toMatch(/Do not change progress/);
    const embedded = parsePlan(codeBlock(prompt)).plan;
    expect(embedded.basedOn).toBe("v42");
    expect({ ...embedded, basedOn: undefined }).toEqual({ ...gala, basedOn: undefined });
  });

  it("'hide names' replaces every person and maps them back on return", () => {
    const { prompt, nameMap } = updatePrompt(gala, { hideNames: true });
    expect(prompt).not.toMatch(/\bSam\b|\bAna\b|sam@co\.com/);
    expect(Object.values(nameMap).sort()).toEqual(["Ana", "Sam"]);
    // Simulate the assistant's reply: same plan plus a new task for an existing placeholder.
    const reply = codeBlock(prompt).replace("## P2: Sponsors and tickets\n", `## P2: Sponsors and tickets\n\n- [ ] T9: Thank sponsors (1d) @${Object.keys(nameMap).find((k) => nameMap[k] === "Ana")}\n`);
    const back = parsePlan(reply).plan;
    restoreNames(back, nameMap);
    const t9 = allTasks(back).find((t) => t.id === "T9")!;
    expect(t9.owner).toBe("Ana");
    expect(allTasks(back).find((t) => t.id === "T1")!.done).toEqual({ date: "2026-12-02", by: "Ana" });
    expect(back.team.map((m) => m.name)).toEqual(["Sam", "Ana"]);
  });

  it("helper prompts embed the plan and ask the right question", () => {
    expect(helperPrompt("next", gala)).toMatch(/Which 3 tasks/);
    expect(helperPrompt("breakdown", gala, "T3")).toMatch(/Break task T3/);
    expect(parsePlan(codeBlock(helperPrompt("replan", gala))).plan).toEqual(gala);
  });

  it("by default plans from the existing conversation, with no notes needed", () => {
    const p = generatePrompt();
    expect(p).toMatch(/project we have been discussing in this conversation/);
    expect(p).toMatch(/already finished gets \[x\]/);
    expect(p).toMatch(/Assumption:/);
    expect(p).toMatch(/Owners only for people named in this conversation\. Do not invent people/);
    expect(p).not.toMatch(/MY PROJECT NOTES/);
    expect(p).not.toMatch(/claude|chatgpt|openai|gemini|copilot|anthropic|llama/i);
    const focused = generatePrompt({ focus: "the spring launch", notes: "Leo joined the team." });
    expect(focused).toMatch(/Plan only this project: the spring launch\./);
    expect(focused.trimEnd().endsWith("EXTRA DETAILS FROM ME\nLeo joined the team.")).toBe(true);
  });

  it("the copy-paste prompt files in docs match the code", () => {
    const docs = join(import.meta.dirname, "..", "..", "docs", "prompts");
    expect(readFileSync(join(docs, "generate-plan-prompt.txt"), "utf8")).toBe(generatePrompt() + "\n");
    expect(readFileSync(join(docs, "generate-plan-prompt-fresh-chat.txt"), "utf8")).toBe(generatePrompt({ source: "notes" }) + "\n");
  });
});

describe("plan wizard (fresh chat)", () => {
  it("turns answers into notes, leaving out empty ones", () => {
    const notes = wizardNotes({
      project: "Redo our kitchen:  new cabinets,\ncounters and wiring",
      deadline: "by spring",
      budget: "$30k",
      start: "",
      people: [{ name: "Jordan", role: "manages the project" }, { name: "Priya", role: "budget and permits" }, { name: " " }],
      constraints: "Needs a permit and inspection",
    });
    expect(notes).toBe(
      [
        "Project: Redo our kitchen: new cabinets, counters and wiring",
        "Deadline: by spring",
        "Budget: $30k",
        "People: Jordan (manages the project), Priya (budget and permits)",
        "Must happen or be avoided: Needs a permit and inspection",
      ].join("\n"),
    );
  });

  it("builds the fresh-chat prompt with the notes filled in, and requires a project", () => {
    const p = wizardPrompt({ project: "Plan a 200-guest charity dinner", people: [{ name: "Sam" }] });
    expect(p.trimEnd().endsWith("MY PROJECT NOTES\nProject: Plan a 200-guest charity dinner\nPeople: Sam")).toBe(true);
    expect(p).not.toMatch(/this conversation/);
    expect(() => wizardPrompt({ project: "  " })).toThrow();
    expect(WIZARD_QUESTIONS.filter((q) => q.required).map((q) => q.key)).toEqual(["project"]);
  });
});
