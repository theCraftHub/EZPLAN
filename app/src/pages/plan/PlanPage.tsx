import { useMemo } from "react";
import { ArrowLeft, Wifi, WifiOff } from "lucide-react";
import type { Me } from "../../lib/api";
import { usePlanRoom } from "../../lib/live";
import { Link } from "../../lib/router";
import { HealthChip, Notice, Spinner } from "../../ui/kit";
import { Checklist } from "./Checklist";
import { usePlanMath } from "./math";
import { Overview } from "./Overview";
import { Placeholder } from "../Placeholder";

const TABS = [
  { view: "", label: "Overview" },
  { view: "checklist", label: "Checklist" },
  { view: "timeline", label: "Timeline" },
  { view: "team", label: "Team" },
];

export function PlanPage({ me, id, view }: { me: Me; id: string; view: string }) {
  const room = usePlanRoom(id, me);
  const ctx = useMemo(() => (room.detail ? { workWeek: room.detail.workWeek, today: room.detail.today, people: room.detail.people } : null), [room.detail]);
  const math = usePlanMath(room.plan, ctx);
  if (room.error) return <Notice tone="bad">{room.error}</Notice>;
  if (!room.plan || !room.detail || !math) return <Spinner label="Opening the plan" />;
  const canEdit = room.detail.role !== "viewer";
  const others = room.presence.filter((p) => p.userId !== me.user.id);
  return (
    <>
      <header className="flex flex-col gap-3">
        <Link to="/" className="inline-flex min-h-10 items-center gap-1 self-start text-sm font-semibold text-muted hover:text-ink"><ArrowLeft aria-hidden size={16} /> All plans</Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="m-0 text-[26px] leading-tight font-bold tracking-tight">{room.plan.title}</h1>
          <HealthChip value={math.progress.suggestedHealth} />
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
          {!canEdit && <span className="font-semibold">View only</span>}
        </div>
        <nav aria-label="Plan views" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 lg:mx-0 lg:px-0">
          {TABS.map((t) => {
            const to = `/p/${id}${t.view ? `/${t.view}` : ""}`;
            const on = view === t.view;
            return <Link key={t.label} to={to} aria-current={on ? "page" : undefined} className={`-mb-px flex min-h-11 shrink-0 items-center border-b-2 px-3 text-[15px] font-semibold ${on ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink"}`}>{t.label}</Link>;
          })}
        </nav>
      </header>
      {room.notice && <Notice tone="warn"><span className="flex items-center justify-between gap-3">{room.notice}<button onClick={room.clearNotice} className="min-h-9 rounded-lg px-2 font-semibold">OK</button></span></Notice>}
      {view === "" && <Overview plan={room.plan} math={math} today={room.detail.today} canEdit={canEdit} edit={room.edit} planId={id} />}
      {view === "checklist" && <Checklist plan={room.plan} math={math} today={room.detail.today} canEdit={canEdit} edit={room.edit} />}
      {(view === "timeline" || view === "team") && <Placeholder title={view === "timeline" ? "Timeline" : "Team schedule"} />}
    </>
  );
}
