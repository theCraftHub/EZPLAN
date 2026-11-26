/**
 * Grid + Gantt (step J3, desktop): a task table you edit in place, beside Gantt bars on the same
 * rows. Every edit is an ordinary live edit. Only the rows near the screen are drawn in either
 * half, so 2,000-task plans stay quick. Phones get a note and a link to the Checklist.
 */
import { memo, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownUp, ArrowDown, ArrowUp } from "lucide-react";
import { allTasks, formatDepends, formatEstimate, fromDay, parseDepends, parseEstimate, toDay, type Op, type Plan, type ScheduledTask, type Task, type TaskStatus } from "@ezplan/shared";
import { shortDate } from "../../lib/format";
import { Link } from "../../lib/router";
import { useIsDesktop, useVisibleRows } from "../../lib/view";
import { Card, Notice } from "../../ui/kit";
import type { usePlanMath } from "./math";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;
const ROW = 40;
const PHASE_ROW = 36;
const ZOOM = { Day: 30, Week: 12 } as const;
const STATUS: Record<TaskStatus, string> = { todo: "To do", progress: "Doing", done: "Done", skipped: "Skipped" };
type Col = "id" | "title" | "owner" | "status" | "start" | "end" | "takes" | "waits" | "slip";
const COLS: { id: Col; label: string; w: number; sort: boolean }[] = [
  { id: "id", label: "ID", w: 52, sort: true },
  { id: "title", label: "Task", w: 210, sort: true },
  { id: "owner", label: "Owner", w: 100, sort: true },
  { id: "status", label: "Status", w: 100, sort: true },
  { id: "start", label: "Start", w: 68, sort: true },
  { id: "end", label: "Finish", w: 68, sort: true },
  { id: "takes", label: "Takes", w: 60, sort: false },
  { id: "waits", label: "Waits on", w: 92, sort: false },
  { id: "slip", label: "Vs baseline", w: 84, sort: true },
];
const GRID_W = COLS.reduce((s, c) => s + c.w, 0);
/** ID and Task stay pinned at the left while the other columns scroll, so you always see which row you're on. */
const PIN: Partial<Record<Col, number>> = { id: 0, title: 52 };
const pinned = (c: Col) => (PIN[c] === undefined ? "" : "sticky z-10 bg-surface");

type Row = { kind: "phase"; top: number; title: string; key: string } | { kind: "task"; top: number; t: Task; s: ScheduledTask };

