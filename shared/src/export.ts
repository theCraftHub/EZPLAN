/**
 * Writes a Plan back out in the EZPLAN format. `parsePlan(exportPlan(p))`
 * returns the same plan (the round-trip guarantee, covered by tests).
 */
import { FORMAT_VERSION, type Dependency, type Estimate, type Plan, type Subtask, type Task, type TaskStatus } from "./schema";

const BOX: Record<TaskStatus, string> = { todo: "[ ]", progress: "[/]", done: "[x]", skipped: "[-]" };

export function formatEstimate(e: Estimate): string {
  return `${trimNum(e.amount)}${e.unit}`;
}

export function formatDepends(deps: Dependency[]): string {
  return deps
    .map((d) => {
      let s = d.id;
      if (d.type !== "FS") s += ` ${d.type}`;
      if (d.lagDays !== 0) s += `${d.type === "FS" ? " " : ""}${d.lagDays > 0 ? "+" : ""}${trimNum(d.lagDays)}d`;
      return s;
    })
    .join(", ");
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** Front-matter values must stay on one line and not look like YAML syntax. */
function fmValue(v: string): string {
  const one = v.replace(/\s*\n\s*/g, " ").trim();
  // The parser strips one pair of matching outer quotes, so protect values that are already quoted.
  if (/^".*"$/.test(one)) return `'${one}'`;
  if (/^'.*'$/.test(one)) return `"${one}"`;
  return one;
}

function oneLine(v: string): string {
  return v.replace(/\s*\n\s*/g, " ").trim();
}

export interface ExportOptions {
  /** Adds a closing comment that comments, time logs and activity are app-only. */
  footer?: boolean;
}

export function exportPlan(plan: Plan, opts: ExportOptions = {}): string {
  const out: string[] = ["---", `ezplan: ${FORMAT_VERSION}`];
  if (plan.id) out.push(`id: ${fmValue(plan.id)}`);
  out.push(`title: ${fmValue(plan.title)}`);
  if (plan.goal) out.push(`goal: ${fmValue(plan.goal)}`);
  if (plan.doneWhen) out.push(`done_when: ${fmValue(plan.doneWhen)}`);
  if (plan.start) out.push(`start: ${plan.start}`);
  if (plan.currency) out.push(`currency: ${plan.currency}`);
  if (plan.team.length) out.push(`team: ${plan.team.map((m) => (m.email ? `${m.name} <${m.email}>` : m.name)).join(", ")}`);
  if (plan.baselineSet) out.push(`baseline_set: ${plan.baselineSet}`);
  if (plan.basedOn) out.push(`based_on: ${fmValue(plan.basedOn)}`);
  for (const [k, v] of Object.entries(plan.extra)) if (k !== "raid_section") out.push(`${k}: ${fmValue(v)}`);
  out.push("---");

  for (const phase of plan.phases) {
    out.push("", `## ${phase.id}: ${oneLine(phase.title)}`);
    if (phase.description) out.push(`> ${oneLine(phase.description)}`);
    if (phase.tasks.length) out.push("");
    for (const t of phase.tasks) out.push(...taskLines(t));
  }
  if (opts.footer) {
    out.push("", "<!-- Exported from EZPLAN. Comments, time logs and activity history stay in the app. -->");
  }
  return out.join("\n") + "\n";
}

function taskLines(t: Task): string[] {
  let line = `- ${BOX[t.status]} ${t.id}: ${oneLine(t.title)}`;
  if (t.estimate) line += ` (${formatEstimate(t.estimate)})`;
  if (t.milestone && !t.id.startsWith("M")) line += " (milestone)";
  if (t.owner) line += /\s/.test(t.owner) ? ` @"${t.owner}"` : ` @${t.owner}`;
  if (t.priority) line += ` !${t.priority}`;
  for (const tag of t.tags) line += ` #${tag}`;
  if (t.due) line += ` due: ${t.due}`;
  if (t.depends.length) line += ` depends: ${formatDepends(t.depends)}`;
  if (t.done) line += ` done: ${t.done.date}${t.done.by ? ` by ${t.done.by}` : ""}`;
  if (t.skipped) line += ` skipped: ${t.skipped.date}${t.skipped.by ? ` by ${t.skipped.by}` : ""}`;
  const lines = [line];
  if (t.planned) lines.push(`  planned: ${t.planned.start} → ${t.planned.end}`);
  for (const n of t.notes) lines.push(`  notes: ${oneLine(n)}`);
  for (const [k, v] of Object.entries(t.extra)) lines.push(`  ${k}: ${oneLine(v)}`);
  for (const s of t.subtasks) lines.push(subtaskLine(s));
  return lines;
}

function subtaskLine(s: Subtask): string {
  return `  - ${BOX[s.status]} ${oneLine(s.title)}`;
}
