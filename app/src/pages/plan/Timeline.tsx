/**
 * Gantt timeline: bars from the same schedule as everything else, critical path marked, today line.
 * Editors move a task by dragging its bar sideways (mouse or pen) or with the arrow keys on a focused
 * bar; that sets "can't start before" (step N5b), and the schedule does the rest.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Op } from "@rakuplan/shared";
import { useVisibleRows } from "../../lib/view";
import type { ScheduledTask, Task } from "@rakuplan/shared";
import { toDay, fromDay, type Plan } from "@rakuplan/shared";
import { shortDate } from "../../lib/format";
import { Card } from "../../ui/kit";
import type { usePlanMath } from "./math";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;
const ZOOM = { Day: 36, Week: 14 } as const;

export function Timeline({ plan, math, today, canEdit = false, edit }: { plan: Plan; math: Math; today: string; canEdit?: boolean; edit?: (op: Op) => void }) {
  const [zoom, setZoom] = useState<keyof typeof ZOOM>("Day");
  const [drag, setDrag] = useState<{ id: string; x0: number; dx: number } | null>(null);
  const [said, setSaid] = useState("");
  // Task names take less room on phones, so more of the chart shows.
  const NAME_W = typeof window !== "undefined" && window.innerWidth < 640 ? 128 : 200;
  const px = ZOOM[zoom];
  const { schedule } = math;
  const first = toDay(schedule.projectStart < today ? schedule.projectStart : today) - 1;
  const last = toDay(schedule.finish) + 3;
  const days = useMemo(() => Array.from({ length: last - first + 1 }, (_, i) => fromDay(first + i)), [first, last]);
  const x = (iso: string) => (toDay(iso) - first) * px;
  const width = days.length * px;
  // Big plans: only the rows near the screen are drawn (each row has a fixed height).
  const { rows, total, tops } = useMemo(() => {
    type Row = { kind: "phase"; top: number; phase: Plan["phases"][number]; start: string | null; end: string | null } | { kind: "task"; top: number; t: Task; s: ScheduledTask };
    const out: Row[] = [];
    let y = 0;
    for (const ph of plan.phases) {
      const ss = ph.tasks.map((t) => schedule.tasks.get(t.id)).filter((s): s is ScheduledTask => !!s);
      out.push({ kind: "phase", top: y, phase: ph, start: ss.length ? ss.reduce((a, b) => (a.start < b.start ? a : b)).start : null, end: ss.length ? ss.reduce((a, b) => (a.end > b.end ? a : b)).end : null });
      y += 36;
      for (const t of ph.tasks) {
        const s = schedule.tasks.get(t.id);
        if (!s) continue;
        out.push({ kind: "task", top: y, t, s });
        y += 40;
      }
    }
    return { rows: out, total: y, tops: out.map((r) => r.top) };
  }, [plan, schedule]);
  const listRef = useRef<HTMLUListElement>(null);
  const range = useVisibleRows(listRef, tops, total);
  const movable = (t: Task) => canEdit && !!edit && !t.milestone && t.status !== "done" && t.status !== "skipped";
  /** Sets the earliest start to the bar's new first day. */
  const moveTo = (t: Task, s: ScheduledTask, days: number) => {
    if (!days || !edit) return;
    const day = fromDay(toDay(s.start) + days);
    edit({ kind: "setField", taskId: t.id, field: "notBefore", value: day });
    setSaid(`${t.title} can't start before ${shortDate(day)} now. If it waits on other work it may still start later; clear the date in the task to undo.`);
  };
  const down = (e: PointerEvent, t: Task) => {
    if (!movable(t) || e.pointerType === "touch" || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: t.id, x0: e.clientX, dx: 0 });
  };
  const moveBy = (e: PointerEvent) => { if (drag) setDrag({ ...drag, dx: e.clientX - drag.x0 }); };
  const up = (t: Task, s: ScheduledTask) => {
    if (!drag) return;
    const days = Math.round(drag.dx / px);
    setDrag(null);
    moveTo(t, s, days);
  };
  const key = (e: KeyboardEvent, t: Task, s: ScheduledTask) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    moveTo(t, s, (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 7 : 1));
  };
  const isWeekend = (iso: string) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());
  return (
    <Card aria-label="Timeline" className="flex flex-col gap-3 p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <p className="m-0 text-sm text-ink-2">{shortDate(schedule.projectStart)} to {shortDate(schedule.finish)} · <span className="font-semibold text-bad">Red outline</span> = critical path: these tasks decide the finish date.</p>
        {said && <p role="status" className="m-0 w-full text-sm text-ink-2 sm:order-last">{said}</p>}
        <div role="radiogroup" aria-label="Zoom" className="flex rounded-xl bg-surface-2 p-1">
          {(Object.keys(ZOOM) as (keyof typeof ZOOM)[]).map((z) => (
            <button key={z} role="radio" aria-checked={zoom === z} onClick={() => setZoom(z)} className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${zoom === z ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>{z}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto" tabIndex={0} aria-label="Timeline chart, scroll sideways">
        <div className="relative" style={{ width: NAME_W + width }}>
          {/* date header */}
          <div className="sticky top-0 z-10 flex border-b border-line bg-surface" style={{ paddingLeft: NAME_W }}>
            {days.map((d) => {
              const monday = new Date(`${d}T12:00:00Z`).getUTCDay() === 1;
              const show = zoom === "Day" || monday;
              return <div key={d} className={`shrink-0 py-2 text-center text-[11px] ${isWeekend(d) ? "text-muted/70" : "text-muted"}`} style={{ width: px }}>{show ? (zoom === "Day" ? new Date(`${d}T12:00:00Z`).getUTCDate() : shortDate(d)) : ""}</div>;
            })}
          </div>
          <div className="relative">
            {/* weekends and today */}
            {days.map((d) => isWeekend(d) && <div key={d} aria-hidden className="absolute top-0 bottom-0 bg-surface-2" style={{ left: NAME_W + x(d), width: px }} />)}
            {today >= days[0]! && today <= days.at(-1)! && <div aria-hidden className="absolute top-0 bottom-0 z-[5] w-0.5 bg-primary" style={{ left: NAME_W + x(today) + px / 2 }} />}
            <ul className="relative m-0 list-none p-0" style={{ height: total }} ref={listRef} aria-label="Phases and tasks">
              {rows.slice(range[0], range[1]).map((r) => {
                if (r.kind === "phase") {
                  return (
                    <li key={`ph-${r.phase.id}`} className="absolute inset-x-0 flex h-9 items-center border-t border-line" style={{ top: r.top }}>
                      <span className="sticky left-0 z-[6] flex h-full shrink-0 items-center truncate bg-surface px-4 text-sm font-bold" style={{ width: NAME_W }}>{r.phase.title}</span>
                      {r.start && r.end && <span aria-hidden className="absolute h-2 rounded-full bg-ink/25" style={{ left: NAME_W + x(r.start), width: x(r.end) - x(r.start) + px }} />}
                    </li>
                  );
                }
                const { t, s } = r;
                const done = t.status === "done";
                const label = `${t.title}: ${t.milestone ? shortDate(s.end) : `${shortDate(s.start)} to ${shortDate(s.end)}`}${s.critical ? ", critical" : ""}${done ? ", done" : ""}`;
                return (
                  <li key={t.id} className="absolute inset-x-0 flex h-10 items-center" style={{ top: r.top }} aria-label={label}>
                    <span className="sticky left-0 z-[6] flex h-full shrink-0 items-center truncate bg-surface px-4 pl-6 text-[13px] text-ink-2" style={{ width: NAME_W }}>{t.title}</span>
                    {t.planned && <span aria-hidden title="Baseline" className="absolute h-2 translate-y-3 rounded-sm bg-ink/15" style={{ left: NAME_W + x(t.planned.start), width: x(t.planned.end) - x(t.planned.start) + px }} />}
                    {t.milestone ? (
                      <span aria-hidden className={`absolute h-3.5 w-3.5 rotate-45 ${done ? "bg-good" : "bg-primary"} ${s.critical ? "ring-2 ring-bad" : ""}`} style={{ left: NAME_W + x(s.end) + px / 2 - 7 }} />
                    ) : (
                      <span
                        {...(movable(t)
                          ? { role: "button", tabIndex: 0, "aria-label": `Move ${t.title}, starts ${shortDate(s.start)}`, "aria-description": "Drag sideways, or use the left and right arrow keys (Shift for a week), to change the day it can start." }
                          : { "aria-hidden": true })}
                        onPointerDown={(e) => down(e, t)} onPointerMove={moveBy} onPointerUp={() => up(t, s)} onPointerCancel={() => setDrag(null)} onKeyDown={(e) => movable(t) && key(e, t, s)}
                        className={`absolute flex h-6 items-center overflow-hidden rounded-md px-1.5 text-[11px] font-semibold whitespace-nowrap ${done ? "bg-good-soft text-good" : t.status === "progress" ? "bg-primary text-white dark:text-ground" : "bg-primary-soft text-primary-ink"} ${s.critical ? "ring-2 ring-bad" : ""} ${movable(t) ? "cursor-ew-resize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" : ""} ${drag?.id === t.id ? "z-[7] opacity-80 shadow-lg" : ""}`}
                        style={{ left: NAME_W + x(s.start) + 1 + (drag?.id === t.id ? Math.round(drag.dx / px) * px : 0), width: Math.max(px - 2, x(s.end) - x(s.start) + px - 2) }}>
                        {zoom === "Day" ? t.owner ?? "" : ""}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}
