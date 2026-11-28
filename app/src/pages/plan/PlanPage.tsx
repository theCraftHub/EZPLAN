import { Grid } from "./Grid";
import { Risks } from "./Risks";
import { planPeople } from "@rakuplan/shared";
import { api } from "../../lib/api";
import { UpdateOverdue } from "../../ui/StatusUpdate";
import { useDeferredValue, useMemo, useState } from "react";
import { Present } from "../../ui/Present";
import { ShareLinks } from "./ShareLinks";
import { Archive, ArrowLeft, CalendarPlus, Download, MonitorPlay, FileText, History as HistoryIcon, Printer, ShieldAlert, Sparkles, Users, Wifi, WifiOff } from "lucide-react";
import { canCommentRole, canEditRole, type Me } from "../../lib/api";
import { PlanContext, type PlanCtx } from "./PlanContext";
import { Activity } from "./Activity";
import { usePlanRoom } from "../../lib/live";
import { Link } from "../../lib/router";
import { HealthChip, Notice, Spinner } from "../../ui/kit";
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

const TABS = [
  { view: "", label: "Overview" },
  { view: "checklist", label: "Checklist" },
  { view: "board", label: "Board" },
  { view: "timeline", label: "Timeline" },
  { view: "grid", label: "Grid" },
  { view: "team", label: "Team" },
  { view: "risks", label: "Risks" },
  { view: "activity", label: "Activity" },
];

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
  const action = "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold hover:bg-surface-2";
  if (view === "print") return <PrintSummary plan={room.plan} math={math} today={room.detail.today} />;
  return (
    <PlanContext.Provider value={planCtx}>
      <header className="flex flex-col gap-3 print:hidden">
        {room.detail.master?.canOpenMaster ? (
          <Link to={`/m/${room.detail.master.id}`} className="inline-flex min-h-10 items-center gap-1 self-start text-sm font-semibold text-muted hover:text-ink"><ArrowLeft aria-hidden size={16} /> {room.detail.master.title}{room.detail.master.isMaster ? "" : ` › ${room.plan.title}`}</Link>
        ) : (
          <Link to="/" className="inline-flex min-h-10 items-center gap-1 self-start text-sm font-semibold text-muted hover:text-ink"><ArrowLeft aria-hidden size={16} /> All plans</Link>
        )}
        {room.detail.master && <span className="self-start rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary-ink">{room.detail.master.isMaster ? `Whole-building tasks of the master plan ${room.detail.master.title}` : `Part of the master plan ${room.detail.master.title}`}</span>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="m-0 text-[26px] leading-tight font-bold tracking-tight">{room.plan.title}</h1>
          <HealthChip value={math.progress.suggestedHealth} />
          <UpdateOverdue state={room.detail.statusUpdate} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
          <span role="status" className={`inline-flex items-center gap-1.5 font-semibold ${room.status === "live" ? "text-good" : room.status === "offline" ? "text-warn" : "text-muted"}`}>
            {room.status === "offline" ? <WifiOff aria-hidden size={16} /> : <Wifi aria-hidden size={16} />}
            {room.status === "live" ? "Live" : room.status === "offline" ? (room.pending ? `Offline · ${room.pending} change${room.pending === 1 ? "" : "s"} will sync` : "Offline · changes will sync") : "Connecting…"}
          </span>
          {others.length > 0 && (
            <span className="inline-flex items-center gap-2" aria-label={`Also here: ${others.map((o) => o.name).join(", ")}`}>
              <span className="flex -space-x-2" aria-hidden>
                {others.slice(0, 4).map((o) => <span key={o.userId} title={o.name} className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-ink ring-2 ring-ground">{o.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>)}
              </span>
              <span>{others.length === 1 ? `${others[0]!.name} is here` : `${others.length} others here`}</span>
            </span>
          )}
          {!canEdit && <span className="font-semibold">{room.detail.role === "commenter" ? "Can comment" : "View only"}</span>}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Plan actions">
          {canEdit && <Link to={`/p/${id}/update`} className={`${action} border-primary/40 text-primary-ink`}><Sparkles aria-hidden size={16} /> Update with my AI</Link>}
          <a href={`/api/plans/${id}/export`} download className={action}><Download aria-hidden size={16} /> Download plan file</a>
          <a href={`/api/plans/${id}/calendar.ics`} download className={action}><CalendarPlus aria-hidden size={16} /> Add to calendar</a>
          <Link to={`/p/${id}/print`} className={action}><Printer aria-hidden size={16} /> Print summary</Link>
          <button onClick={() => setPresenting(true)} disabled={!math} className={action}><MonitorPlay aria-hidden size={16} /> Present</button>
          <Link to={`/p/${id}/report`} className={action}><FileText aria-hidden size={16} /> Status report</Link>
          <Link to={`/p/${id}/history`} className={action}><HistoryIcon aria-hidden size={16} /> History and Trash</Link>
          <Link to={`/p/${id}/share`} className={action}><Users aria-hidden size={16} /> Share</Link>
        </div>
        <nav aria-label="Plan views" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 lg:mx-0 lg:px-0">
          {TABS.map((t) => {
            const to = `/p/${id}${t.view ? `/${t.view}` : ""}`;
            const on = view === t.view;
            return <Link key={t.label} to={to} aria-current={on ? "page" : undefined} className={`-mb-px flex min-h-11 shrink-0 items-center border-b-2 px-3 text-[15px] font-semibold ${on ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink"}`}>{t.label}</Link>;
          })}
        </nav>
      </header>
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
      {view === "" && <Overview plan={room.plan} math={math} today={room.detail.today} canEdit={canEdit} edit={room.edit} planId={id} version={room.version} statusUpdate={room.detail.statusUpdate} people={room.detail.people} workWeek={room.detail.workWeek} raidOpen={room.detail.raidOpen} />}
      {view === "checklist" && <Checklist plan={room.plan} math={math} today={room.detail.today} canEdit={canEdit} edit={room.edit} />}
      {view === "board" && <Board plan={room.plan} math={math} canEdit={canEdit} edit={room.edit} />}
      {view === "timeline" && <Timeline plan={room.plan} math={math} today={room.detail.today} />}
      {view === "team" && <Team me={me} planId={id} plan={room.plan} math={math} people={room.detail.people} workWeek={room.detail.workWeek} today={room.detail.today} canEdit={canEdit} edit={room.edit} onPeople={(people) => room.setDetail({ ...room.detail!, people })} />}
      {view === "activity" && <Activity version={room.version} />}
      {view === "grid" && <Grid plan={room.plan} math={math} today={room.detail.today} canEdit={canEdit} edit={room.edit} planId={id} />}
      {view === "risks" && <Risks planId={id} plan={room.plan} today={room.detail.today} people={[...new Set([...planPeople(room.plan), ...Object.keys(room.detail.people)])]} onOpenChange={(raidOpen) => room.setDetail({ ...room.detail!, raidOpen })} />}
    </PlanContext.Provider>
  );
}
