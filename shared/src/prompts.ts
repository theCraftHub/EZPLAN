/**
 * Prompts the user copies into ANY AI assistant (never vendor-specific).
 * Plain instructions, the format rules and one full example. See plan sections 2 and 2b.
 */
import { BRAND } from "./brand";
import { exportPlan } from "./export";
import { allTasks, type Plan } from "./schema";

const SPEC = (key: string) => `FORMAT RULES
1. Start with a header between two lines of three dashes:
   ---
   ${key}: 1
   title: <project name>
   goal: <what the project must achieve, one sentence>
   done_when: <how we will know it is finished>
   start: <YYYY-MM-DD, if known>
   ---
2. Group work into phases: a line "## P1: <phase name>", optionally followed by "> <one-line description>".
3. One task per line: - [ ] T1: <task title> (<estimate>) @<Owner> due: <YYYY-MM-DD> depends: <IDs>
   - Status box: [ ] to do, [/] in progress, [x] done, [-] skipped.
   - IDs: T1, T2... for tasks, M1, M2... for milestones (key moments, no duration). Every ID is unique.
   - Estimate in parentheses: (4h) hours, (2d) working days, (1w) working weeks. Be realistic.
   - @Owner is a person's first name; leave it out if unknown.
   - due: and depends: are optional. depends lists the IDs the task waits on, e.g. depends: T1, T3.
   - Optional: start: no earlier than <YYYY-MM-DD> when a task truly can't begin before a date.
   - Optional: !high / !medium / !low priority, #tag.
4. Under a task you may indent:  notes: <one line>   and subtasks as  - [ ] <subtask>.
5. Output ONLY the plan inside one code block. No other text inside the code block.`;

const EXAMPLE = (key: string) => `---
${key}: 1
title: Spring Charity Gala
goal: Host a 200-guest fundraising dinner raising $50k.
done_when: Event held, $50k raised, thank-you notes sent.
start: 2026-12-01
---

## P1: Venue and budget
> Lock the basics before anything else.

- [ ] T1: Set the budget (2d) @Sam
- [ ] T2: Book the venue (1w) @Ana due: 2026-12-10 depends: T1
  notes: Hold two options until the contract is signed.
  - [ ] Shortlist 3 venues
  - [ ] Sign contract
- [ ] M1: Venue confirmed depends: T2

## P2: Sponsors and tickets

- [ ] T3: Pitch 10 local businesses (2w) @Sam !high depends: T1
- [ ] T4: Open ticket sales (1d) @Leo depends: M1`;

/** The example embedded in prompts; tests check it parses with no issues. */
export function promptExample(): string {
  return EXAMPLE(BRAND.formatKey);
}

export interface GeneratePromptOptions {
  /**
   * "conversation" (default, the main use): pasted into an existing chat where the project
   * was discussed; the assistant plans from that conversation. "notes": a fresh chat, with the
   * project described in `notes` (typed by the user or built by the plan wizard, see wizard.ts).
   */
  source?: "conversation" | "notes";
  /** Project description (required for "notes"; optional extra details for "conversation"). */
  notes?: string;
  /** Which project to plan when the conversation covers several (e.g. "the spring launch"). */
  focus?: string;
}

export function generatePrompt(input: string | GeneratePromptOptions = {}): string {
  const opts: GeneratePromptOptions = typeof input === "string" ? { source: "notes", notes: input } : input;
  const source = opts.source ?? "conversation";
  const notes = opts.notes?.trim() ?? "";
  const focus = opts.focus?.trim();
  const key = BRAND.formatKey;
  const intro =
    source === "conversation"
      ? [
          `You are an experienced project planner. Turn the project we have been discussing in this conversation into a clear, realistic plan of action in the ${BRAND.name} plan format described below.`,
          "",
          "USE THIS CONVERSATION",
          `- ${focus ? `Plan only this project: ${focus}.` : "If this conversation covers more than one project, plan the main one we have been working on."}`,
          "- Use everything we discussed: the goal, decisions made, deadlines, budget, people and their roles, constraints, risks and open questions.",
          "- Work this conversation says is already finished gets [x]; work that is underway gets [/].",
          "- Where something important was never discussed (a date, a budget, who does what), make a sensible assumption and say so in a notes: line starting with \"Assumption:\" under the task it affects (for the whole plan, add a header line  note: Assumption: <text>). Do not ask me questions first; I will correct the plan afterwards.",
          "- If we haven't discussed any project yet, reply only: \"Tell me about your project first, then paste this again.\"",
        ]
      : [
          `You are an experienced project planner. Turn my project notes into a clear, realistic plan of action in the ${BRAND.name} plan format described below. It works for any kind of project (events, construction, marketing, software, research, personal projects). Where something important is missing from my notes, make a sensible assumption and say so in a notes: line starting with \"Assumption:\" under the task it affects (for the whole plan, add a header line  note: Assumption: <text>).`,
        ];
  const tail =
    source === "conversation"
      ? notes
        ? ["", "EXTRA DETAILS FROM ME", notes]
        : []
      : ["", "MY PROJECT NOTES", notes || "<paste or describe your project here>"];
  return [
    ...intro,
    "",
    "WHAT A GOOD PLAN HAS",
    "- A specific goal and a clear \"done when\".",
    "- 3 to 8 phases in a sensible order, each with concrete tasks someone can actually do.",
    "- Realistic time estimates, dependencies where one task truly has to wait for another, and a few milestones.",
    `- Owners only for people ${source === "conversation" ? "named in this conversation" : "my notes name"}. Do not invent people.`,
    "- Practical steps people often forget (permits, approvals, buffers, follow-ups) when they apply.",
    "- Waiting time as its own task with a realistic duration: approvals, permits, deliveries, lead times, drying or curing. A milestone takes no time, so never use one to stand for waiting. Work that needs the approval or delivery must list the waiting task in depends. Tag waiting tasks #wait.",
    "",
    SPEC(key),
    "",
    "EXAMPLE",
    "```",
    EXAMPLE(key),
    "```",
    ...tail,
  ].join("\n");
}

