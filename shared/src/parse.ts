/**
 * Parser for the EZPLAN format (see docs/format.md).
 *
 * Two modes:
 *  - strict: the text has an `ezplan:` front-matter block. Rules follow the spec,
 *    with forgiving handling of the ways AI assistants format output.
 *  - tolerant: plain markdown (any checklist / headings). Headings become phases,
 *    list items become tasks, and missing IDs are assigned.
 *
 * The parser never throws on bad input: it returns the best plan it could build
 * plus line-numbered issues the UI shows as friendly hints.
 */
import {
  FORMAT_VERSION,
  type Attribution,
  type Dependency,
  type DependencyType,
  type Estimate,
  type EstimateUnit,
  type Phase,
  type Plan,
  type Priority,
  type Subtask,
  type Task,
  type TaskStatus,
  type TeamMember,
} from "./schema";

export interface ParseIssue {
  /** 1-based line number in the original text, when known. */
  line?: number;
  severity: "error" | "warning";
  message: string;
}

export interface ParseResult {
  plan: Plan;
  issues: ParseIssue[];
  mode: "strict" | "tolerant";
}

export const LIMITS = {
  maxBytes: 1_000_000,
  maxLines: 20_000,
  maxTasks: 5_000,
  maxFieldLength: 2_000,
};

const KNOWN_FRONT_MATTER = new Set([
  "ezplan",
  "id",
  "title",
  "goal",
  "done_when",
  "start",
  "team",
  "baseline_set",
  "currency",
  "based_on",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Line {
  /** 1-based line number in the original text. */
  n: number;
  text: string;
}

export function parsePlan(input: string): ParseResult {
  const issues: ParseIssue[] = [];
  const lines = preprocess(input, issues);
  const fm = findFrontMatter(lines);
  if (fm) {
    if (fm.start > 0 && lines.slice(0, fm.start).some((l) => l.text.trim() !== "")) {
      issues.push({ line: lines[0]?.n, severity: "warning", message: "Text before the plan was ignored (for example an assistant's introduction)." });
    }
    const plan = emptyPlan();
    readFrontMatter(lines.slice(fm.start + 1, fm.end), plan, issues);
    readBody(lines.slice(fm.end + 1), plan, issues, true);
    finalize(plan, issues);
    return { plan, issues, mode: "strict" };
  }
  const plan = emptyPlan();
  readBody(lines, plan, issues, false);
  finalize(plan, issues);
  issues.push({ severity: "warning", message: "This isn't in EZPLAN format, so it was read as a plain checklist. Add a goal so the Plan Check has something to measure against." });
  return { plan, issues, mode: "tolerant" };
}

function emptyPlan(): Plan {
  return { version: FORMAT_VERSION, title: "", team: [], phases: [], extra: {} };
}

// ---------------------------------------------------------------- preprocessing

/** Zero-width and bidi control characters that can hide text from people. */
const INVISIBLE_RE = /[​-‏‪-‮⁠-⁤﻿]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function preprocess(input: string, issues: ParseIssue[]): Line[] {
  let text = input;
  if (text.length > LIMITS.maxBytes) {
    issues.push({ severity: "error", message: `The text is too long (over ${LIMITS.maxBytes.toLocaleString("en-US")} characters). Only the first part was read.` });
    text = text.slice(0, LIMITS.maxBytes);
  }
  text = text.replace(/\r\n?/g, "\n");
  if (INVISIBLE_RE.test(text)) {
    issues.push({ severity: "warning", message: "Hidden characters were removed." });
    text = text.replace(INVISIBLE_RE, "");
  }
  text = text.replace(CONTROL_RE, "");
  let raw = text.split("\n").map((t, i) => ({ n: i + 1, text: t }));
  if (raw.length > LIMITS.maxLines) {
    issues.push({ severity: "error", message: `The text has too many lines (over ${LIMITS.maxLines.toLocaleString("en-US")}). Only the first part was read.` });
    raw = raw.slice(0, LIMITS.maxLines);
  }
  return unwrapFence(raw);
}

/** If the plan is inside a ``` code block (common in AI replies), keep only that block. */
function unwrapFence(lines: Line[]): Line[] {
  const opens: number[] = [];
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l.text)) opens.push(i);
  });
  for (let k = 0; k + 1 < opens.length; k += 2) {
    const a = opens[k]!;
    const b = opens[k + 1]!;
    const inner = lines.slice(a + 1, b);
    if (inner.some((l) => /^\s*ezplan\s*:/i.test(l.text) || /^\s*-\s*\[.\]/.test(l.text))) return inner;
  }
  return lines;
}

