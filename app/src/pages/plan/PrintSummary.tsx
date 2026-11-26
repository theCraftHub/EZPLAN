/** A one-page summary to print or save as PDF (browser print). */
import { useEffect } from "react";
import { Printer } from "lucide-react";
import { BRAND, type Plan } from "@rakuplan/shared";
import { longDate, plural, shortDate } from "../../lib/format";
import { Button } from "../../ui/kit";
import { STATUS } from "../../ui/Status";
import type { usePlanMath } from "./math";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;

export function PrintSummary({ plan, math, today }: { plan: Plan; math: Math; today: string }) {
  useEffect(() => { document.title = `${plan.title} · summary`; }, [plan.title]);
  const milestones = plan.phases.flatMap((p) => p.tasks).filter((t) => t.milestone);
  return (
    <article aria-label="Printable summary" className="flex flex-col gap-4 rounded-2xl bg-white p-6 text-[13px] leading-snug text-slate-900 ring-1 ring-line print:p-0 print:ring-0">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <p className="m-0 text-sm text-slate-600">Fits on one page for most plans. Use your browser's print, or save as PDF.</p>
        <Button onClick={() => print()}><Printer aria-hidden size={18} /> Print</Button>
      </div>
      <header className="flex flex-col gap-1 border-b border-slate-200 pb-3">
        <h1 className="m-0 text-2xl font-bold">{plan.title}</h1>
        {plan.goal && <p className="m-0">Goal: {plan.goal}</p>}
        {plan.doneWhen && <p className="m-0">Done when: {plan.doneWhen}</p>}
      </header>
      <dl className="m-0 grid grid-cols-4 gap-3">
        <div><dt className="text-slate-500">Health</dt><dd className="m-0 font-bold">{math.progress.suggestedHealth}</dd></div>
        <div><dt className="text-slate-500">Progress</dt><dd className="m-0 font-bold">{math.progress.percent}% · {math.progress.doneCount} of {plural(math.progress.countedTasks, "task")}</dd></div>
        <div><dt className="text-slate-500">Finish</dt><dd className="m-0 font-bold">{longDate(math.schedule.finish)}</dd></div>
        <div><dt className="text-slate-500">Plan Check</dt><dd className="m-0 font-bold">{math.check.score} / 100</dd></div>
      </dl>
      {milestones.length > 0 && (
        <section><h2 className="m-0 mb-1 text-sm font-bold">Milestones</h2>
          <ul className="m-0 flex flex-wrap gap-x-5 gap-y-1 p-0 list-none">{milestones.map((m) => <li key={m.id}>{m.status === "done" ? "✓ " : "◇ "}{m.title} · {shortDate(math.schedule.tasks.get(m.id)?.end ?? math.schedule.finish)}</li>)}</ul>
        </section>
      )}
      {plan.phases.map((ph) => (
        <section key={ph.id} className="break-inside-avoid">
          <h2 className="m-0 mb-1 text-sm font-bold">{ph.title}</h2>
          <table className="w-full border-collapse">
            <tbody>
              {ph.tasks.filter((t) => !t.milestone).map((t) => {
                const s = math.schedule.tasks.get(t.id);
                return (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="w-20 py-1 pr-2 font-semibold">{STATUS[t.status].label}</td>
                    <td className="py-1 pr-2">{t.title}</td>
                    <td className="w-24 py-1 pr-2 text-slate-600">{t.owner ?? ""}</td>
                    <td className="w-32 py-1 text-right text-slate-600">{s ? `${shortDate(s.start)} to ${shortDate(s.end)}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
      <footer className="border-t border-slate-200 pt-2 text-[11px] text-slate-500">Printed {longDate(today)} from {BRAND.name}. Dates are estimates; check permits, safety and legal requirements for your project.</footer>
    </article>
  );
}
