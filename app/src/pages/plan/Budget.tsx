/**
 * Budgets and time (step N4): the Overview's budget card, and the task sheet's time-and-cost part.
 * Time entries come from the server; costs are task fields edited like any other.
 */
import { useCallback, useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { budgetOf, money, type Op, type PersonAvailability, type Plan, type Task, type WorkWeek } from "@rakuplan/shared";
import { api, ApiError, type TimeLog } from "../../lib/api";
import { shortDate } from "../../lib/format";
import { Button, Notice } from "../../ui/kit";

/** Time entries for a plan, refreshed after changes (and whenever another part of the page logs time). */
export function useTime(planId: string) {
  const [data, setData] = useState<{ canLog: boolean; manager: boolean; entries: TimeLog[] } | null>(null);
  const load = useCallback(() => api.timeLogs(planId).then(setData).catch(() => {}), [planId]);
  useEffect(() => {
    void load();
    const again = () => void load();
    addEventListener("time-logged", again);
    return () => removeEventListener("time-logged", again);
  }, [load]);
  return { data, reload: () => { dispatchEvent(new Event("time-logged")); } };
}

const ratesOf = (people: Record<string, PersonAvailability>) => Object.fromEntries(Object.entries(people).filter(([, a]) => a.rate !== undefined).map(([n, a]) => [n, a.rate!]));

export function BudgetCard({ plan, planId, people, workWeek }: { plan: Plan; planId: string; people: Record<string, PersonAvailability>; workWeek: WorkWeek }) {
  const { data } = useTime(planId);
  const b = budgetOf(plan, { rates: ratesOf(people), time: data?.entries ?? [], workWeek });
  const cur = b.currency;
  if (!b.hasMoney && !b.loggedHours) {
    return <p className="m-0 text-sm text-ink-2">No costs yet. Add a planned cost to tasks (in the task, or <code>cost: 1200</code> in the plan file), or set people's hourly rates on the Team page, and the budget shows here.</p>;
  }
  const pct = b.planned ? Math.min(100, Math.round((b.actual / b.planned) * 100)) : 0;
  return (
    <div className="flex flex-col gap-3">
      <dl className="m-0 grid grid-cols-3 gap-2">
        {[["Planned", money(b.planned, cur)], ["Spent", money(b.actual, cur)], ["Forecast", money(b.forecast, cur)]].map(([k, v]) => <div key={k}><dt className="text-sm text-muted">{k}</dt><dd className="m-0 text-lg font-bold tabular-nums">{v}</dd></div>)}
      </dl>
      {b.planned > 0 && <span className="h-2 overflow-hidden rounded-full bg-line" role="img" aria-label={`${pct}% of the budget spent`}><span className={`block h-full rounded-full ${b.actual > b.planned ? "bg-bad" : "bg-primary"}`} style={{ width: `${pct}%` }} /></span>}
      {b.overBy > 0 ? <Notice tone="warn">Heading {money(b.overBy, cur)} over the plan ({Math.round((b.overBy / Math.max(1, b.planned)) * 100)}%).</Notice> : b.planned > 0 && <p className="m-0 text-sm text-good">Within budget so far.</p>}
      {b.loggedHours > 0 && <p className="m-0 text-sm text-ink-2">{b.loggedHours} h logged. <a className="font-semibold text-primary-ink underline" href={`/api/plans/${planId}/time.csv`} download><Download aria-hidden size={14} className="inline" /> Time as CSV</a></p>}
      {b.byPhase.filter((p) => p.planned || p.actual).length > 1 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" aria-label="Budget by phase">
          {b.byPhase.filter((p) => p.planned || p.actual).map((p) => <li key={p.phaseId} className="flex justify-between gap-3"><span>{p.title}</span><span className={`tabular-nums ${p.actual > p.planned ? "font-semibold text-warn" : "text-ink-2"}`}>{money(p.actual, cur)} of {money(p.planned, cur)}</span></li>)}
        </ul>
      )}
    </div>
  );
}

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const field = "min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal disabled:bg-surface-2";

