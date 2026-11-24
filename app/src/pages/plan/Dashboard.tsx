/**
 * The desktop Overview (step J2): widgets each person can hide and reorder, saved to their account.
 * Every number comes from the same engine as the rest of the plan page. Phones keep the compact Overview.
 */
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Eye, EyeOff, GripVertical, LayoutGrid, Route, TriangleAlert, Users } from "lucide-react";
import { fromDay, toDay, type Op, type PersonAvailability, type Plan, type WorkWeek } from "@ezplan/shared";
import { api, type UpdateState } from "../../lib/api";
import { plural, shortDate } from "../../lib/format";
import { Button, Card, ProgressRing } from "../../ui/kit";
import { RecentActivity } from "./Activity";
import type { usePlanMath } from "./math";
import { Baseline, LatestUpdate, UpNext } from "./OverviewCards";
import { PlanCheck } from "./PlanCheck";
import { useTeamData } from "./teamData";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;
type Props = { plan: Plan; math: Math; today: string; canEdit: boolean; edit: (op: Op) => void; planId: string; version: number; statusUpdate: UpdateState; people: Record<string, PersonAvailability>; workWeek: WorkWeek };

export const WIDGETS = [
  { id: "kpis", title: "Key numbers", wide: true },
  { id: "milestones", title: "Milestones", wide: true },
  { id: "update", title: "Latest status update", wide: false },
  { id: "baseline", title: "Baseline", wide: false },
  { id: "critical", title: "Critical path", wide: false },
  { id: "lookahead", title: "Next two weeks", wide: false },
  { id: "workload", title: "Workload", wide: false },
  { id: "upnext", title: "Up next", wide: false },
  { id: "check", title: "Plan Check", wide: false },
  { id: "activity", title: "Recent activity", wide: false },
] as const;
type WidgetId = (typeof WIDGETS)[number]["id"];
type Layout = { order: WidgetId[]; hidden: WidgetId[] };
const PREF = "overview.widgets";
const DEFAULT: Layout = { order: WIDGETS.map((w) => w.id), hidden: [] };

/** A saved layout, made safe: unknown ids dropped, new widgets added at the end. */
export function normalizeLayout(v: unknown): Layout {
  const ids = new Set<string>(WIDGETS.map((w) => w.id));
  const raw = (v && typeof v === "object" ? v : {}) as { order?: unknown; hidden?: unknown };
  const order = (Array.isArray(raw.order) ? raw.order : []).filter((x): x is WidgetId => typeof x === "string" && ids.has(x));
  const uniq = order.filter((x, i) => order.indexOf(x) === i);
  const hidden = (Array.isArray(raw.hidden) ? raw.hidden : []).filter((x): x is WidgetId => typeof x === "string" && ids.has(x));
  return { order: [...uniq, ...DEFAULT.order.filter((x) => !uniq.includes(x))], hidden };
}

