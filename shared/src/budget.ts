/**
 * Budgets, costs and time (step N4). A task's money is `cost: planned/actual` in the plan's
 * currency. Where a task has no planned cost, it can come from its owner's hourly rate times its
 * estimate; where it has no actual cost, from the rate times the hours logged on it. The forecast is
 * what's been spent on finished work plus, for open work, the larger of what's planned and what's
 * already been spent.
 */
import { allTasks, estimateToDays, planDayLength, type Plan, type Task, type WorkWeek } from "./schema";

export interface Cost { planned?: number; actual?: number }

/** "1200/950", "1,200.50 / 950", "$1200", "/950" → { planned, actual }; null if unreadable. */
export function parseCost(text: string): Cost | null {
  const parts = text.split("/").map((p) => p.trim());
  if (parts.length > 2) return null;
  const num = (s: string | undefined) => {
    if (s === undefined || s === "") return undefined;
    const clean = s.replace(/^[^\d.-]+|[^\d.]+$/g, "").replace(/,(?=\d{3}\b)/g, "");
    const n = Number(clean);
    return clean && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  };
  const planned = num(parts[0]);
  const actual = num(parts[1]);
  if (planned === null || actual === null || (planned === undefined && actual === undefined)) return null;
  return { ...(planned !== undefined ? { planned } : {}), ...(actual !== undefined ? { actual } : {}) };
}

/** The plan-file form: "1200/950", "1200", "/950"; "" when there's no cost. */
export function formatCost(c: Cost | undefined | null): string {
  if (!c || (c.planned === undefined && c.actual === undefined)) return "";
  return `${c.planned ?? ""}/${c.actual ?? ""}`.replace(/\/$/, "");
}

export interface TimeEntry { taskId: string; minutes: number }

export interface TaskMoney {
  taskId: string;
  planned: number | null;
  plannedFrom: "set" | "rate" | null;
  actual: number | null;
  actualFrom: "set" | "rate" | null;
  loggedHours: number;
  estimateHours: number | null;
}

export interface Budget {
  currency: string | null;
  planned: number;
  actual: number;
  forecast: number;
  loggedHours: number;
  /** Over the planned total by this much (forecast − planned), when positive. */
  overBy: number;
  tasks: Map<string, TaskMoney>;
  byPhase: { phaseId: string; title: string; planned: number; actual: number }[];
  /** True when the plan has any money at all (costs or rates), so screens can show or hide budget parts. */
  hasMoney: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function budgetOf(plan: Plan, opts: { rates?: Record<string, number>; time?: TimeEntry[]; workWeek?: Partial<WorkWeek> } = {}): Budget {
  const dayHours = planDayLength(plan, opts.workWeek);
  const rate = (t: Task) => {
    if (!t.owner || !opts.rates) return undefined;
    const k = Object.keys(opts.rates).find((n) => n.toLowerCase() === t.owner!.toLowerCase());
    return k ? opts.rates[k] : undefined;
  };
  const logged = new Map<string, number>();
  for (const e of opts.time ?? []) logged.set(e.taskId, (logged.get(e.taskId) ?? 0) + e.minutes / 60);
  const tasks = new Map<string, TaskMoney>();
  let planned = 0, actual = 0, forecast = 0, loggedHours = 0, hasMoney = false;
  const byPhase: Budget["byPhase"] = [];
  for (const ph of plan.phases) {
    const row = { phaseId: ph.id, title: ph.title, planned: 0, actual: 0 };
    for (const t of ph.tasks) {
      const r = rate(t);
      const estH = t.estimate ? estimateToDays(t.estimate, dayHours) * dayHours : null;
      const hours = logged.get(t.id) ?? 0;
      const p = t.cost?.planned !== undefined ? { v: t.cost.planned, from: "set" as const } : r !== undefined && estH !== null ? { v: round(r * estH), from: "rate" as const } : { v: null, from: null };
      const a = t.cost?.actual !== undefined ? { v: t.cost.actual, from: "set" as const } : r !== undefined && hours > 0 ? { v: round(r * hours), from: "rate" as const } : { v: null, from: null };
      if (p.v !== null || a.v !== null) hasMoney = true;
      tasks.set(t.id, { taskId: t.id, planned: p.v, plannedFrom: p.from, actual: a.v, actualFrom: a.from, loggedHours: round(hours), estimateHours: estH === null ? null : round(estH) });
      planned += p.v ?? 0;
      actual += a.v ?? 0;
      loggedHours += hours;
      const finished = t.status === "done" || t.status === "skipped";
      forecast += finished ? (a.v ?? p.v ?? 0) : Math.max(p.v ?? 0, a.v ?? 0);
      row.planned += p.v ?? 0;
      row.actual += a.v ?? 0;
    }
    byPhase.push({ ...row, planned: round(row.planned), actual: round(row.actual) });
  }
  if (opts.rates && Object.keys(opts.rates).length) hasMoney = hasMoney || allTasks(plan).some((t) => rate(t) !== undefined);
  return { currency: plan.currency ?? null, planned: round(planned), actual: round(actual), forecast: round(forecast), loggedHours: round(loggedHours), overBy: round(Math.max(0, forecast - planned)), tasks, byPhase, hasMoney };
}

/** "$1,200" / "€950" / "1,200 SEK": money in the plan's currency for screens and reports. */
export function money(n: number, currency: string | null | undefined, locale?: string): string {
  try {
    if (currency && /^[A-Z]{3}$/.test(currency)) return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch { /* an unknown currency code: plain number below */ }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n)}${currency ? ` ${currency}` : ""}`;
}
