/**
 * Quick-add: one line of plain text becomes a task, no AI involved.
 *   "Book venue 3d @Ana due Fri after T1 #venue !high"
 * Estimate (2h, 3d, 1w), @owner, due <date|today|tomorrow|weekday>, after/depends <IDs>,
 * #tags, !low/!medium/!high (or !, !!, !!!), and "milestone". Everything else is the title.
 */
import { Calendar } from "./calendar";
import { normalizeDate, parseDepends, parseEstimate } from "./parse";
import { allTasks, type Plan, type Priority, type Task } from "./schema";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** The next date (after today) that falls on the given weekday. */
function nextWeekday(today: string, name: string): string | null {
  const i = DAYS.indexOf(name.slice(0, 3).toLowerCase());
  if (i < 0) return null;
  const d = new Date(`${today}T12:00:00Z`);
  const step = ((i - d.getUTCDay() + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + step);
  return d.toISOString().slice(0, 10);
}

function dueFrom(word: string, today: string): string | null {
  const w = word.toLowerCase();
  if (w === "today") return today;
  if (w === "tomorrow") return new Calendar({ workdays: [0, 1, 2, 3, 4, 5, 6] }).dateAt(today, 1);
  if (/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.test(w)) return nextWeekday(today, w);
  return normalizeDate(word);
}

/** The next free task ID ("T7" after T1..T6; milestones get "M"). */
export function nextTaskId(plan: Plan, milestone = false): string {
  const prefix = milestone ? "M" : "T";
  const used = new Set(allTasks(plan).map((t) => t.id.toUpperCase()));
  let n = allTasks(plan).filter((t) => t.id.toUpperCase().startsWith(prefix)).length + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export interface QuickAddResult {
  task: Task;
  /** Words we understood, for a "we read this as" hint under the box. */
  understood: string[];
}

export function parseQuickAdd(line: string, plan: Plan, today: string): QuickAddResult | null {
  const words = line.trim().split(/\s+/).filter(Boolean);
  const title: string[] = [];
  const understood: string[] = [];
  let owner: string | undefined;
  let due: string | undefined;
  let priority: Priority | undefined;
  let milestone = false;
  const tags: string[] = [];
  const depends: Task["depends"] = [];
  let estimate: Task["estimate"];
  const known = new Set(allTasks(plan).map((t) => t.id.toUpperCase()));

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    if (/^@\S+$/.test(w) && w.length > 1) {
      owner = w.slice(1);
      understood.push(`owner ${owner}`);
    } else if (/^#[\p{L}\p{N}_-]+$/u.test(w)) {
      tags.push(w.slice(1));
    } else if (/^!(low|medium|high|!{0,2})$/i.test(w)) {
      const v = w.slice(1).toLowerCase();
      priority = v === "low" ? "low" : v === "medium" || v === "!" ? "medium" : v === "" ? "low" : "high";
      if (v === "!!") priority = "high";
      understood.push(`${priority} priority`);
    } else if (/^(due|by)$/i.test(w) && next && dueFrom(next, today)) {
      due = dueFrom(next, today)!;
      understood.push(`due ${due}`);
      i++;
    } else if (/^(after|depends:?)$/i.test(w) && next) {
      let j = i + 1;
      while (j < words.length && /^[TtMm]\d+,?$/.test(words[j]!)) j++;
      const deps = parseDepends(words.slice(i + 1, j).join(" ")).filter((d) => known.has(d.id));
      if (!deps.length) {
        title.push(w);
        continue;
      }
      depends.push(...deps);
      understood.push(`after ${deps.map((d) => d.id).join(", ")}`);
      i = j - 1;
    } else if (!estimate && parseEstimate(w)) {
      estimate = parseEstimate(w);
      understood.push(`takes ${w}`);
    } else if (/^milestone$/i.test(w) || /^\(milestone\)$/i.test(w)) {
      milestone = true;
      understood.push("milestone");
    } else {
      title.push(w);
    }
  }
  const text = title.join(" ").trim();
  if (!text) return null;
  if (tags.length) understood.push(tags.map((t) => `#${t}`).join(" "));
  const task: Task = {
    id: nextTaskId(plan, milestone),
    title: text,
    status: "todo",
    milestone,
    depends,
    notes: [],
    tags,
    subtasks: [],
    extra: {},
    ...(estimate && !milestone ? { estimate } : {}),
    ...(owner ? { owner } : {}),
    ...(due ? { due } : {}),
    ...(priority ? { priority } : {}),
  };
  return { task, understood };
}
