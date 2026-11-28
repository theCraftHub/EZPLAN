/**
 * The desktop Overview (step J2): widgets each person can hide and reorder, saved to their account.
 * Every number comes from the same engine as the rest of the plan page. Phones keep the compact Overview.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Eye, EyeOff, GripVertical, LayoutGrid, Route, TriangleAlert, Users, Wallet } from "lucide-react";
import { fromDay, toDay, type Op, type PersonAvailability, type Plan, type WorkWeek } from "@rakuplan/shared";
import { api, type UpdateState } from "../../lib/api";
import { plural, shortDate } from "../../lib/format";
import { Button, Card, ProgressRing } from "../../ui/kit";
import { Link } from "../../lib/router";
import { RecentActivity } from "./Activity";
import type { usePlanMath } from "./math";
import { Baseline, LatestUpdate, UpNext } from "./OverviewCards";
import { PlanCheck } from "./PlanCheck";
import { BudgetCard } from "./Budget";
import { TryChange } from "./TryChange";
import { useTeamData } from "./teamData";
import { pack } from "./pack";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;
type Props = { plan: Plan; math: Math; today: string; canEdit: boolean; edit: (op: Op) => void; planId: string; version: number; statusUpdate: UpdateState; people: Record<string, PersonAvailability>; workWeek: WorkWeek; raidOpen: { risks: number; issues: number }; inMaster?: boolean };

/** Each widget's default width (of 12 columns) and the widths it can take. */
export const WIDGETS = [
  { id: "kpis", title: "Key numbers", w: 12, sizes: [8, 12] },
  { id: "milestones", title: "Milestones", w: 12, sizes: [6, 8, 12] },
  { id: "update", title: "Latest status update", w: 6, sizes: [4, 6, 8, 12] },
  { id: "baseline", title: "Baseline", w: 6, sizes: [4, 6, 8, 12] },
  { id: "critical", title: "Critical path", w: 6, sizes: [4, 6, 8, 12] },
  { id: "lookahead", title: "Next two weeks", w: 6, sizes: [4, 6, 8, 12] },
  { id: "workload", title: "Workload", w: 6, sizes: [4, 6, 8, 12] },
  { id: "upnext", title: "Up next", w: 6, sizes: [4, 6, 8, 12] },
  { id: "check", title: "Plan Check", w: 6, sizes: [4, 6, 8, 12] },
  { id: "budget", title: "Budget", w: 6, sizes: [4, 6, 8, 12] },
  { id: "whatif", title: "Try a change", w: 6, sizes: [4, 6, 8, 12] },
  { id: "activity", title: "Recent activity", w: 6, sizes: [4, 6, 8, 12] },
] as const;
type WidgetId = (typeof WIDGETS)[number]["id"];
type Layout = { order: WidgetId[]; hidden: WidgetId[]; sizes: Partial<Record<WidgetId, number>> };
const PREF = "overview.widgets";
const DEFAULT: Layout = { order: WIDGETS.map((w) => w.id), hidden: [], sizes: {} };
const COLS = 12;
const GAP = 16;
const SIZE_WORD: Record<number, string> = { 4: "Third", 6: "Half", 8: "Two thirds", 12: "Full" };
const SIZE_MARK: Record<number, string> = { 4: "⅓", 6: "½", 8: "⅔", 12: "Full" };
const spec = (id: WidgetId) => WIDGETS.find((x) => x.id === id)!;

/** A saved layout, made safe: unknown ids and widths dropped, new widgets added at the end. */
export function normalizeLayout(v: unknown): Layout {
  const ids = new Set<string>(WIDGETS.map((w) => w.id));
  const raw = (v && typeof v === "object" ? v : {}) as { order?: unknown; hidden?: unknown; sizes?: unknown };
  const order = (Array.isArray(raw.order) ? raw.order : []).filter((x): x is WidgetId => typeof x === "string" && ids.has(x));
  const uniq = order.filter((x, i) => order.indexOf(x) === i);
  const hidden = (Array.isArray(raw.hidden) ? raw.hidden : []).filter((x): x is WidgetId => typeof x === "string" && ids.has(x));
  const sizes: Layout["sizes"] = {};
  if (raw.sizes && typeof raw.sizes === "object") for (const [k, n] of Object.entries(raw.sizes)) if (ids.has(k) && (spec(k as WidgetId).sizes as readonly number[]).includes(n as number)) sizes[k as WidgetId] = n as number;
  return { order: [...uniq, ...DEFAULT.order.filter((x) => !uniq.includes(x))], hidden, sizes };
}

/**
 * Widgets keep their natural height and the width each person picks; the packer (pack.ts) places
 * them so smaller ones fill the gaps beside taller ones. While dragging, the others reflow live.
 */
