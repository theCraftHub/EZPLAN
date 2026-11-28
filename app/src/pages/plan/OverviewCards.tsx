/** Cards shared by the phone Overview and the desktop dashboard. */
import { useEffect, useState } from "react";
import { Ruler } from "lucide-react";
import type { Op, Plan } from "@rakuplan/shared";
import { api, ApiError, type UpdateState } from "../../lib/api";
import { plural, shortDate } from "../../lib/format";
import { Link } from "../../lib/router";
import { Button, Card, Notice } from "../../ui/kit";
import { StatusButton } from "../../ui/Status";
import { RagChip, UpdateOverdue } from "../../ui/StatusUpdate";
import type { usePlanMath } from "./math";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;

/** Open work that's ready to start, earliest first. */
export function UpNext({ math, planId, canEdit, edit, className = "" }: { math: Math; planId: string; canEdit: boolean; edit: (op: Op) => void; className?: string }) {
  const { schedule } = math;
  return (
    <Card aria-label="Up next" className={`flex flex-col gap-3 ${className}`}>
      <div className="flex items-center justify-between"><h2 className="m-0 text-lg font-bold">Up next</h2><Link to={`/p/${planId}/checklist`} className="min-h-10 content-center text-sm font-semibold text-primary-ink">Full checklist</Link></div>
      {math.ready.length === 0 && <p className="m-0 text-[15px] text-ink-2">Nothing is ready to start: everything open is waiting on other work.</p>}
      <ul className="m-0 flex list-none flex-col p-0">
        {math.ready.slice(0, 6).map((t) => {
          const s = schedule.tasks.get(t.id);
          return (
            <li key={t.id} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
              <StatusButton status={t.status} title={t.title} disabled={!canEdit} onChange={(status) => edit({ kind: "setStatus", taskId: t.id, status })} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold">{t.title}</span>
                <span className="text-sm text-muted">{[t.owner, s ? `${shortDate(s.start)} to ${shortDate(s.end)}` : null, s?.overdue ? "overdue" : null].filter(Boolean).join(" · ")}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** How far the finish moved since the baseline, and setting one (saved in History first, so it can be undone). */
export function Baseline({ plan, math, planId, canEdit }: { plan: Plan; math: Math; planId: string; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [list, setList] = useState<Awaited<ReturnType<typeof api.baselines>> | null>(null);
  // Reload the list whenever the plan's baseline changes (here or on another device).
  useEffect(() => { api.baselines(planId).then(setList).catch(() => {}); }, [planId, plan.baselineSet, plan.baselineName]);
  const v = math.progress.baselineVarianceDays;
  // Tasks only (milestones move with the work that leads to them), and only work not yet finished.
  const slipped = [...math.variance].filter(([id, d]) => d > 0 && !math.byId.get(id)?.milestone && !["done", "skipped"].includes(math.byId.get(id)?.status ?? "")).length;
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try { await f(); setList(await api.baselines(planId)); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work. Try again."); } finally { setBusy(false); }
  };
  const save = () => run(async () => { await api.setBaseline(planId, name.trim() || undefined); setAdding(false); setName(""); });
  const items = list?.baselines ?? [];
  const full = list ? items.length >= list.limit : false;
  const field = "min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-base font-normal";
  return (
    <Card aria-label="Baseline" className="flex flex-col gap-2">
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><Ruler aria-hidden size={18} /> Baseline</h2>
      {plan.baselineSet && v !== null ? (
        <>
          <span className={`text-lg font-bold ${v > 0 ? "text-warn" : v < 0 ? "text-good" : ""}`}>{v === 0 ? "On the baseline" : v > 0 ? `${plural(v, "working day")} late` : `${plural(-v, "working day")} early`}</span>
          <span className="text-sm text-ink-2">Finish {shortDate(math.schedule.finish)} vs {plan.baselineName ? `"${plan.baselineName}"` : "the baseline"} set {shortDate(plan.baselineSet)}{slipped ? ` · ${plural(slipped, "task")} slipped` : ""}</span>
        </>
      ) : (
        <p className="m-0 text-[15px] text-ink-2">No baseline yet. Save one to keep today's planned dates and see how far each task slips from them.</p>
      )}
      {items.length > 1 && (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Compare to
          <select value={items.find((b) => b.active)?.id ?? ""} disabled={!canEdit || busy} onChange={(e) => void run(() => api.useBaseline(planId, e.target.value))} className={field}>
            {!items.some((b) => b.active) && <option value="">Choose a baseline</option>}
            {items.map((b) => <option key={b.id} value={b.id}>{b.name} ({shortDate(b.setOn)}{b.finish ? `, finish ${shortDate(b.finish)}` : ""})</option>)}
          </select>
        </label>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      {canEdit && (adding ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Name for this baseline<input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={`e.g. Signed contract (or Baseline ${items.length + 1})`} className={field} /></label>
          <p className="m-0 text-sm text-ink-2">Today's planned dates are saved under this name and the plan compares to them. {items.length ? "Your other baselines stay, so you can switch back." : ""} The current plan is saved in History first.</p>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>Save baseline</Button><Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button></div>
        </form>
      ) : (
        <Button variant="secondary" className="self-start" disabled={busy || full} onClick={() => setAdding(true)}>{plan.baselineSet ? "Save a new baseline" : "Set baseline"}</Button>
      ))}
      {canEdit && full && !adding && <p className="m-0 text-sm text-muted">A plan keeps up to {list!.limit} baselines. Remove one below to save another.</p>}
      {items.length > 1 && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-primary-ink">All baselines ({items.length} of {list!.limit})</summary>
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="All baselines">
            {items.map((b) => (
              <li key={b.id} className="flex items-center gap-2 border-t border-line py-1.5">
                <span className="flex-1">{b.name} · set {shortDate(b.setOn)}{b.finish ? ` · finish ${shortDate(b.finish)}` : ""}{b.active ? " · compared to now" : ""}</span>
                {canEdit && !b.active && <button onClick={() => void run(() => api.removeBaseline(planId, b.id))} disabled={busy} className="min-h-9 rounded-lg px-2 font-semibold text-ink-2 underline" aria-label={`Remove the baseline ${b.name}`}>Remove</button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

export function LatestUpdate({ planId, state }: { planId: string; state: UpdateState }) {
  return (
    <Card aria-label="Latest status update" className="flex flex-col gap-2">
      <h2 className="m-0 flex flex-wrap items-center gap-2 text-lg font-bold">Latest status update <UpdateOverdue state={state} /></h2>
      {state.last ? (
        <>
          <span className="flex flex-wrap items-center gap-2"><RagChip rag={state.last.rag} short /><strong className="text-[15px]">{state.last.headline}</strong></span>
          <span className="text-sm text-muted">{new Date(state.last.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        </>
      ) : (
        <p className="m-0 text-[15px] text-ink-2">No status update yet.</p>
      )}
      <Link to={`/p/${planId}/report`} className="min-h-10 content-center text-sm font-semibold text-primary-ink">{state.overdue || !state.last ? "Write and post an update" : "All updates"}</Link>
    </Card>
  );
}
