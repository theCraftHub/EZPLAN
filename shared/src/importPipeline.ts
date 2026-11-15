/**
 * One pipeline for every way a plan comes in (paste, upload, "open with",
 * share target, API/connector, AI update replies):
 *   validate → sanitize + parse → detect injection / sensitive data → moderate → preview
 * Nothing is saved here; the caller shows the preview and saves only if the
 * user accepts and moderation allows it. See plan section 4c.
 */
import { checkPlan, type PlanCheckResult } from "./checks";
import { FILE_EXTENSIONS } from "./brand";
import { parsePlan, type ParseIssue } from "./parse";
import { allTasks, type Plan } from "./schema";

export type ImportSource = "paste" | "upload" | "fileHandler" | "shareTarget" | "api" | "aiUpdate";

export interface ImportInput {
  source: ImportSource;
  /** Text as pasted, or file bytes for uploads. */
  text?: string;
  bytes?: Uint8Array;
  fileName?: string;
}

export interface ImportContext {
  /** Display name of the signed-in person importing. */
  importerName: string;
  /** Plan IDs the importer is allowed to edit. A file can only update one of these. */
  editablePlanIds: ReadonlySet<string>;
  /** Names of people already on the project/workspace (matched case-insensitively). */
  memberNames: readonly string[];
  today: string;
  /** Moderation hook: free checks run always; the server plugs in the AI classifier. */
  moderate?: (text: string) => Promise<ModerationVerdict>;
}

export interface ModerationVerdict {
  verdict: "allow" | "review" | "block";
  category?: string;
  reason?: string;
}

export interface ImportPreview {
  ok: boolean;
  /** Present when ok; never saved by this function. */
  plan?: Plan;
  /** "update" only when the file's id is a plan the importer can edit. */
  action: "create" | "update";
  parseIssues: ParseIssue[];
  /** Plain-language notes shown on the preview screen. */
  notices: string[];
  check?: PlanCheckResult;
  moderation: ModerationVerdict;
  /** Text aimed at AI assistants that was found (and will be neutralized before any AI call). */
  injectionFlags: string[];
  /** Possible card or ID numbers the user is offered to remove. */
  sensitiveFlags: { kind: "card" | "us-ssn"; taskIds: string[] }[];
  /** People named in the file who aren't members: suggestions to invite, never automatic. */
  suggestedPeople: string[];
  /** Tasks ticked done in the file with no "by": credited to the importer. */
  creditedToImporter: string[];
  /** "by" names from the file that don't match a member: shown as "from file". */
  unverifiedAttributions: string[];
  mode?: "strict" | "tolerant";
}

export const IMPORT_LIMITS = { maxBytes: 1_000_000 };

const TEXT_EXTENSIONS = [...FILE_EXTENSIONS, ".md", ".markdown", ".txt"];

export async function importPlan(input: ImportInput, ctx: ImportContext): Promise<ImportPreview> {
  const notices: string[] = [];
  const fail = (msg: string, verdict: ModerationVerdict = { verdict: "allow" }): ImportPreview => ({
    ok: false,
    action: "create",
    parseIssues: [],
    notices: [msg],
    moderation: verdict,
    injectionFlags: [],
    sensitiveFlags: [],
    suggestedPeople: [],
    creditedToImporter: [],
    unverifiedAttributions: [],
  });

  // ---- validate
  if (input.fileName && !TEXT_EXTENSIONS.some((ext) => input.fileName!.toLowerCase().endsWith(ext))) {
    return fail(`"${input.fileName}" isn't a plan or text file. Use ${TEXT_EXTENSIONS.join(", ")}.`);
  }
  let text = input.text ?? "";
  if (input.bytes) {
    if (input.bytes.length > IMPORT_LIMITS.maxBytes) return fail("This file is too large (over 1 MB).");
    if (looksBinary(input.bytes)) return fail("This file isn't text, so it can't be a plan.");
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
    } catch {
      return fail("This file isn't readable text (it must be saved as UTF-8).");
    }
  } else if (text.length > IMPORT_LIMITS.maxBytes) {
    return fail("This text is too long (over 1,000,000 characters).");
  }
  if (!text.trim()) return fail("There's nothing to import.");

  // ---- sanitize + parse (parse.ts strips HTML, unsafe links and hidden characters)
  const { plan, issues, mode } = parsePlan(text);

  // ---- free checks: injection and sensitive data
  const injectionFlags = detectInjection(text);
  if (injectionFlags.length) notices.push("This file contains instructions aimed at AI assistants. They're kept as plain text and never followed.");
  const sensitiveFlags = detectSensitive(plan);
  if (sensitiveFlags.length) notices.push("This plan seems to contain a card number or ID number. You can remove it before saving.");

  // ---- moderation (free keyword check first, then the server's classifier if provided)
  const free = freeModeration(text);
  let moderation = free;
  if (free.verdict !== "block" && ctx.moderate) {
    const ai = await ctx.moderate(text);
    moderation = rank(ai) > rank(free) ? ai : free;
  }
  if (moderation.verdict === "block") {
    return { ...fail("This plan can't be imported because it breaks the Acceptable Use Policy.", moderation), parseIssues: issues, mode };
  }
  if (moderation.verdict === "review") notices.push("This plan will be saved privately and checked by our team before it can be shared or exported.");

  // ---- trust rules: files can't claim access, identity or other people's plans
  let action: "create" | "update" = "create";
  if (plan.id && ctx.editablePlanIds.has(plan.id)) action = "update";
  else if (plan.id) {
    notices.push("This file belongs to a plan you can't edit, so it will be saved as a new plan.");
    delete plan.id;
  }
  const members = new Set(ctx.memberNames.map((n) => n.toLowerCase()));
  const named = new Set<string>();
  for (const m of plan.team) named.add(m.name);
  for (const t of allTasks(plan)) if (t.owner) named.add(t.owner);
  const suggestedPeople = [...named].filter((n) => !members.has(n.toLowerCase()));
  if (suggestedPeople.length) notices.push(`People named in the file aren't invited automatically: ${suggestedPeople.join(", ")}. You can invite them after saving.`);

  const creditedToImporter: string[] = [];
  const unverifiedAttributions: string[] = [];
  for (const t of allTasks(plan)) {
    for (const key of ["done", "skipped"] as const) {
      const a = t[key];
      const shouldHave = (key === "done" && t.status === "done") || (key === "skipped" && t.status === "skipped");
      if (shouldHave && !a) {
        t[key] = { date: ctx.today, by: ctx.importerName };
        creditedToImporter.push(t.id);
      } else if (a?.by && !members.has(a.by.toLowerCase())) {
        unverifiedAttributions.push(t.id);
      }
    }
  }
  if (creditedToImporter.length) notices.push(`${creditedToImporter.length} task${creditedToImporter.length === 1 ? " was" : "s were"} ticked done in the file without a name, so ${creditedToImporter.length === 1 ? "it's" : "they're"} credited to you (via file import).`);
  if (unverifiedAttributions.length) notices.push('Some "done by" names in the file don\'t match anyone on the project; they\'re shown as "from file".');

  return {
    ok: true,
    plan,
    action,
    parseIssues: issues,
    notices,
    check: checkPlan(plan, { today: ctx.today }),
    moderation,
    injectionFlags,
    sensitiveFlags,
    suggestedPeople,
    creditedToImporter,
    unverifiedAttributions,
    mode,
  };
}