function findFrontMatter(lines: Line[]): { start: number; end: number } | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.text.trim() !== "---") continue;
    const next = lines.slice(i + 1, i + 40);
    const endRel = next.findIndex((l) => l.text.trim() === "---");
    if (endRel < 0) continue;
    if (next.slice(0, endRel).some((l) => /^\s*ezplan\s*:/i.test(l.text))) return { start: i, end: i + 1 + endRel };
  }
  return null;
}

// ---------------------------------------------------------------- front matter

function readFrontMatter(lines: Line[], plan: Plan, issues: ParseIssue[]): void {
  for (const l of lines) {
    const t = l.text.trim();
    if (!t || t.startsWith("#")) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(t);
    if (!m) {
      issues.push({ line: l.n, severity: "warning", message: `Couldn't read this line in the header: "${clip(t)}".` });
      continue;
    }
    const key = m[1]!.toLowerCase().replace(/-/g, "_");
    const rawValue = stripQuotes(m[2]!.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
    const value = cleanText(rawValue, l.n, issues);
    switch (key) {
      case "ezplan": {
        const v = Number(value);
        if (!Number.isInteger(v) || v < 1) issues.push({ line: l.n, severity: "warning", message: `Unknown format version "${value}", read as version 1.` });
        else if (v > FORMAT_VERSION) issues.push({ line: l.n, severity: "warning", message: `This file uses a newer format (version ${v}); some details may not be shown.` });
        break;
      }
      case "id": plan.id = value; break;
      case "title": plan.title = value; break;
      case "goal": plan.goal = value; break;
      case "done_when": plan.doneWhen = value; break;
      case "currency": plan.currency = value.toUpperCase(); break;
      case "based_on": plan.basedOn = value; break;
      case "start":
      case "baseline_set": {
        const d = normalizeDate(value);
        if (!d) issues.push({ line: l.n, severity: "warning", message: `"${value}" isn't a date like 2026-12-01, so it was skipped.` });
        else if (key === "start") plan.start = d;
        else plan.baselineSet = d;
        break;
      }
      case "team": plan.team = parseTeam(rawValue).map((m) => ({ ...m, name: cleanText(m.name, l.n, issues) })); break;
      default:
        if (!KNOWN_FRONT_MATTER.has(key)) plan.extra[key] = value;
    }
  }
  if (!plan.title) issues.push({ severity: "warning", message: "The plan has no title." });
}

function parseTeam(value: string): TeamMember[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(.*?)\s*<([^>]+)>$/.exec(s);
      return m ? { name: m[1]!.trim(), email: m[2]!.trim() } : { name: s };
    });
}

// ---------------------------------------------------------------- body

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET_RE = /^(\s*)(?:[-*+•]|\d+[.)])\s+(.*)$/;
const CHECKBOX_RE = /^(?:\[( |x|X|\/|-|~|>)\]|(☐|⬜|□)|(☑|✅|✔️?|☒|✓))\s*/;
const TASK_ID_RE = /^(?:\*\*|__)?\s*([TtMm])(\d+)\s*[:.)\-–]\s*/;
const PHASE_ID_RE = /^(?:P(\d+)|Phase\s+(\d+))\s*[:.)\-–]\s*(.*)$/i;
const ATTR_LINE_RE = /^(planned|notes?|due|depends|owner|done|skipped|priority|tags?)\s*:\s*(.*)$/i;
/** Unknown attributes written by newer versions: lower_snake_case keys only, so ordinary notes aren't mistaken for them. */
const EXTRA_ATTR_RE = /^([a-z][a-z0-9_]{1,29})\s*:\s+(.+)$/;
const INLINE_KEYS = ["due", "depends", "done", "skipped", "after"] as const;

