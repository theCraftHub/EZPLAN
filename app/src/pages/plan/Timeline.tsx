/** Gantt timeline: bars from the same schedule as everything else, critical path marked, today line. */
import { useMemo, useState } from "react";
import { toDay, fromDay, type Plan } from "@ezplan/shared";
import { shortDate } from "../../lib/format";
import { Card } from "../../ui/kit";
import type { usePlanMath } from "./math";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;
const ZOOM = { Day: 36, Week: 14 } as const;

export function Timeline({ plan, math, today }: { plan: Plan; math: Math; today: string }) {
  const [zoom, setZoom] = useState<keyof typeof ZOOM>("Day");
  // Task names take less room on phones, so more of the chart shows.
  const NAME_W = typeof window !== "undefined" && window.innerWidth < 640 ? 128 : 200;
  const px = ZOOM[zoom];
  const { schedule } = math;
  const first = toDay(schedule.projectStart < today ? schedule.projectStart : today) - 1;
  const last = toDay(schedule.finish) + 3;
  const days = useMemo(() => Array.from({ length: last - first + 1 }, (_, i) => fromDay(first + i)), [first, last]);
  const x = (iso: string) => (toDay(iso) - first) * px;
  const width = days.length * px;
  const isWeekend = (iso: string) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());
  return (
    <Card aria-label="Timeline" className="flex flex-col gap-3 p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <p className="m-0 text-sm text-ink-2">{shortDate(schedule.projectStart)} to {shortDate(schedule.finish)} · <span className="font-semibold text-bad">Red outline</span> = critical path: these tasks decide the finish date.</p>
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
            <ul className="relative m-0 list-none p-0">
              {plan.phases.map((ph) => {
                const ids = ph.tasks.map((t) => schedule.tasks.get(t.id)).filter(Boolean);
                const ps = ids.length ? ids.reduce((a, b) => (a!.start < b!.start ? a : b))!.start : null;
                const pe = ids.length ? ids.reduce((a, b) => (a!.end > b!.end ? a : b))!.end : null;
                return (
                  <li key={ph.id}>
                    <div className="relative flex h-9 items-center border-t border-line">
                      <span className="sticky left-0 z-[6] flex h-full shrink-0 items-center truncate bg-surface px-4 text-sm font-bold" style={{ width: NAME_W }}>{ph.title}</span>
                      {ps && pe && <span aria-hidden className="absolute h-2 rounded-full bg-ink/25" style={{ left: NAME_W + x(ps), width: x(pe) - x(ps) + px }} />}
                    </div>
                    <ul className="m-0 list-none p-0">
                      {ph.tasks.map((t) => {
                        const s = schedule.tasks.get(t.id);
                        if (!s) return null;
                        const done = t.status === "done";
                        const label = `${t.title}: ${t.milestone ? shortDate(s.end) : `${shortDate(s.start)} to ${shortDate(s.end)}`}${s.critical ? ", critical" : ""}${done ? ", done" : ""}`;
                        return (
                          <li key={t.id} className="relative flex h-10 items-center" aria-label={label}>
                            <span className="sticky left-0 z-[6] flex h-full shrink-0 items-center truncate bg-surface px-4 pl-6 text-[13px] text-ink-2" style={{ width: NAME_W }}>{t.title}</span>
                            {t.planned && <span aria-hidden title="Baseline" className="absolute h-2 translate-y-3 rounded-sm bg-ink/15" style={{ left: NAME_W + x(t.planned.start), width: x(t.planned.end) - x(t.planned.start) + px }} />}
                            {t.milestone ? (
                              <span aria-hidden className={`absolute h-3.5 w-3.5 rotate-45 ${done ? "bg-good" : "bg-primary"} ${s.critical ? "ring-2 ring-bad" : ""}`} style={{ left: NAME_W + x(s.end) + px / 2 - 7 }} />
                            ) : (
                              <span aria-hidden className={`absolute flex h-6 items-center overflow-hidden rounded-md px-1.5 text-[11px] font-semibold whitespace-nowrap ${done ? "bg-good-soft text-good" : t.status === "progress" ? "bg-primary text-white dark:text-ground" : "bg-primary-soft text-primary-ink"} ${s.critical ? "ring-2 ring-bad" : ""}`} style={{ left: NAME_W + x(s.start) + 1, width: Math.max(px - 2, x(s.end) - x(s.start) + px - 2) }}>
                                {zoom === "Day" ? t.owner ?? "" : ""}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
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