/** In the task sheet: planned and actual cost, and time logged on the task. */
export function TaskMoney({ task, plan, planId, people, workWeek, canEdit, edit }: { task: Task; plan: Plan; planId: string; people: Record<string, PersonAvailability>; workWeek: WorkWeek; canEdit: boolean; edit: (op: Op) => void }) {
  const { data, reload } = useTime(planId);
  const [planned, setPlanned] = useState(task.cost?.planned?.toString() ?? "");
  const [actual, setActual] = useState(task.cost?.actual?.toString() ?? "");
  const [hours, setHours] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const b = budgetOf(plan, { rates: ratesOf(people), time: data?.entries ?? [], workWeek }).tasks.get(task.id);
  const cur = plan.currency ?? null;
  const entries = (data?.entries ?? []).filter((e) => e.taskId === task.id);
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(/,/g, "")));
  const bad = (s: string) => s.trim() !== "" && !(Number(s.replace(/,/g, "")) >= 0);
  const saveCost = () => {
    if (bad(planned) || bad(actual)) return;
    const p = num(planned), a = num(actual);
    const next = p === undefined && a === undefined ? null : { ...(p !== undefined ? { planned: p } : {}), ...(a !== undefined ? { actual: a } : {}) };
    if (JSON.stringify(next) !== JSON.stringify(task.cost ?? null)) edit({ kind: "setField", taskId: task.id, field: "cost", value: next });
  };
  if (task.milestone) return null;
  return (
    <section aria-label="Time and cost" className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3 ring-1 ring-line">
      <h3 className="m-0 text-[15px] font-bold">Time and cost</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Planned cost{cur ? ` (${cur})` : ""}<input inputMode="decimal" value={planned} onChange={(e) => setPlanned(e.target.value)} onBlur={saveCost} disabled={!canEdit} aria-invalid={bad(planned)} placeholder={b?.plannedFrom === "rate" ? `${b.planned} from rate` : "0"} className={field} /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Actual cost{cur ? ` (${cur})` : ""}<input inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} onBlur={saveCost} disabled={!canEdit} aria-invalid={bad(actual)} placeholder={b?.actualFrom === "rate" ? `${b.actual} from time` : "0"} className={field} /></label>
      </div>
      <p className="m-0 text-sm text-ink-2" role="status">{b && b.loggedHours > 0 ? `${b.loggedHours} h logged${b.estimateHours ? ` of ${b.estimateHours} h estimated` : ""}${b.estimateHours && b.loggedHours > b.estimateHours ? " (over the estimate)" : ""}.` : "No time logged yet."}{b?.actual !== null && b?.actual !== undefined ? ` Spent ${money(b.actual, cur)}.` : ""}</p>
      {entries.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" aria-label="Time logged">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              <span className="flex-1">{shortDate(e.date)} · {e.person} · {e.minutes / 60} h{e.note ? ` · ${e.note}` : ""}</span>
              {(e.mine || data?.manager) && data?.canLog && <button aria-label={`Remove ${e.minutes / 60} h on ${shortDate(e.date)}`} onClick={() => api.deleteTime(planId, e.id).then(reload).catch((x) => setError(x instanceof ApiError ? x.message : "Couldn't remove it."))} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface"><Trash2 aria-hidden size={16} /></button>}
            </li>
          ))}
        </ul>
      )}
      {data?.canLog && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setError(""); api.logTime(planId, { taskId: task.id, date, hours: Number(hours), ...(note.trim() ? { note: note.trim() } : {}) }).then(() => { setHours(""); setNote(""); reload(); }).catch((x) => setError(x instanceof ApiError ? x.message : "Couldn't log it.")); }}>
          <label className="flex w-24 flex-col gap-1.5 text-sm font-semibold">Hours<input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="1.5" className={field} /></label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Day<input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className={field} /></label>
          <label className="flex min-w-0 flex-1 basis-32 flex-col gap-1.5 text-sm font-semibold">Note<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Optional" className={field} /></label>
          <Button type="submit" variant="secondary" disabled={!(Number(hours) > 0)}>Log time</Button>
        </form>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
    </section>
  );
}