function readBody(lines: Line[], plan: Plan, issues: ParseIssue[], strict: boolean): void {
  let phase: Phase | null = null;
  let task: Task | null = null;
  let taskIndent = 0;
  let taskCount = 0;
  let sawTitleHeading = false;
  let trailingIgnored = 0;

  const ensurePhase = (n?: number): Phase => {
    if (!phase) {
      phase = { id: "", title: plan.phases.length === 0 ? "Tasks" : `Phase ${plan.phases.length + 1}`, tasks: [] };
      plan.phases.push(phase);
      if (strict && n) issues.push({ line: n, severity: "warning", message: "Tasks before the first phase heading were put in a phase called \"Tasks\"." });
    }
    return phase;
  };

  for (const l of lines) {
    const raw = l.text;
    if (!raw.trim()) continue;

    const h = HEADING_RE.exec(raw);
    if (h) {
      const level = h[1]!.length;
      const text = stripEmphasis(h[2]!);
      if (!strict && level === 1 && !sawTitleHeading && !plan.title) {
        plan.title = cleanText(text, l.n, issues);
        sawTitleHeading = true;
        continue;
      }
      if (/^raid\b/i.test(text)) {
        // RAID sections are reserved for a later version; keep them out of the task list.
        phase = null;
        task = null;
        plan.extra["raid_section"] = "present";
        continue;
      }
      const pm = PHASE_ID_RE.exec(text);
      const id = pm ? `P${pm[1] ?? pm[2]}` : "";
      const title = cleanText(pm ? pm[3]!.trim() || `Phase ${pm[1] ?? pm[2]}` : text, l.n, issues);
      phase = { id, title, tasks: [] };
      plan.phases.push(phase);
      task = null;
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(raw);
    if (quote && phase && phase.tasks.length === 0) {
      const d = cleanText(quote[1]!, l.n, issues);
      phase.description = phase.description ? `${phase.description} ${d}` : d;
      continue;
    }

    const b = BULLET_RE.exec(raw);
    const indent = b ? indentWidth(b[1]!) : indentWidth(/^\s*/.exec(raw)![0]);
    const content = b ? b[2]! : raw.trim();

    // Attribute lines under a task (indented, with or without a bullet).
    if (task && indent > taskIndent) {
      const am = ATTR_LINE_RE.exec(stripEmphasis(content)) ?? (b ? null : EXTRA_ATTR_RE.exec(content));
      if (am && !CHECKBOX_RE.test(content)) {
        applyAttributeLine(task, am[1]!.toLowerCase(), am[2]!, l.n, issues);
        continue;
      }
      if (b) {
        task.subtasks.push(parseSubtask(content, l.n, issues));
        continue;
      }
      // Indented continuation text: treat as a note.
      task.notes.push(cleanText(content, l.n, issues));
      continue;
    }

    if (b) {
      if (taskCount >= LIMITS.maxTasks) {
        if (taskCount === LIMITS.maxTasks) issues.push({ line: l.n, severity: "error", message: `Too many tasks (over ${LIMITS.maxTasks.toLocaleString("en-US")}). The rest were skipped.` });
        taskCount++;
        continue;
      }
      const p = ensurePhase(l.n);
      task = parseTaskLine(content, l.n, issues);
      taskIndent = indent;
      p.tasks.push(task);
      taskCount++;
      trailingIgnored = 0;
      continue;
    }

    // Plain paragraph text outside a task.
    trailingIgnored++;
    if (trailingIgnored === 1) issues.push({ line: l.n, severity: "warning", message: `Ignored text that isn't a phase or task: "${clip(raw.trim())}".` });
  }
}

function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === "\t" ? 4 : 1;
  return w;
}

function readStatus(content: string): { status: TaskStatus | null; rest: string } {
  const m = CHECKBOX_RE.exec(content);
  if (!m) return { status: null, rest: content };
  const rest = content.slice(m[0].length);
  if (m[3]) return { status: "done", rest };
  if (m[2]) return { status: "todo", rest };
  const c = m[1]!;
  const status: TaskStatus = c === "x" || c === "X" ? "done" : c === "/" || c === ">" ? "progress" : c === "-" || c === "~" ? "skipped" : "todo";
  return { status, rest };
}

function parseSubtask(content: string, n: number, issues: ParseIssue[]): Subtask {
  const { status, rest } = readStatus(content);
  return { title: cleanText(stripEmphasis(rest), n, issues), status: status ?? "todo" };
}

function newTask(): Task {
  return { id: "", title: "", status: "todo", milestone: false, depends: [], notes: [], tags: [], subtasks: [], extra: {} };
}