export function Dashboard(p: Props) {
  const [layout, setLayout] = useState<Layout>(DEFAULT);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const [draft, setDraft] = useState<WidgetId[] | null>(null);
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const area = useRef<HTMLDivElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const lastOver = useRef("");
  useEffect(() => void api.getPref(PREF).then((r) => setLayout(normalizeLayout(r.value))).catch(() => {}), []);

  // The area's width, and each widget's natural height, drive the packing.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    observer.current = new ResizeObserver((entries) => {
      setHeights((h) => {
        let next = h;
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.widget!;
          const px = Math.round((e.target as HTMLElement).offsetHeight);
          if (Math.abs((h[id] ?? -99) - px) > 1) next = { ...next, [id]: px };
        }
        return next;
      });
    });
    return () => observer.current?.disconnect();
  }, []);
  const watch = (el: HTMLDivElement | null) => { if (el) observer.current?.observe(el); };

  const save = (next: Layout) => { setLayout(next); void api.setPref(PREF, next).catch(() => {}); };
  const move = (id: WidgetId, to: number) => {
    const order = layout.order.filter((x) => x !== id);
    order.splice(Math.max(0, Math.min(order.length, to)), 0, id);
    save({ ...layout, order });
  };
  const order = draft ?? layout.order;
  const visible = editing ? order : order.filter((id) => !layout.hidden.includes(id));
  const sizeOf = (id: WidgetId) => layout.sizes[id] ?? spec(id).w;
  const { boxes, height } = useMemo(() => pack(visible.filter((id) => editing || heights[id] !== 0).map((id) => ({ id, w: sizeOf(id), h: heights[id] ?? 240 })), COLS, GAP), [visible.join(), JSON.stringify(layout.sizes), heights, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const col = (width - GAP * (COLS - 1)) / COLS;

  // Live reorder while dragging: drop before or after the widget under the pointer (reading order).
  const over = (e: DragEvent, target: WidgetId) => {
    if (!dragging) return;
    e.preventDefault();
    if (target === dragging) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const dy = e.clientY - (r.top + r.height / 2);
    const after = dy > r.height / 4 || (Math.abs(dy) <= r.height / 4 && e.clientX > r.left + r.width / 2);
    const key = `${target}:${after}`;
    if (key === lastOver.current) return;
    lastOver.current = key;
    const next = order.filter((x) => x !== dragging);
    next.splice(next.indexOf(target) + (after ? 1 : 0), 0, dragging);
    if (next.join() !== order.join()) setDraft(next);
  };
  const finish = () => {
    if (draft && draft.join() !== layout.order.join()) save({ ...layout, order: draft });
    setDraft(null);
    setDragging(null);
    lastOver.current = "";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing && <span className="mr-auto max-w-2xl text-sm text-ink-2">Drag a widget and the others move to fill the space. Pick each widget's width; heights follow what's in it. Hidden widgets stay here, faded, until you show them. Saved for you only.</span>}
        {editing && <Button variant="secondary" onClick={() => save(DEFAULT)}>Reset layout</Button>}
        <Button variant={editing ? "primary" : "secondary"} onClick={() => setEditing(!editing)} aria-pressed={editing}><LayoutGrid aria-hidden size={18} /> {editing ? "Done" : "Customize"}</Button>
      </div>
      <div ref={area} className="relative" style={{ height }} onDragOver={(e) => dragging && e.preventDefault()} onDrop={(e) => { e.preventDefault(); finish(); }}>
        {width > 0 && visible.filter((id) => !boxes.some((b) => b.id === id)).map((id) => (
          // Empty right now (e.g. no activity yet): kept mounted, unplaced, so it can appear when it has content.
          <div key={id} data-widget={id} ref={watch} className="invisible absolute" style={{ width: (sizeOf(id) * col + (sizeOf(id) - 1) * GAP) }}><Widget id={id} {...p} /></div>
        ))}
        {width > 0 && boxes.map((b) => {
          const id = b.id as WidgetId;
          const w = spec(id);
          const i = layout.order.indexOf(id);
          const hidden = layout.hidden.includes(id);
          const place = { left: b.x * (col + GAP), top: b.y, width: b.w * col + (b.w - 1) * GAP };
          const body = <Widget id={id} {...p} />;
          return (
            <div key={id} data-widget={id} ref={watch} style={place} className={`absolute ${editing ? "motion-safe:transition-[left,top,width] motion-safe:duration-200" : ""} ${dragging === id ? "opacity-50" : ""}`}>
              {!editing ? body : (
                <section
                  aria-label={`${w.title} widget`}
                  draggable
                  onDragStart={(e: DragEvent) => { setDragging(id); setDraft(layout.order); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", w.title); }}
                  onDragOver={(e: DragEvent) => over(e, id)}
                  onDrop={(e: DragEvent) => { e.preventDefault(); e.stopPropagation(); finish(); }}
                  onDragEnd={finish}
                  className={`flex flex-col gap-2 rounded-2xl p-2 outline-2 outline-dashed ${dragging === id ? "outline-primary" : "outline-line"}`}
                >
                  <div className="flex flex-wrap items-center gap-2 px-1">
                    <GripVertical aria-hidden size={18} className="cursor-grab text-muted" />
                    <strong className="min-w-0 flex-1 text-sm">{w.title}{hidden ? " (hidden)" : ""}</strong>
                    <span role="group" aria-label={`Width of ${w.title}`} className="flex overflow-hidden rounded-lg ring-1 ring-line">
                      {w.sizes.map((n) => (
                        <button key={n} aria-pressed={sizeOf(id) === n} aria-label={`${SIZE_WORD[n]} width`} onClick={() => save({ ...layout, sizes: { ...layout.sizes, [id]: n } })} className={`h-10 min-w-10 px-2 text-sm font-semibold ${sizeOf(id) === n ? "bg-primary text-white dark:text-ground" : "text-ink-2"}`}>{SIZE_MARK[n]}</button>
                      ))}
                    </span>
                    <button aria-label={`Move ${w.title} up`} disabled={i === 0} onClick={() => move(id, i - 1)} className="flex h-10 w-10 items-center justify-center rounded-lg ring-1 ring-line disabled:opacity-40"><ArrowUp aria-hidden size={16} /></button>
                    <button aria-label={`Move ${w.title} down`} disabled={i === layout.order.length - 1} onClick={() => move(id, i + 1)} className="flex h-10 w-10 items-center justify-center rounded-lg ring-1 ring-line disabled:opacity-40"><ArrowDown aria-hidden size={16} /></button>
                    <button aria-label={hidden ? `Show ${w.title}` : `Hide ${w.title}`} onClick={() => save({ ...layout, hidden: hidden ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] })} className="flex h-10 w-10 items-center justify-center rounded-lg ring-1 ring-line">
                      {hidden ? <Eye aria-hidden size={16} /> : <EyeOff aria-hidden size={16} />}
                    </button>
                  </div>
                  <div className={hidden ? "pointer-events-none opacity-40" : ""}>{body}</div>
                </section>
              )}
            </div>
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
    case "whatif": return p.inMaster ? <Card aria-label="Try a change" className="flex flex-col gap-2"><h2 className="m-0 text-lg font-bold">Try a change</h2><p className="m-0 text-sm text-ink-2">This plan is part of a master plan, so its dates depend on the others. Try changes from the master plan's Overview.</p></Card> : <TryChange plan={p.plan} planId={p.planId} people={p.people} workWeek={p.workWeek} today={p.today} canEdit={p.canEdit} edit={p.edit} />;
    case "budget": return <Card aria-label="Budget" className="flex flex-col gap-2"><h2 className="m-0 flex items-center gap-2 text-lg font-bold"><Wallet aria-hidden size={18} /> Budget</h2><BudgetCard plan={p.plan} planId={p.planId} people={p.people} workWeek={p.workWeek} /></Card>;
  }
}

function Kpis({ math, raidOpen, planId }: Props) {
  const { progress, schedule, check } = math;
  const v = progress.baselineVarianceDays;
  const forecast = progress.forecastFinish ?? schedule.finish;
  const item = "flex flex-col gap-1";
  return (
    <Card aria-label="Key numbers">
      <dl className="m-0 grid grid-cols-3 gap-4 xl:grid-cols-6">
        <div className="flex items-center gap-3"><ProgressRing percent={progress.percent} size={56} /><div className={item}><dt className="text-sm text-muted">Progress</dt><dd className="m-0 text-[15px] font-semibold">{progress.doneCount} of {plural(progress.countedTasks, "task")} done</dd></div></div>
        <div className={item}><dt className="text-sm text-muted">Vs baseline</dt><dd className={`m-0 text-lg font-bold ${v && v > 0 ? "text-warn" : v && v < 0 ? "text-good" : ""}`}>{v === null ? "No baseline" : v === 0 ? "On time" : v > 0 ? `${v}d late` : `${-v}d early`}</dd></div>
        <div className={item}><dt className="flex items-center gap-1 text-sm text-muted"><CalendarClock aria-hidden size={15} /> Forecast finish</dt><dd className={`m-0 text-lg font-bold ${forecast > schedule.finish ? "text-warn" : ""}`}>{shortDate(forecast)}</dd>{forecast > schedule.finish && <dd className="m-0 text-xs text-ink-2">Planned {shortDate(schedule.finish)}</dd>}</div>
        <div className={item}><dt className="flex items-center gap-1 text-sm text-muted"><TriangleAlert aria-hidden size={15} /> Overdue</dt><dd className={`m-0 text-lg font-bold ${progress.overdueCount ? "text-warn" : ""}`}>{progress.overdueCount ? plural(progress.overdueCount, "task") : "Nothing"}</dd></div>
        <div className={item}><dt className="text-sm text-muted">Open risks and issues</dt><dd className={`m-0 text-lg font-bold ${raidOpen.risks + raidOpen.issues ? "text-warn" : ""}`}><Link to={`/p/${planId}/risks`} className="underline decoration-1 underline-offset-4">{raidOpen.risks + raidOpen.issues ? `${raidOpen.risks} risk${raidOpen.risks === 1 ? "" : "s"}, ${raidOpen.issues} issue${raidOpen.issues === 1 ? "" : "s"}` : "None open"}</Link></dd></div>
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