function rank(v: ModerationVerdict): number {
  return v.verdict === "block" ? 2 : v.verdict === "review" ? 1 : 0;
}

export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) odd++;
  }
  return n > 0 && odd / n > 0.1;
}

// ---------------------------------------------------------------- injection

const INJECTION_PATTERNS: [string, RegExp][] = [
  ["ignore previous instructions", /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all)\b[^.\n]{0,20}\b(instructions?|rules|prompts?)\b/i],
  ["role change", /\byou are now\b|\bact as (an? )?(admin|system|developer)\b/i],
  ["fake system message", /^\s*(system|assistant)\s*:/im],
  ["chat-format tokens", /<\|(im_start|im_end|system|endoftext)\|>|\[\/?INST\]|<<SYS>>/i],
  ["prompt extraction", /\b(reveal|print|show|repeat)\b[^.\n]{0,30}\b(system prompt|hidden instructions|your instructions)\b/i],
  ["tool or data access", /\b(call|use|invoke)\b[^.\n]{0,20}\b(tool|function|api)\b[^.\n]{0,40}\b(other users?|all plans|database|secrets?|api keys?)\b/i],
];

/** Free check for text aimed at AI models. Returns the kinds found. */
export function detectInjection(text: string): string[] {
  return INJECTION_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

// ---------------------------------------------------------------- sensitive data

export function detectSensitive(plan: Plan): { kind: "card" | "us-ssn"; taskIds: string[] }[] {
  const card: string[] = [];
  const ssn: string[] = [];
  for (const t of allTasks(plan)) {
    const text = [t.title, ...t.notes, ...t.subtasks.map((s) => s.title)].join(" ");
    for (const m of text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? []) if (luhn(m.replace(/\D/g, ""))) card.push(t.id);
    if (/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/.test(text)) ssn.push(t.id);
  }
  const out: { kind: "card" | "us-ssn"; taskIds: string[] }[] = [];
  if (card.length) out.push({ kind: "card", taskIds: [...new Set(card)] });
  if (ssn.length) out.push({ kind: "us-ssn", taskIds: [...new Set(ssn)] });
  return out;
}

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------- free moderation

/**
 * Deliberately narrow keyword checks: only phrases that are unambiguous in any
 * planning context. Everything else is left to the AI classifier, so legitimate
 * plans (security audits, fireworks permits, pharmacy projects) aren't blocked.
 */
const FREE_BLOCK: [string, RegExp][] = [
  ["child-safety", /\b(child|minor|underage)\b[^.\n]{0,40}\b(sexual|porn|nude|explicit)\b/i],
  ["weapons-mass-harm", /\b(build|make|assemble|synthesi[sz]e)\b[^.\n]{0,30}\b(bomb|explosive device|nerve agent|bioweapon|chemical weapon)\b/i],
];
const FREE_REVIEW: [string, RegExp][] = [
  ["violence", /\b(kill|murder|assassinate|kidnap)\b[^.\n]{0,40}\b(him|her|them|my|the (boss|neighbor|teacher)|someone)\b/i],
  ["fraud", /\b(launder (the )?money|fake (ids?|invoices?|passports?)|phishing (kit|campaign)|steal (credit cards?|identities))\b/i],
  ["malware", /\b(ransomware|keylogger|botnet)\b[^.\n]{0,30}\b(deploy|spread|build|write)\b|\b(deploy|spread|build|write)\b[^.\n]{0,30}\b(ransomware|keylogger|botnet)\b/i],
];

export function freeModeration(text: string): ModerationVerdict {
  for (const [category, re] of FREE_BLOCK) if (re.test(text)) return { verdict: "block", category, reason: "free check" };
  for (const [category, re] of FREE_REVIEW) if (re.test(text)) return { verdict: "review", category, reason: "free check" };
  return { verdict: "allow" };
}
