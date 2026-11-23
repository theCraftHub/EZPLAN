import { CalendarClock, Flag, ListChecks, TriangleAlert } from "lucide-react";
import type { Op, Plan } from "@ezplan/shared";
import { longDate, plural, shortDate } from "../../lib/format";
import { Link } from "../../lib/router";
import { Card, ProgressRing } from "../../ui/kit";
import { StatusButton } from "../../ui/Status";
import type { usePlanMath } from "./math";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;

/** The plan's home: where are we, what's next, are we on track. */
export function Overview({ plan, math, today, canEdit, edit, planId }: { plan: Plan; math: Math; today: string; canEdit: boolean; edit: (op: Op) => void; planId: string }) {
  const { progress, schedule, check } = math;
  const late = progress.forecastFinish && progress.forecastFinish > schedule.finish;
  const kpi = "flex flex-col gap-1";
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-3">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="col-span-2 flex items-center gap-3 md:col-span-1">
            <ProgressRing percent={progress.percent} size={64} />
            <div className={kpi}><span className="text-sm text-muted">Progress</span><span className="text-[15px] font-semibold">{progress.doneCount} of {plural(progress.countedTasks, "task")} done</span></div>
          </div>
          <div className={kpi}>
            <span className="flex items-center gap-1 text-sm text-muted"><CalendarClock aria-hidden size={15} /> Finish</span>
            <span className="text-lg font-bold">{shortDate(schedule.finish)}</span>
            {late && <span className="text-sm font-semibold text-warn">At this pace: {shortDate(progress.forecastFinish!)}</span>}
          </div>
          <div className={kpi}>
            <span className="flex items-center gap-1 text-sm text-muted"><Flag aria-hidden size={15} /> Next milestone</span>
            <span className="text-[15px] font-semibold">{math.nextMilestone ? math.nextMilestone.task.title : "None left"}</span>
            {math.nextMilestone && <span className="text-sm text-ink-2">{shortDate(math.nextMilestone.date)}</span>}
          </div>
          <div className={kpi}>
            <span className="flex items-center gap-1 text-sm text-muted"><TriangleAlert aria-hidden size={15} /> Overdue</span>
            <span className={`text-lg font-bold ${progress.overdueCount ? "text-warn" : ""}`}>{progress.overdueCount ? plural(progress.overdueCount, "task") : "Nothing"}</span>
          </div>
        </div>
        {(plan.goal || plan.doneWhen) && (
          <dl className="m-0 mt-4 grid gap-2 border-t border-line pt-4 text-[15px] md:grid-cols-2">
            {plan.goal && <div><dt className="text-sm text-muted">Goal</dt><dd className="m-0">{plan.goal}</dd></div>}
            {plan.doneWhen && <div><dt className="text-sm text-muted">Done when</dt><dd className="m-0">{plan.doneWhen}</dd></div>}
          </dl>
        )}
      </Card>

      <Card aria-label="Up next" className="flex flex-col gap-3 lg:col-span-2">
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

      <Card aria-label="Plan Check" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between"><h2 className="m-0 text-lg font-bold">Plan Check</h2><span className="text-sm font-bold text-good">{check.score} / 100</span></div>
        {check.findings.length === 0 && <p className="m-0 flex items-center gap-2 text-[15px] text-ink-2"><ListChecks aria-hidden size={18} /> No problems found.</p>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {check.findings.slice(0, 4).map((f, i) => (
            <li key={i} className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${f.severity === "problem" ? "bg-bad-soft text-bad" : f.severity === "warning" ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2"}`}>{f.message}</li>
          ))}
        </ul>
        <span className="text-xs text-muted">Checked {longDate(today)}. Suggestions only.</span>
      </Card>
    </div>
  );
}