export function Grid({ plan, math, today, canEdit, edit, planId }: { plan: Plan; math: Math; today: string; canEdit: boolean; edit: (op: Op) => void; planId: string }) {
  const desktop = useIsDesktop();
  const [sort, setSort] = useState<{ col: Col; down: boolean } | null>(null);
  const [zoom, setZoom] = useState<keyof typeof ZOOM>("Day");
  const { schedule } = math;
  const value = (t: Task, s: ScheduledTask, c: Col): string | number => ({ id: Number(t.id.slice(1)) * (t.id[0] === "M" ? 1e6 : 1), title: t.title.toLowerCase(), owner: (t.owner ?? "~").toLowerCase(), status: ["progress", "todo", "done", "skipped"].indexOf(t.status), start: s.start, end: s.end, slip: math.variance.get(t.id) ?? 0, takes: 0, waits: 0 })[c];
  const { rows, total, tops } = useMemo(() => {
    const out: Row[] = [];
    let y = 0;
    if (sort) {
      const list = allTasks(plan).map((t) => ({ t, s: schedule.tasks.get(t.id) })).filter((r): r is { t: Task; s: ScheduledTask } => !!r.s);
      // Ties keep the plan's order, so sorting is stable.
      list.sort((a, b) => { const x = value(a.t, a.s, sort.col), z = value(b.t, b.s, sort.col); return x === z ? 0 : (x < z ? -1 : 1) * (sort.down ? -1 : 1); });
      for (const r of list) { out.push({ kind: "task", top: y, ...r }); y += ROW; }
    } else {
      for (const ph of plan.phases) {
        out.push({ kind: "phase", top: y, title: ph.title, key: ph.id });
        y += PHASE_ROW;
        for (const t of ph.tasks) { const s = schedule.tasks.get(t.id); if (!s) continue; out.push({ kind: "task", top: y, t, s }); y += ROW; }
      }
    }
    return { rows: out, total: y, tops: out.map((r) => r.top) };
  }, [plan, schedule, sort, math.variance]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = useMemo(() => new Set(allTasks(plan).map((x) => x.id)), [plan]);
  const body = useRef<HTMLDivElement>(null);
  const range = useVisibleRows(body, tops, total);
  const visible = rows.slice(range[0], range[1]);

  const px = ZOOM[zoom];
  const first = toDay(schedule.projectStart < today ? schedule.projectStart : today) - 1;
  const days = useMemo(() => Array.from({ length: toDay(schedule.finish) + 3 - first + 1 }, (_, i) => fromDay(first + i)), [first, schedule.finish]);
  const x = (iso: string) => (toDay(iso) - first) * px;
  const ganttW = days.length * px;
  const weekend = (iso: string) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());
  // Drawn once per zoom and date range, not on every scroll.
  const weekends = useMemo(() => days.map((d, i) => weekend(d) && <span key={d} className="absolute top-0 bottom-0 bg-surface-2" style={{ left: i * px, width: px }} />), [days, px]); // eslint-disable-line react-hooks/exhaustive-deps
  const dayHeads = useMemo(() => days.map((d) => { const show = zoom === "Day" || new Date(`${d}T12:00:00Z`).getUTCDay() === 1; return <span key={d} className="shrink-0 text-center text-[11px] text-muted" style={{ width: px }}>{show ? (zoom === "Day" ? new Date(`${d}T12:00:00Z`).getUTCDate() : shortDate(d)) : ""}</span>; }), [days, px, zoom]);

  if (!desktop) return <Notice>The grid works best on a larger screen. On a phone, use the <Link to={`/p/${planId}/checklist`} className="font-semibold underline">Checklist</Link> to see and change tasks.</Notice>;

  const header = "sticky top-0 z-20 flex h-9 items-center border-b border-line bg-surface";
  return (
    <Card aria-label="Grid and Gantt" className="flex flex-col gap-3 p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <p className="m-0 text-sm text-ink-2">Click a cell to change it; Enter saves, Escape cancels. {sort ? <button className="font-semibold text-primary-ink underline" onClick={() => setSort(null)}>Group by phase again</button> : "Grouped by phase; click a column to sort."}</p>
        <div role="radiogroup" aria-label="Zoom" className="flex rounded-xl bg-surface-2 p-1">
          {(Object.keys(ZOOM) as (keyof typeof ZOOM)[]).map((z) => <button key={z} role="radio" aria-checked={zoom === z} onClick={() => setZoom(z)} className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${zoom === z ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>{z}</button>)}
        </div>
      </div>
      <div className="flex border-t border-line">
        {/* The table */}
        <div className="max-w-[64%] shrink-0 overflow-x-auto border-r border-line" style={{ width: GRID_W }} tabIndex={-1}>
          <div role="table" aria-label="Tasks" aria-rowcount={rows.length + 1} style={{ width: GRID_W }}>
            <div role="row" className={header}>
              {COLS.map((c) => (
                <div key={c.id} role="columnheader" aria-sort={sort?.col === c.id ? (sort.down ? "descending" : "ascending") : "none"} className={`shrink-0 px-2 ${pinned(c.id)}`} style={{ width: c.w, left: PIN[c.id] }}>
                  {c.sort ? (
                    <button onClick={() => setSort(sort?.col === c.id ? (sort.down ? null : { col: c.id, down: true }) : { col: c.id, down: false })} className="flex min-h-9 items-center gap-1 text-xs font-bold text-muted uppercase">
                      {c.label} {sort?.col === c.id ? (sort.down ? <ArrowDown aria-hidden size={12} /> : <ArrowUp aria-hidden size={12} />) : <ArrowDownUp aria-hidden size={12} className="opacity-40" />}
                    </button>
                  ) : <span className="text-xs font-bold text-muted uppercase">{c.label}</span>}
                </div>
              ))}
            </div>
            <div ref={body} role="rowgroup" className="relative" style={{ height: total }}>
              {visible.map((r, i) => r.kind === "phase" ? (
                <div key={`p-${r.key}`} role="row" aria-rowindex={range[0] + i + 2} className="absolute inset-x-0 flex items-center border-t border-line bg-surface-2 px-2 text-sm font-bold" style={{ top: r.top, height: PHASE_ROW }}><span role="cell" className="sticky left-2">{r.title}</span></div>
              ) : (
                <TaskRow key={r.t.id} r={r} index={range[0] + i + 2} ids={ids} slip={math.variance.get(r.t.id)} canEdit={canEdit} edit={edit} />
              ))}
            </div>
          </div>
        </div>
        {/* The Gantt, on the same rows */}
        <div className="min-w-0 flex-1 overflow-x-auto" tabIndex={0} aria-label="Gantt chart, scroll sideways">
          <div className="relative" style={{ width: ganttW }}>
            <div className={header} aria-hidden>
              {dayHeads}
            </div>
            <div className="relative" style={{ height: total }} aria-hidden>
              {weekends}
              {today >= days[0]! && today <= days.at(-1)! && <span className="absolute top-0 bottom-0 z-[5] w-0.5 bg-primary" style={{ left: x(today) + px / 2 }} />}
              {visible.map((r) => {
                if (r.kind === "phase") return <span key={`p-${r.key}`} className="absolute inset-x-0 border-t border-line" style={{ top: r.top, height: PHASE_ROW }} />;
                const { t, s } = r;
                const done = t.status === "done";
                return (
                  <span key={t.id} className="absolute inset-x-0" style={{ top: r.top, height: ROW }}>
                    {t.planned && <span title="Baseline" className="absolute top-[26px] h-1.5 rounded-sm bg-ink/20" style={{ left: x(t.planned.start), width: x(t.planned.end) - x(t.planned.start) + px }} />}
                    {t.milestone
                      ? <span className={`absolute top-3 h-3.5 w-3.5 rotate-45 ${done ? "bg-good" : "bg-primary"} ${s.critical ? "ring-2 ring-bad" : ""}`} style={{ left: x(s.end) + px / 2 - 7 }} />
                      : <span className={`absolute top-2 h-5 rounded-md ${done ? "bg-good-soft" : t.status === "progress" ? "bg-primary" : "bg-primary-soft"} ${s.critical ? "ring-2 ring-bad" : ""}`} style={{ left: x(s.start) + 1, width: Math.max(px - 2, x(s.end) - x(s.start) + px - 2) }} />}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <p className="m-0 px-4 pb-4 text-sm text-ink-2"><span className="font-semibold text-bad">Red outline</span> = critical path. Thin gray bar under a task = its baseline.</p>
    </Card>
  );
}

/** One task's row of cells. Text cells become inputs when clicked; Enter saves, Escape cancels. */
const TaskRow = memo(function TaskRow({ r, index, ids, slip, canEdit, edit }: { r: Extract<Row, { kind: "task" }>; index: number; ids: Set<string>; slip: number | undefined; canEdit: boolean; edit: (op: Op) => void }) {
  const { t, s } = r;
  const set = (field: "title" | "owner" | "estimate" | "depends", value: unknown) => edit({ kind: "setField", taskId: t.id, field, value });
  const cell = (c: Col, children: ReactNode) => <div key={c} role="cell" className={`flex h-full shrink-0 items-center overflow-hidden px-2 text-[13px] ${pinned(c)}`} style={{ width: COLS.find((x) => x.id === c)!.w, left: PIN[c] }}>{children}</div>;
  return (
    <div role="row" aria-rowindex={index} aria-label={t.title} className="absolute inset-x-0 flex border-t border-line" style={{ top: r.top, height: ROW }}>
      {cell("id", <span className="font-mono text-xs text-muted">{t.id}</span>)}
      {cell("title", <Editable label={`Task name for ${t.id}`} value={t.title} canEdit={canEdit} onSave={(v) => v.trim() && v !== t.title && set("title", v.trim())} strong />)}
      {cell("owner", <Editable label={`Owner of ${t.title}`} value={t.owner ?? ""} canEdit={canEdit && !t.milestone} onSave={(v) => v.trim() !== (t.owner ?? "") && set("owner", v.trim() || null)} />)}
      {cell("status", t.milestone ? <span className="text-xs font-semibold text-primary-ink">Milestone</span> : (
        <select aria-label={`Status of ${t.title}`} disabled={!canEdit} value={t.status} onChange={(e) => edit({ kind: "setStatus", taskId: t.id, status: e.target.value as TaskStatus })} className="h-8 w-full rounded-lg border border-line bg-surface px-1 text-[13px]">
          {(Object.keys(STATUS) as TaskStatus[]).map((k) => <option key={k} value={k}>{STATUS[k]}</option>)}
        </select>
      ))}
      {cell("start", <span className={s.overdue && t.status !== "done" ? "font-semibold text-warn" : ""}>{t.milestone ? "" : shortDate(s.start)}</span>)}
      {cell("end", shortDate(s.end))}
      {cell("takes", t.milestone ? "" : <Editable label={`How long ${t.title} takes`} value={t.estimate ? formatEstimate(t.estimate) : ""} canEdit={canEdit} check={(v) => !v.trim() || !!parseEstimate(v)} onSave={(v) => { const e = v.trim() ? parseEstimate(v) : null; if (JSON.stringify(e ?? null) !== JSON.stringify(t.estimate ?? null)) set("estimate", e ?? null); }} />)}
      {cell("waits", <Editable label={`What ${t.title} waits on`} value={formatDepends(t.depends)} canEdit={canEdit} check={(v) => parseDepends(v).every((d) => ids.has(d.id) && d.id !== t.id)} onSave={(v) => { const d = parseDepends(v); if (formatDepends(d) !== formatDepends(t.depends)) set("depends", d); }} />)}
      {cell("slip", slip ? <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${slip > 0 ? "bg-warn-soft text-warn" : "bg-good-soft text-good"}`}>{slip > 0 ? `+${slip}d` : `${slip}d`}</span> : t.planned ? <span className="text-xs text-muted">On time</span> : <span className="text-xs text-muted">–</span>)}
    </div>
  );
}, (a, b) => a.r.t === b.r.t && a.r.s.start === b.r.s.start && a.r.s.end === b.r.s.end && a.r.s.overdue === b.r.s.overdue && a.r.top === b.r.top && a.index === b.index && a.slip === b.slip && a.canEdit === b.canEdit && a.edit === b.edit && a.ids === b.ids);

function Editable({ label, value, canEdit, onSave, check, strong }: { label: string; value: string; canEdit: boolean; onSave: (v: string) => void; check?: (v: string) => boolean; strong?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!canEdit) return <span className={`truncate ${strong ? "font-semibold" : ""}`}>{value}</span>;
  if (draft === null) return <button aria-label={`${label}: ${value || "empty"}. Change`} onClick={() => setDraft(value)} className={`h-8 w-full truncate rounded-md px-1 text-left hover:bg-surface-2 ${strong ? "font-semibold" : ""}`}>{value || <span className="text-muted">–</span>}</button>;
  const bad = check ? !check(draft) : false;
  const done = (save: boolean) => { if (save && !bad) onSave(draft); setDraft(null); };
  return (
    <input autoFocus aria-label={label} aria-invalid={bad} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => done(true)}
      onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); done(true); } else if (e.key === "Escape") { e.preventDefault(); done(false); } }}
      className={`h-8 w-full rounded-md border bg-surface px-1 text-[13px] ${bad ? "border-bad" : "border-primary"}`} />
  );
}
