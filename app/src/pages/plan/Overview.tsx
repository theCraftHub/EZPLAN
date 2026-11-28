import { CalendarClock, Flag, TriangleAlert } from "lucide-react";
import type { UpdateState } from "../../lib/api";
import { useIsDesktop } from "../../lib/view";
import { Baseline, LatestUpdate, UpNext } from "./OverviewCards";
import { Dashboard } from "./Dashboard";
import { RecentActivity } from "./Activity";
import type { Op, PersonAvailability, Plan, WorkWeek } from "@rakuplan/shared";
import { plural, shortDate } from "../../lib/format";
import { Card, ProgressRing } from "../../ui/kit";
import { BudgetCard } from "./Budget";
import { TryChange } from "./TryChange";
import type { usePlanMath } from "./math";
import { PlanCheck } from "./PlanCheck";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;

/** The plan's home: where are we, what's next, are we on track. Phones get this compact page; desktops the dashboard. */
export function Overview({ plan, math, today, canEdit, edit, planId, version, statusUpdate, people, workWeek, raidOpen, inMaster }: { inMaster?: boolean; plan: Plan; math: Math; today: string; canEdit: boolean; edit: (op: Op) => void; planId: string; version: number; statusUpdate: UpdateState; people: Record<string, PersonAvailability>; workWeek: WorkWeek; raidOpen: { risks: number; issues: number } }) {
  const desktop = useIsDesktop();
  if (desktop) return <Dashboard plan={plan} math={math} today={today} canEdit={canEdit} edit={edit} planId={planId} version={version} statusUpdate={statusUpdate} people={people} workWeek={workWeek} raidOpen={raidOpen} inMaster={inMaster} />;
  const { progress, schedule } = math;
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

      <Baseline plan={plan} math={math} planId={planId} canEdit={canEdit} />
      <LatestUpdate planId={planId} state={statusUpdate} />

      <UpNext math={math} planId={planId} canEdit={canEdit} edit={edit} className="lg:col-span-2" />

      <PlanCheck planId={planId} plan={plan} math={math} canEdit={canEdit} edit={edit} />
      <Card aria-label="Budget" className="flex flex-col gap-2"><h2 className="m-0 text-lg font-bold">Budget</h2><BudgetCard plan={plan} planId={planId} people={people} workWeek={workWeek} /></Card>
      {!inMaster && <TryChange plan={plan} planId={planId} people={people} workWeek={workWeek} today={today} canEdit={canEdit} edit={edit} />}
      <RecentActivity version={version} />
    </div>
  );
}

