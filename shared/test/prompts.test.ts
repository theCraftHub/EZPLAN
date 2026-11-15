import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTasks, generatePrompt, helperPrompt, parsePlan, promptExample, restoreNames, updatePrompt } from "../src";

const gala = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "gala.ezplan"), "utf8")).plan;
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
});