export function Dashboard(p: Props) {
  const [layout, setLayout] = useState<Layout>(DEFAULT);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  useEffect(() => void api.getPref(PREF).then((r) => setLayout(normalizeLayout(r.value))).catch(() => {}), []);
  const save = (next: Layout) => { setLayout(next); void api.setPref(PREF, next).catch(() => {}); };
  const move = (id: WidgetId, to: number) => {
    const order = layout.order.filter((x) => x !== id);
    order.splice(Math.max(0, Math.min(order.length, to)), 0, id);
    save({ ...layout, order });
  };
  const shown = layout.order.filter((id) => !layout.hidden.includes(id));
  const visible = editing ? layout.order : shown;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing && <span className="mr-auto text-sm text-ink-2">Drag widgets, or use the arrows, to reorder. Hidden widgets stay here, faded, until you show them. Saved for you only.</span>}
        {editing && <Button variant="secondary" onClick={() => save(DEFAULT)}>Reset layout</Button>}
        <Button variant={editing ? "primary" : "secondary"} onClick={() => setEditing(!editing)} aria-pressed={editing}><LayoutGrid aria-hidden size={18} /> {editing ? "Done" : "Customize"}</Button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {visible.map((id, i) => {
          const w = WIDGETS.find((x) => x.id === id)!;
          const hidden = layout.hidden.includes(id);
          const body = <Widget id={id} {...p} />;
          if (!editing) return <div key={id} className={w.wide ? "col-span-2" : ""}>{body}</div>;
          return (
            <section
              key={id}
              aria-label={`${w.title} widget`}
              draggable
              onDragStart={(e: DragEvent) => { setDragging(id); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e: DragEvent) => { if (dragging && dragging !== id) e.preventDefault(); }}
              onDrop={(e: DragEvent) => { e.preventDefault(); if (dragging) move(dragging, layout.order.indexOf(id)); setDragging(null); }}
              onDragEnd={() => setDragging(null)}
              className={`flex flex-col gap-2 rounded-2xl p-2 outline-2 outline-dashed ${dragging === id ? "outline-primary" : "outline-line"} ${w.wide ? "col-span-2" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2 px-1">
                <GripVertical aria-hidden size={18} className="cursor-grab text-muted" />
                <strong className="flex-1 text-sm">{w.title}{hidden ? " (hidden)" : ""}</strong>
                <button aria-label={`Move ${w.title} up`} disabled={i === 0} onClick={() => move(id, i - 1)} className="flex h-10 w-10 items-center justify-center rounded-lg ring-1 ring-line disabled:opacity-40"><ArrowUp aria-hidden size={16} /></button>
                <button aria-label={`Move ${w.title} down`} disabled={i === visible.length - 1} onClick={() => move(id, i + 1)} className="flex h-10 w-10 items-center justify-center rounded-lg ring-1 ring-line disabled:opacity-40"><ArrowDown aria-hidden size={16} /></button>
                <button onClick={() => save({ ...layout, hidden: hidden ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] })} className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 ring-line">
                  {hidden ? <><Eye aria-hidden size={16} /> Show {w.title}</> : <><EyeOff aria-hidden size={16} /> Hide {w.title}</>}
                </button>
              </div>
              <div className={hidden ? "pointer-events-none opacity-40" : ""}>{body}</div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Widget({ id, ...p }: Props & { id: WidgetId }): ReactNode {
  switch (id) {
    case "kpis": return <Kpis {...p} />;
    case "milestones": return <Milestones {...p} />;
    case "update": return <LatestUpdate planId={p.planId} state={p.statusUpdate} />;
    case "baseline": return <Baseline plan={p.plan} math={p.math} planId={p.planId} canEdit={p.canEdit} />;
    case "critical": return <Critical {...p} />;
    case "lookahead": return <Lookahead {...p} />;
    case "workload": return <Workload {...p} />;
    case "upnext": return <UpNext math={p.math} planId={p.planId} canEdit={p.canEdit} edit={p.edit} />;
    case "check": return <PlanCheck planId={p.planId} plan={p.plan} math={p.math} canEdit={p.canEdit} edit={p.edit} />;
    case "activity": return <RecentActivity version={p.version} />;
  }
}

function Kpis({ math }: Props) {
  const { progress, schedule, check } = math;
  const v = progress.baselineVarianceDays;
  const forecast = progress.forecastFinish ?? schedule.finish;
  const item = "flex flex-col gap-1";
  return (
    <Card aria-label="Key numbers">
      <dl className="m-0 grid grid-cols-5 gap-4">
        <div className="flex items-center gap-3"><ProgressRing percent={progress.percent} size={56} /><div className={item}><dt className="text-sm text-muted">Progress</dt><dd className="m-0 text-[15px] font-semibold">{progress.doneCount} of {plural(progress.countedTasks, "task")} done</dd></div></div>
        <div className={item}><dt className="text-sm text-muted">Vs baseline</dt><dd className={`m-0 text-lg font-bold ${v && v > 0 ? "text-warn" : v && v < 0 ? "text-good" : ""}`}>{v === null ? "No baseline" : v === 0 ? "On time" : v > 0 ? `${v}d late` : `${-v}d early`}</dd></div>
        <div className={item}><dt className="flex items-center gap-1 text-sm text-muted"><CalendarClock aria-hidden size={15} /> Forecast finish</dt><dd className={`m-0 text-lg font-bold ${forecast > schedule.finish ? "text-warn" : ""}`}>{shortDate(forecast)}</dd>{forecast > schedule.finish && <dd className="m-0 text-xs text-ink-2">Planned {shortDate(schedule.finish)}</dd>}</div>
        <div className={item}><dt className="flex items-center gap-1 text-sm text-muted"><TriangleAlert aria-hidden size={15} /> Overdue</dt><dd className={`m-0 text-lg font-bold ${progress.overdueCount ? "text-warn" : ""}`}>{progress.overdueCount ? plural(progress.overdueCount, "task") : "Nothing"}</dd></div>
        <div className={item}><dt className="text-sm text-muted">Plan Check</dt><dd className="m-0 text-lg font-bold">{check.score} / 100</dd></div>
      </dl>
    </Card>
  );
}

function Milestones({ plan, math }: Props) {
  const list = plan.phases.flatMap((ph) => ph.tasks).filter((t) => t.milestone).map((t) => ({ t, date: math.schedule.tasks.get(t.id)?.end ?? math.schedule.finish, slip: math.variance.get(t.id) ?? 0 })).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Card aria-label="Milestones" className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-bold">Milestones</h2>
      {list.length === 0 ? <p className="m-0 text-[15px] text-ink-2">This plan has no milestones.</p> : (
        <ol className="m-0 flex list-none gap-6 overflow-x-auto p-0 pb-1">
          {list.map(({ t, date, slip }) => {
            const done = t.status === "done";
            return (
              <li key={t.id} className="flex min-w-40 items-start gap-2">
                <span aria-hidden className={`mt-1 h-3.5 w-3.5 shrink-0 rotate-45 rounded-[2px] ${done ? "bg-good" : slip > 0 ? "border-2 border-warn bg-surface" : "border-2 border-primary bg-surface"}`} />
                <span className="flex flex-col">
                  <span className="text-[15px] font-semibold">{t.title}</span>
                  <span className="text-sm text-ink-2">{shortDate(date)} · {done ? "Done" : slip > 0 ? `${slip}d later than the baseline` : "On track"}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function Critical({ math }: Props) {
  const open = (id: string) => !["done", "skipped"].includes(math.byId.get(id)?.status ?? "done");
  const critical = math.schedule.criticalPath.filter(open);
  const near = [...math.schedule.tasks.values()].filter((s) => !s.critical && s.slack > 0 && s.slack <= 3 && open(s.id) && !math.byId.get(s.id)?.milestone).sort((a, b) => a.slack - b.slack).slice(0, 4);
  const row = (id: string, note: string) => {
    const t = math.byId.get(id)!;
    const s = math.schedule.tasks.get(id)!;
    return <li key={id} className="flex flex-col border-t border-line py-2 first:border-t-0"><span className="text-[15px] font-semibold">{t.title}</span><span className="text-sm text-muted">{[t.owner, `${shortDate(s.start)} to ${shortDate(s.end)}`, note].filter(Boolean).join(" · ")}</span></li>;
  };
  return (
    <Card aria-label="Critical path" className="flex flex-col gap-2">
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><Route aria-hidden size={18} /> Critical path</h2>
      <p className="m-0 text-sm text-ink-2">These decide the finish: any delay here moves it.</p>
      {critical.length === 0 ? <p className="m-0 text-[15px] text-ink-2">Nothing open is on the critical path.</p> : <ol className="m-0 flex list-none flex-col p-0">{critical.slice(0, 8).map((id) => row(id, ""))}</ol>}
      {near.length > 0 && (
        <>
          <h3 className="m-0 mt-2 text-sm font-bold text-ink-2">Close to critical</h3>
          <ul className="m-0 flex list-none flex-col p-0">{near.map((s) => row(s.id, `${plural(Math.round(s.slack * 10) / 10, "day")} to spare`))}</ul>
        </>
      )}
    </Card>
  );
}

function Lookahead({ math, today }: Props) {
  const until = fromDay(toDay(today) + 14);
  const items = [...math.schedule.tasks.values()]
    .filter((s) => { const t = math.byId.get(s.id); return t && !["done", "skipped"].includes(t.status) && s.start <= until && s.end >= today; })
    .sort((a, b) => a.start.localeCompare(b.start));
  return (
    <Card aria-label="Next two weeks" className="flex flex-col gap-2">
      <h2 className="m-0 text-lg font-bold">Next two weeks</h2>
      <p className="m-0 text-sm text-ink-2">Open work under way or starting by {shortDate(until)}.</p>
      {items.length === 0 ? <p className="m-0 text-[15px] text-ink-2">Nothing in the next two weeks.</p> : (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.slice(0, 10).map((s) => {
            const t = math.byId.get(s.id)!;
            return (
              <li key={s.id} className="flex items-baseline gap-3 border-t border-line py-2 first:border-t-0">
                <span className="w-24 shrink-0 text-sm font-semibold text-ink-2">{t.milestone ? shortDate(s.end) : s.start < today ? "Under way" : shortDate(s.start)}</span>
                <span className="flex min-w-0 flex-col"><span className="text-[15px] font-semibold">{t.title}</span><span className="text-sm text-muted">{[t.owner, t.milestone ? "Milestone" : `until ${shortDate(s.end)}`, s.overdue ? "overdue" : null].filter(Boolean).join(" · ")}</span></span>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 10 && <p className="m-0 text-sm text-muted">and {plural(items.length - 10, "more task")}</p>}
    </Card>
  );
}

function Workload({ plan, math, people, workWeek, today }: Props) {
  const team = useTeamData(plan, math, people, workWeek, today);
  const rows = useMemo(() => team.rows.map((r) => {
    const days = r.days.filter((d) => d.date >= today && d.workday).slice(0, 10);
    const booked = days.reduce((s, d) => s + d.booked, 0);
    const available = days.reduce((s, d) => s + d.available, 0);
    return { name: r.name, booked: Math.round(booked), available: Math.round(available), over: booked > available + 0.01 };
  }).filter((r) => r.booked > 0 || r.available > 0), [team, today]);
  return (
    <Card aria-label="Workload" className="flex flex-col gap-3">
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><Users aria-hidden size={18} /> Workload</h2>
      <p className="m-0 text-sm text-ink-2">Hours booked on this plan over the next 10 working days.</p>
      {rows.length === 0 ? <p className="m-0 text-[15px] text-ink-2">No one has work booked yet.</p> : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {rows.map((r) => (
            <li key={r.name} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2 text-[15px]"><strong>{r.name}</strong><span className={`text-sm ${r.over ? "font-bold text-warn" : "text-ink-2"}`}>{r.booked} of {r.available} h{r.over ? " · overbooked" : ""}</span></span>
              <span aria-hidden className="h-2 overflow-hidden rounded-full bg-line"><span className={`block h-full rounded-full ${r.over ? "bg-warn" : "bg-primary"}`} style={{ width: `${Math.min(100, r.available ? (r.booked / r.available) * 100 : 100)}%` }} /></span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
