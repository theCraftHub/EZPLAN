/**
 * Presentation mode (step N1): a plan as full-screen slides for a meeting or a screen share:
 * status, milestones, the timeline, the next two weeks, and what's done lately. Arrow keys,
 * swipe, or the buttons move between slides; Escape closes.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { allTasks, countsAsDone, type Plan } from "@rakuplan/shared";
import { plural, shortDate } from "../lib/format";
import type { usePlanMath } from "../pages/plan/math";
import { Timeline } from "../pages/plan/Timeline";
import { HealthChip, ProgressRing } from "./kit";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function Present({ plan, math, today, onClose, extra }: { plan: Plan; math: Math; today: string; onClose: () => void; extra?: { risks?: number } }) {
  const [at, setAt] = useState(0);
  const touch = useRef<number | null>(null);
  const tasks = allTasks(plan);
  const milestones = tasks.filter((t) => t.milestone).map((t) => ({ t, s: math.schedule.tasks.get(t.id) })).sort((a, b) => (a.s?.end ?? "").localeCompare(b.s?.end ?? ""));
  const soon = tasks.filter((t) => !t.milestone && t.status !== "done" && t.status !== "skipped").map((t) => ({ t, s: math.schedule.tasks.get(t.id) })).filter((x) => x.s && x.s.start <= addDays(today, 14)).sort((a, b) => a.s!.start.localeCompare(b.s!.start)).slice(0, 10);
  const recent = tasks.filter((t) => countsAsDone(t) && t.done && t.done.date >= addDays(today, -14)).sort((a, b) => b.done!.date.localeCompare(a.done!.date)).slice(0, 10);
  const p = math.progress;
  const slides: { title: string; body: ReactNode }[] = [
    { title: plan.title, body: (
      <div className="flex flex-col items-center gap-6 text-center">
        <ProgressRing percent={p.percent} size={160} />
        <HealthChip value={p.suggestedHealth} />
        <p className="m-0 text-2xl">{p.doneCount} of {plural(p.countedTasks, "task")} done · finishing {shortDate(math.schedule.finish)}</p>
        {p.overdueCount > 0 && <p className="m-0 text-xl text-warn">{plural(p.overdueCount, "task")} overdue</p>}
        {extra?.risks ? <p className="m-0 text-xl">{plural(extra.risks, "open risk")}</p> : null}
        {plan.goal && <p className="m-0 max-w-2xl text-xl text-ink-2">{plan.goal}</p>}
      </div>
    ) },
    { title: "Milestones", body: milestones.length ? (
      <ol className="m-0 flex list-none flex-col gap-3 p-0 text-2xl">{milestones.map(({ t, s }) => <li key={t.id} className="flex items-center gap-4"><span aria-hidden className={`h-5 w-5 shrink-0 rotate-45 rounded-[3px] ${t.status === "done" ? "bg-good" : "border-[3px] border-primary"}`} /><span className="flex-1">{t.title}</span><span className="text-ink-2">{t.status === "done" ? "done" : s ? shortDate(s.end) : ""}</span></li>)}</ol>
    ) : <p className="m-0 text-2xl text-ink-2">No milestones in this plan.</p> },
    { title: "Timeline", body: <div className="w-full overflow-auto"><Timeline plan={plan} math={math} today={today} /></div> },
    { title: "Next two weeks", body: soon.length ? (
      <ul className="m-0 flex list-none flex-col gap-3 p-0 text-2xl">{soon.map(({ t, s }) => <li key={t.id} className="flex flex-wrap gap-x-4"><span className="flex-1">{t.title}</span><span className="text-ink-2">{t.owner ? `${t.owner} · ` : ""}{shortDate(s!.start)}</span></li>)}</ul>
    ) : <p className="m-0 text-2xl text-ink-2">Nothing starts in the next two weeks.</p> },
    { title: "Done lately", body: recent.length ? (
      <ul className="m-0 flex list-none flex-col gap-3 p-0 text-2xl">{recent.map((t) => <li key={t.id} className="flex flex-wrap gap-x-4"><span className="flex-1">✓ {t.title}</span><span className="text-ink-2">{t.done!.by ? `${t.done!.by} · ` : ""}{shortDate(t.done!.date)}</span></li>)}</ul>
    ) : <p className="m-0 text-2xl text-ink-2">Nothing finished in the last two weeks.</p> },
  ];
  const go = (n: number) => setAt((i) => Math.max(0, Math.min(slides.length - 1, i + n)));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const slide = slides[at]!;
  return (
    <div role="dialog" aria-modal="true" aria-label="Presentation" className="fixed inset-0 z-50 flex flex-col bg-ground text-ink"
      onTouchStart={(e) => { touch.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => { const x = e.changedTouches[0]?.clientX; if (touch.current !== null && x !== undefined && Math.abs(x - touch.current) > 50) go(x < touch.current ? 1 : -1); touch.current = null; }}>
      <div className="flex items-center gap-3 px-6 py-4">
        <span className="text-sm text-muted" aria-live="polite">{at + 1} / {slides.length}</span>
        <span className="flex-1" />
        <button onClick={onClose} aria-label="Close the presentation" className="flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-line"><X aria-hidden size={20} /></button>
      </div>
      <section aria-label={slide.title} className="flex min-h-0 flex-1 flex-col items-center gap-8 overflow-auto px-6 pb-6 sm:px-16">
        <h2 className="m-0 text-center text-4xl font-bold tracking-tight">{slide.title}</h2>
        <div className="flex w-full max-w-5xl justify-center">{slide.body}</div>
      </section>
      <div className="flex items-center justify-center gap-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
        <button onClick={() => go(-1)} disabled={at === 0} aria-label="Previous slide" className="flex h-12 w-12 items-center justify-center rounded-full ring-1 ring-line disabled:opacity-40"><ChevronLeft aria-hidden size={22} /></button>
        <button onClick={() => go(1)} disabled={at === slides.length - 1} aria-label="Next slide" className="flex h-12 w-12 items-center justify-center rounded-full ring-1 ring-line disabled:opacity-40"><ChevronRight aria-hidden size={22} /></button>
      </div>
    </div>
  );
}