export interface UpdatePromptOptions {
  /** Replace people's names with "Owner A", "Owner B"... in the prompt. */
  hideNames?: boolean;
  /** Version tag of the plan when the prompt was made (enables safe merging). */
  versionTag?: string;
}

export interface UpdatePromptResult {
  prompt: string;
  /** Maps placeholders back to real names when the reply is imported. */
  nameMap: Record<string, string>;
}

export function updatePrompt(plan: Plan, opts: UpdatePromptOptions = {}): UpdatePromptResult {
  const key = BRAND.formatKey;
  const copy: Plan = structuredClone(plan);
  if (opts.versionTag) copy.basedOn = opts.versionTag;
  const nameMap = opts.hideNames ? redactNames(copy) : {};
  const tasks = allTasks(copy);
  const done = tasks.filter((t) => t.status === "done").length;
  return {
    nameMap,
    prompt: [
      `Here is my current project plan in the ${BRAND.name} plan format. Since we made it, new ideas, steps or goals came up in this conversation. Update the plan to include them.`,
      "",
      "RULES FOR THE UPDATE",
      "- Keep every existing ID exactly as it is. New phases and tasks get new IDs that are not used yet.",
      `- Do not change progress: keep each task's status box and any "done:" or "skipped:" text exactly as given (${done} of ${tasks.length} tasks are done).`,
      "- To remove a task, keep its line and add  remove: yes  on an indented line below it, with the reason in a notes: line.",
      `- Keep the header line "based_on:" unchanged${copy.basedOn ? "" : " if present"}.`,
      "- Reply with the FULL updated plan in one code block, then a short list titled WHAT CHANGED explaining each change and why.",
      "",
      SPEC(key),
      "",
      "CURRENT PLAN",
      "```",
      exportPlan(copy).trimEnd(),
      "```",
    ].join("\n"),
  };
}

export function helperPrompt(kind: "replan" | "next" | "breakdown", plan: Plan, taskId?: string): string {
  const current = exportPlan(plan).trimEnd();
  const ask =
    kind === "replan"
      ? "Re-plan the remaining (not done, not skipped) work so it is realistic from today, keeping finished work unchanged. Reply with the full updated plan in one code block, then WHAT CHANGED."
      : kind === "next"
        ? "Which 3 tasks should we work on next, and why? Prefer tasks that nothing is waiting on and that decide the finish date. Reply as a short numbered list with task IDs."
        : `Break task ${taskId ?? "<ID>"} into 3 to 8 concrete subtasks with realistic estimates. Reply with only that task's line and its indented subtasks in one code block.`;
  return [ask, "", SPEC(BRAND.formatKey), "", "CURRENT PLAN", "```", current, "```"].join("\n");
}

// ---------------------------------------------------------------- name redaction

/** Replaces people's names in place with "Owner A", "Owner B"...; returns placeholder → name. */
export function redactNames(plan: Plan): Record<string, string> {
  const map: Record<string, string> = {};
  const byName = new Map<string, string>();
  const label = (name: string) => {
    const k = name.toLowerCase();
    if (!byName.has(k)) {
      const ph = `Owner${placeholderLetter(byName.size)}`;
      byName.set(k, ph);
      map[ph] = name;
    }
    return byName.get(k)!;
  };
  plan.team = plan.team.map((m) => ({ name: label(m.name) }));
  for (const t of allTasks(plan)) {
    if (t.owner) t.owner = label(t.owner);
    if (t.done?.by) t.done.by = label(t.done.by);
    if (t.skipped?.by) t.skipped.by = label(t.skipped.by);
  }
  return map;
}

/** Puts real names back after an AI reply is parsed. Unknown placeholders are left as is. */
export function restoreNames(plan: Plan, map: Record<string, string>): void {
  const real = (n: string | undefined) => (n && map[n] ? map[n] : n);
  plan.team = plan.team.map((m) => ({ ...m, name: real(m.name)! }));
  for (const t of allTasks(plan)) {
    t.owner = real(t.owner);
    if (!t.owner) delete t.owner;
    if (t.done?.by) t.done.by = real(t.done.by);
    if (t.skipped?.by) t.skipped.by = real(t.skipped.by);
  }
}

function placeholderLetter(i: number): string {
  // OwnerA ... OwnerZ, OwnerAA ...: single tokens so they survive "@Owner" parsing.
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
