/**
 * Plan wizard for a fresh chat: a few plain questions on the site whose answers become
 * the project notes inside the planning prompt (generatePrompt({ source: "notes" })).
 * Only the "what" question is required; everything else is optional and skippable.
 */
import { generatePrompt } from "./prompts";

export interface WizardAnswers {
  /** "What are you planning?" (required) */
  project: string;
  /** "What does success look like?" */
  goal?: string;
  /** "When do you start?" YYYY-MM-DD */
  start?: string;
  /** "Is there a deadline?" free text or YYYY-MM-DD ("by spring", "2027-04-30") */
  deadline?: string;
  /** "Is there a budget?" free text ("$30k") */
  budget?: string;
  /** "Who is involved?" */
  people?: { name: string; role?: string }[];
  /** "Anything already done?" */
  alreadyDone?: string;
  /** "Anything that must happen, or must be avoided?" (permits, approvals, fixed dates, limits) */
  constraints?: string;
  /** "Anything else your AI should know?" */
  other?: string;
}

export interface WizardQuestion {
  key: keyof WizardAnswers;
  question: string;
  hint: string;
  required?: boolean;
}

/** Questions in the order the site asks them, one per screen on phones. */
export const WIZARD_QUESTIONS: readonly WizardQuestion[] = [
  { key: "project", question: "What are you planning?", hint: "A sentence or two is enough, e.g. \"Redo our kitchen: new cabinets, counters and wiring.\"", required: true },
  { key: "goal", question: "What does success look like?", hint: "How you'll know it worked, e.g. \"Kitchen usable, inspection passed, under budget.\"" },
  { key: "start", question: "When do you start?", hint: "Leave empty if you're not sure." },
  { key: "deadline", question: "Is there a deadline?", hint: "A date, or something like \"by spring\"." },
  { key: "budget", question: "Is there a budget?", hint: "e.g. \"$30k\". Leave empty if there isn't one." },
  { key: "people", question: "Who is involved?", hint: "First names and what they do. Leave empty if it's just you." },
  { key: "alreadyDone", question: "Is anything already done?", hint: "e.g. \"We have quotes from two contractors.\"" },
  { key: "constraints", question: "Anything that must happen, or must be avoided?", hint: "Permits, approvals, fixed dates, busy weeks, limits." },
  { key: "other", question: "Anything else your AI should know?", hint: "Optional." },
];

/** Turns wizard answers into plain project notes. Empty answers are left out. */
export function wizardNotes(a: WizardAnswers): string {
  const clean = (s?: string) => s?.replace(/\s+/g, " ").trim() ?? "";
  const lines: string[] = [];
  const add = (label: string, v?: string) => {
    const t = clean(v);
    if (t) lines.push(`${label}: ${t}`);
  };
  add("Project", a.project);
  add("Success looks like", a.goal);
  add("Start date", a.start);
  add("Deadline", a.deadline);
  add("Budget", a.budget);
  const people = (a.people ?? []).filter((p) => clean(p.name)).map((p) => (clean(p.role) ? `${clean(p.name)} (${clean(p.role)})` : clean(p.name)));
  if (people.length) lines.push(`People: ${people.join(", ")}`);
  add("Already done", a.alreadyDone);
  add("Must happen or be avoided", a.constraints);
  add("Other details", a.other);
  return lines.join("\n");
}

export function wizardPrompt(a: WizardAnswers): string {
  if (!clean(a.project)) throw new Error("The wizard needs at least a project description.");
  return generatePrompt({ source: "notes", notes: wizardNotes(a) });
}

function clean(s?: string): string {
  return s?.trim() ?? "";
}
