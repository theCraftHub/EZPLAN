/**
 * Recurring tasks (step M3): "repeat: weekly", "every 2 weeks", "monthly", "weekdays", "every 3 days".
 * When a repeating task is done (or skipped), the next one is added right after it, due one
 * interval later; the finished one keeps its history and stops repeating.
 */
import type { Task } from "./schema";

export interface RepeatRule { unit: "day" | "week" | "month" | "weekday"; every: number }

const WORDS: Record<string, RepeatRule> = {
  daily: { unit: "day", every: 1 }, "every day": { unit: "day", every: 1 },
  weekly: { unit: "week", every: 1 }, "every week": { unit: "week", every: 1 },
  biweekly: { unit: "week", every: 2 }, fortnightly: { unit: "week", every: 2 },
  monthly: { unit: "month", every: 1 }, "every month": { unit: "month", every: 1 },
  quarterly: { unit: "month", every: 3 },
  yearly: { unit: "month", every: 12 }, annually: { unit: "month", every: 12 }, "every year": { unit: "month", every: 12 },
  weekdays: { unit: "weekday", every: 1 }, "every weekday": { unit: "weekday", every: 1 },
};

/** A repeat rule from what someone wrote, or null if it isn't one. */
export function parseRepeat(text: string | undefined | null): RepeatRule | null {
  const t = (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (WORDS[t]) return WORDS[t]!;
  const m = /^every (\d{1,3}) (day|week|month|year)s?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1) return null;
  return m[2] === "year" ? { unit: "month", every: n * 12 } : { unit: m[2] as "day" | "week" | "month", every: n };
}

/** The rule in its standard words ("weekly", "every 2 weeks"). */
export function formatRepeat(r: RepeatRule): string {
  if (r.unit === "weekday") return "weekdays";
  if (r.every === 1) return { day: "daily", week: "weekly", month: "monthly" }[r.unit];
  if (r.unit === "month" && r.every % 12 === 0) return r.every === 12 ? "yearly" : `every ${r.every / 12} years`;
  return `every ${r.every} ${r.unit}s`;
}

/** Words for the screen: "Every week", "Every 2 weeks", "Every weekday". */
export function repeatLabel(text: string): string {
  const r = parseRepeat(text);
  if (!r) return text;
  const f = formatRepeat(r);
  return f === "daily" ? "Every day" : f === "weekly" ? "Every week" : f === "monthly" ? "Every month" : f === "yearly" ? "Every year" : f === "weekdays" ? "Every weekday" : f[0]!.toUpperCase() + f.slice(1);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The date one interval after `from` (YYYY-MM-DD). Months keep the day, or use the month's last day. */
export function nextDate(from: string, r: RepeatRule): string {
  const d = new Date(`${from}T00:00:00Z`);
  if (r.unit === "day") d.setUTCDate(d.getUTCDate() + r.every);
  else if (r.unit === "week") d.setUTCDate(d.getUTCDate() + 7 * r.every);
  else if (r.unit === "weekday") {
    do d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  } else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + r.every);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return iso(d);
}

/** The next occurrence of a finished repeating task: a fresh copy with a new ID, due one interval on. */
export function nextOccurrence(t: Task, newId: string, today: string): Task | null {
  const r = parseRepeat(t.repeat);
  if (!r) return null;
  return {
    id: newId,
    title: t.title,
    status: "todo",
    milestone: t.milestone,
    ...(t.estimate ? { estimate: structuredClone(t.estimate) } : {}),
    ...(t.owner ? { owner: t.owner } : {}),
    ...(t.dept ? { dept: t.dept } : {}),
    ...(t.priority ? { priority: t.priority } : {}),
    ...(t.approver ? { approver: t.approver } : {}),
    due: nextDate(t.due ?? today, r),
    repeat: formatRepeat(r),
    depends: [],
    notes: [],
    tags: [...t.tags],
    subtasks: t.subtasks.map((s) => ({ title: s.title, status: "todo" as const })),
    extra: {},
  };
}
