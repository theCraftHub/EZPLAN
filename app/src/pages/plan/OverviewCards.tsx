/** Cards shared by the phone Overview and the desktop dashboard. */
import { useState } from "react";
import { Ruler } from "lucide-react";
import type { Op, Plan } from "@ezplan/shared";
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
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const v = math.progress.baselineVarianceDays;
  // Tasks only (milestones move with the work that leads to them), and only work not yet finished.
  const slipped = [...math.variance].filter(([id, d]) => d > 0 && !math.byId.get(id)?.milestone && !["done", "skipped"].includes(math.byId.get(id)?.status ?? "")).length;
  const set = async () => {
    setBusy(true);
    setError("");
    try { await api.setBaseline(planId); setConfirm(false); } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't set the baseline."); } finally { setBusy(false); }
  };
  return (
    <Card aria-label="Baseline" className="flex flex-col gap-2">
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><Ruler aria-hidden size={18} /> Baseline</h2>
      {plan.baselineSet && v !== null ? (
        <>
          <span className={`text-lg font-bold ${v > 0 ? "text-warn" : v < 0 ? "text-good" : ""}`}>{v === 0 ? "On the baseline" : v > 0 ? `${plural(v, "working day")} late` : `${plural(-v, "working day")} early`}</span>
          <span className="text-sm text-ink-2">Finish {shortDate(math.schedule.finish)} vs baseline set {shortDate(plan.baselineSet)}{slipped ? ` · ${plural(slipped, "task")} slipped` : ""}</span>
        </>
      ) : (
        <p className="m-0 text-[15px] text-ink-2">No baseline yet. Set one to save today's planned dates and see how far each task slips from them.</p>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      {canEdit && (confirm ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm">Replace the baseline from {shortDate(plan.baselineSet!)} with today's dates? The current plan is saved in History first.</p>
          <div className="flex flex-wrap gap-2"><Button onClick={() => void set()} disabled={busy}>Replace the baseline</Button><Button variant="secondary" onClick={() => setConfirm(false)}>Keep it</Button></div>
        </div>
      ) : (
        <Button variant="secondary" className="self-start" disabled={busy} onClick={() => (plan.baselineSet ? setConfirm(true) : void set())}>{plan.baselineSet ? "Set a new baseline" : "Set baseline"}</Button>
      ))}
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