function parseTaskLine(content: string, n: number, issues: ParseIssue[]): Task {
  const t = newTask();
  const { status, rest: afterBox } = readStatus(content.trim());
  t.status = status ?? "todo";
  let rest = afterBox.replace(/\*\*|__/g, "").trim();

  const idm = TASK_ID_RE.exec(rest);
  if (idm) {
    t.id = `${idm[1]!.toUpperCase()}${idm[2]}`;
    if (idm[1]!.toUpperCase() === "M") t.milestone = true;
    rest = rest.slice(idm[0].length);
  }

  // Split off inline keyword attributes (due:, depends:, done:, skipped:, after).
  const { head, attrs } = splitInlineAttributes(rest);
  let title = head;

  title = title.replace(/\((?:milestone)\)/i, () => {
    t.milestone = true;
    return " ";
  });
  title = title.replace(/(^|\s)@"([^"]+)"/g, (_w, pre: string, name: string) => {
    t.owner ??= name.trim();
    return pre;
  });
  title = title.replace(/(^|\s)@([A-Za-z][\w.'-]*)/g, (w, pre: string, name: string) => {
    if (t.owner) return w;
    t.owner = name.replace(/[.,;]+$/, "");
    return pre;
  });
  title = title.replace(/(^|\s)#([A-Za-z][\w-]*)/g, (_w, pre: string, tag: string) => {
    t.tags.push(tag.toLowerCase());
    return pre;
  });
  title = title.replace(/(^|\s)!(high|medium|low)\b/gi, (_w, pre: string, p: string) => {
    t.priority = p.toLowerCase() as Priority;
    return pre;
  });
  title = title.replace(/\(([^()]*)\)/g, (whole, inner: string) => {
    if (t.estimate) return whole;
    const e = parseEstimate(inner);
    if (!e) return whole;
    t.estimate = e;
    return " ";
  });
  // A trailing estimate without parentheses, e.g. "Book venue 3d".
  if (!t.estimate) {
    title = title.replace(/\s(\d+(?:\.\d+)?\s?(?:h|hrs?|hours?|d|days?|w|wks?|weeks?))\s*$/i, (w, est: string) => {
      const e = parseEstimate(est);
      if (!e) return w;
      t.estimate = e;
      return " ";
    });
  }

  t.title = cleanText(stripEmphasis(title).replace(/\s+/g, " ").trim(), n, issues);
  if (!t.title) issues.push({ line: n, severity: "warning", message: "A task has no title." });

  for (const a of attrs) applyAttributeLine(t, a.key, a.value, n, issues);
  return t;
}

function splitInlineAttributes(text: string): { head: string; attrs: { key: string; value: string }[] } {
  const re = new RegExp(`(^|\\s)(${INLINE_KEYS.join("|")})(?=\\s*:|\\s+[TtMm]\\d)`, "gi");
  const marks: { key: string; start: number; valueStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const keyStart = m.index + m[1]!.length;
    let valueStart = keyStart + m[2]!.length;
    const colon = /^\s*:/.exec(text.slice(valueStart));
    if (colon) valueStart += colon[0].length;
    marks.push({ key: m[2]!.toLowerCase(), start: keyStart, valueStart });
  }
  if (marks.length === 0) return { head: text, attrs: [] };
  const head = text.slice(0, marks[0]!.start);
  const attrs = marks.map((mk, i) => ({
    key: mk.key === "after" ? "depends" : mk.key,
    value: text.slice(mk.valueStart, i + 1 < marks.length ? marks[i + 1]!.start : undefined).trim(),
  }));
  return { head, attrs };
}

function applyAttributeLine(t: Task, key: string, value: string, n: number, issues: ParseIssue[]): void {
  const v = value.trim();
  switch (key) {
    case "planned": {
      const m = /^(\S+)\s*(?:→|->|–|—|to|-)\s*(\S+)$/i.exec(v);
      const a = m ? normalizeDate(m[1]!) : null;
      const b = m ? normalizeDate(m[2]!) : null;
      if (a && b) t.planned = { start: a, end: b };
      else issues.push({ line: n, severity: "warning", message: `Couldn't read the planned dates "${clip(v)}". Use: planned: 2026-12-03 → 2026-12-09.` });
      break;
    }
    case "note":
    case "notes":
      if (v) t.notes.push(cleanText(v, n, issues));
      break;
    case "due": {
      const d = normalizeDate(v);
      if (d) t.due = d;
      else issues.push({ line: n, severity: "warning", message: `"${clip(v)}" isn't a due date like 2026-12-10, so it was skipped.` });
      break;
    }
    case "depends":
      for (const d of parseDepends(v)) if (!t.depends.some((x) => x.id === d.id)) t.depends.push(d);
      if (v && t.depends.length === 0) issues.push({ line: n, severity: "warning", message: `Couldn't read "depends: ${clip(v)}". Use task IDs like T1, T2.` });
      break;
    case "owner":
      t.owner = v.replace(/^@/, "");
      break;
    case "priority": {
      const p = v.toLowerCase();
      if (p === "high" || p === "medium" || p === "low") t.priority = p;
      break;
    }
    case "tag":
    case "tags":
      for (const tag of v.split(/[,\s]+/).map((x) => x.replace(/^#/, "").toLowerCase()).filter(Boolean)) if (!t.tags.includes(tag)) t.tags.push(tag);
      break;
    case "done":
    case "skipped": {
      const a = parseAttribution(v);
      if (!a) {
        issues.push({ line: n, severity: "warning", message: `Couldn't read "${key}: ${clip(v)}". Use: ${key}: 2026-12-02 by Ana.` });
        break;
      }
      if (key === "done") t.done = a;
      else t.skipped = a;
      break;
    }
    default:
      t.extra[key] = v;
  }
}

export function parseEstimate(text: string): Estimate | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|d|days?|w|wks?|weeks?)\s*$/i.exec(text);
  if (!m) return undefined;
  const amount = Number(m[1]);
  if (!(amount > 0)) return undefined;
  const u = m[2]!.toLowerCase();
  const unit: EstimateUnit = u.startsWith("h") ? "h" : u.startsWith("w") ? "w" : "d";
  return { amount, unit };
}

export function parseDepends(text: string): Dependency[] {
  const out: Dependency[] = [];
  const re = /\b([TtMm]\d+)\b(?:\s*(FS|SS|FF))?(?:\s*([+-]\s*\d+(?:\.\d+)?)\s*d?)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({
      id: m[1]!.toUpperCase(),
      type: ((m[2] ?? "FS").toUpperCase() as DependencyType),
      lagDays: m[3] ? Number(m[3].replace(/\s/g, "")) : 0,
    });
  }
  return out;
}

