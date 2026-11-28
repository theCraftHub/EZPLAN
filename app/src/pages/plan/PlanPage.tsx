import { Grid } from "./Grid";
import { Risks } from "./Risks";
import { planPeople } from "@rakuplan/shared";
import { api } from "../../lib/api";
import { useDeferredValue, useMemo, useState } from "react";
import { Present } from "../../ui/Present";
import { ShareLinks } from "./ShareLinks";
import { Archive, ShieldAlert, WifiOff } from "lucide-react";
import { canCommentRole, canEditRole, type Me } from "../../lib/api";
import { PlanContext, type PlanCtx } from "./PlanContext";
import { Activity } from "./Activity";
import { usePlanRoom } from "../../lib/live";
import { PlanHeader } from "./PlanHeader";
import { Notice, Spinner } from "../../ui/kit";
import { Board } from "./Board";
import { Checklist } from "./Checklist";
import { usePlanMath } from "./math";
import { Overview } from "./Overview";
import { Timeline } from "./Timeline";
import { Team } from "./Team";
import { UpdateWithAI } from "./UpdateWithAI";
import { History } from "./History";
import { PrintSummary } from "./PrintSummary";
import { Share } from "./Share";
import { Report } from "./Report";

export function PlanPage({ me, id, view }: { me: Me; id: string; view: string }) {
  const room = usePlanRoom(id, me);
  const ctx = useMemo(() => (room.detail ? { workWeek: room.detail.workWeek, today: room.detail.today, people: room.detail.people, master: room.detail.master?.view ? { key: room.detail.master.key, ...room.detail.master.view } : null } : null), [room.detail]);
  // Taps show at once; dates, progress and Plan Check catch up a moment later on big plans.
  const settled = useDeferredValue(room.plan);
  const math = usePlanMath(settled, ctx);
  const [presenting, setPresenting] = useState(false);
  const role = room.detail?.role;
  const planCtx = useMemo<PlanCtx>(() => ({ planId: id, canComment: canCommentRole(role), counts: room.comments.counts, tick: room.comments.tick, me: me.user.name, manager: role === "manager", people: room.detail?.people, workWeek: room.detail?.workWeek }), [id, role, room.comments, me.user.name, room.detail?.people, room.detail?.workWeek]);
  if (room.error) return <Notice tone="bad">{room.error}</Notice>;
  if (!room.plan || !room.detail || !math) return <Spinner label="Opening the plan" />;
  const canEdit = canEditRole(room.detail.role);
  const others = room.presence.filter((p) => p.userId !== me.user.id);
  const updated = Number(new URLSearchParams(location.search).get("updated") ?? 0);
  if (view === "print") return <PrintSummary plan={room.plan} math={math} today={room.detail.today} />;
  return (
    <PlanContext.Provider value={planCtx}>
      <PlanHeader id={id} view={view} title={room.plan.title} health={math.progress.suggestedHealth} statusUpdate={room.detail.statusUpdate} master={room.detail.master} status={room.status} pending={room.pending} others={others} canEdit={canEdit} role={room.detail.role} onPresent={() => setPresenting(true)} presentDisabled={!math} presenting={presenting} />
      {room.status !== "live" && (room.fromCopy || room.status === "offline") && (
        <Notice tone="warn"><span className="flex items-start gap-2"><WifiOff aria-hidden size={18} className="mt-0.5 shrink-0" /><span>Offline: changes are saved on this device and sent when you're back{room.pending ? ` (${room.pending} waiting)` : ""}.{room.fromCopy ? ` This is the copy from ${new Date(room.fromCopy).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.` : ""} Comments, sharing and AI need a connection.</span></span></Notice>
      )}
      {room.detail.state === "archived" && (
        <Notice tone="info"><span className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-start gap-2"><Archive aria-hidden size={18} className="mt-0.5 shrink-0" />This plan is archived. It's read-only for everyone until it's restored.</span>
          {room.detail.canArchive && <button onClick={() => void api.setPlanState(id, "active").then(() => location.reload())} className="min-h-11 rounded-xl bg-surface px-4 font-semibold text-ink ring-1 ring-line">Restore</button>}</span></Notice>
      )}
      {room.detail.state === "review" && <Notice tone="warn"><span className="flex items-start gap-2"><ShieldAlert aria-hidden size={18} className="mt-0.5 shrink-0" />This plan is waiting for a safety review. AI features, sharing and exports are paused until then; everything else works.</span></Notice>}
      {room.notice && <Notice tone="warn"><span className="flex items-center justify-between gap-3">{room.notice}<button onClick={room.clearNotice} className="min-h-9 rounded-lg px-2 font-semibold">OK</button></span></Notice>}
      {updated > 0 && view === "" && <Notice tone="good">{updated} change{updated === 1 ? "" : "s"} from your AI assistant applied. The earlier plan is in History.</Notice>}
      {view === "update" && canEdit && <UpdateWithAI planId={id} plan={room.plan} version={room.detail.version} />}
      {view === "report" && <Report planId={id} today={room.detail.today} canEdit={canEdit} onPosted={() => void api.statusUpdates(id).then((u) => room.setDetail({ ...room.detail!, statusUpdate: { last: u.items[0] ? { rag: u.items[0].rag, headline: u.items[0].headline, at: u.items[0].createdAt } : null, overdue: u.overdue } })).catch(() => {})} />}
      {view === "share" && <><Share planId={id} plan={room.plan} me={me} /><ShareLinks planId={id} /></>}
      {presenting && math && room.plan && <Present plan={room.plan} math={math} today={room.detail.today} onClose={() => setPresenting(false)} extra={{ risks: room.detail.raidOpen.risks }} />}
      {view === "history" && <History planId={id} plan={room.plan} version={room.detail.version} canEdit={canEdit} edit={room.edit} />}
      {view === "" && <Overview plan={room.plan} math={math} today={room.detail.today} canEdit={canEdit} edit={room.edit} planId={id} version={room.version} statusUpdate={room.detail.statusUpdate} people={room.detail.people} workWeek={room.detail.workWeek} raidOpen={room.detail.raidOpen} inMaster={!!room.detail.master?.view} />}
      {view === "checklist" && <Checklist plan={room.plan} math={math} today={room.detail.today} canEdit={canEdit} edit={room.edit} />}
      {view === "board" && <Board plan={room.plan} math={math} canEdit={canEdit} edit={room.edit} />}
      {view === "timeline" && <Timeline plan={room.plan} math={math} today={room.detail.today} canEdit={canEdit} edit={room.edit} />}
      {view === "team" && <Team me={me} planId={id} plan={room.plan} math={math} people={room.detail.people} workWeek={room.detail.workWeek} today={room.detail.today} canEdit={canEdit} edit={room.edit} onPeople={(people) => room.setDetail({ ...room.detail!, people })} />}
      {view === "activity" && <Activity version={room.version} />}
      {view === "grid" && <Grid plan={room.plan} math={math} today={room.detail.today} canEdit={canEdit} edit={room.edit} planId={id} />}
      {view === "risks" && <Risks planId={id} plan={room.plan} today={room.detail.today} people={[...new Set([...planPeople(room.plan), ...Object.keys(room.detail.people)])]} onOpenChange={(raidOpen) => room.setDetail({ ...room.detail!, raidOpen })} />}
    </PlanContext.Provider>
  );
}