function parseAttribution(text: string): Attribution | null {
  const m = /^(\S+)(?:\s+by\s+(.+))?$/i.exec(text.trim());
  if (!m) return null;
  const date = normalizeDate(m[1]!);
  if (!date) return null;
  const by = m[2]?.trim().replace(/^@/, "");
  return by ? { date, by } : { date };
}

export function normalizeDate(text: string): string | null {
  const t = text.trim().replace(/[.,;]+$/, "");
  if (DATE_RE.test(t)) return isRealDate(t) ? t : null;
  const m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(t);
  if (m) {
    const d = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
    return isRealDate(d) ? d : null;
  }
  return null;
}

function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

// ---------------------------------------------------------------- cleanup

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function stripEmphasis(s: string): string {
  return s.replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(^|\s)[*_](\S(?:.*?\S)?)[*_](?=\s|$)/g, "$1$2").trim();
}

/** Removes markup that could run or hide content; keeps the visible words. */
function cleanText(s: string, n: number, issues: ParseIssue[]): string {
  let t = s;
  if (/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>/i.test(t)) {
    issues.push({ line: n, severity: "warning", message: "HTML tags were removed from this line." });
    t = t.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "").replace(/<[^>]*>/g, "");
  }
  if (/\b(?:javascript|data|vbscript)\s*:/i.test(t)) {
    issues.push({ line: n, severity: "warning", message: "An unsafe link was removed from this line." });
    t = t.replace(/\b(?:javascript|data|vbscript)\s*:[^\s)]*/gi, "");
  }
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
  if (t.length > LIMITS.maxFieldLength) {
    issues.push({ line: n, severity: "warning", message: "A very long line was shortened." });
    t = t.slice(0, LIMITS.maxFieldLength);
  }
  return t;
}

function clip(s: string): string {
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

// ---------------------------------------------------------------- finalize

/** Assigns missing phase/task IDs (P1.., T1.., M1..) without reusing existing ones. */
function finalize(plan: Plan, issues: ParseIssue[]): void {
  plan.phases = plan.phases.filter((p) => p.tasks.length > 0 || p.title || p.description);
  const usedP = new Set(plan.phases.map((p) => p.id).filter(Boolean));
  let pi = 1;
  for (const p of plan.phases) {
    if (p.id) continue;
    while (usedP.has(`P${pi}`)) pi++;
    p.id = `P${pi}`;
    usedP.add(p.id);
  }
  const used = new Set<string>();
  for (const t of plan.phases.flatMap((p) => p.tasks)) if (t.id) used.add(t.id);
  let ti = 1;
  let mi = 1;
  let assigned = 0;
  for (const t of plan.phases.flatMap((p) => p.tasks)) {
    if (t.id) continue;
    if (t.milestone) {
      while (used.has(`M${mi}`)) mi++;
      t.id = `M${mi}`;
    } else {
      while (used.has(`T${ti}`)) ti++;
      t.id = `T${ti}`;
    }
    used.add(t.id);
    assigned++;
  }
  if (assigned > 0) issues.push({ severity: "warning", message: `${assigned} task${assigned === 1 ? "" : "s"} had no ID, so one was added.` });
  if (!plan.title) plan.title = "Untitled plan";
}
