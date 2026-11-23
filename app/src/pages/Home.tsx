import { useEffect, useState } from "react";
import { CalendarClock, Flag, Plus } from "lucide-react";
import { api, type Me, type PlanSummary } from "../lib/api";
import { shortDate, plural } from "../lib/format";
import { Link, useRouter } from "../lib/router";
import { Button, Card, HealthChip, Notice, PageTitle, ProgressRing, Spinner } from "../ui/kit";

/** Home: every active plan at a glance (progress, health, finish, next milestone). */
export function Home({ me }: { me: Me }) {
  const { go } = useRouter();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.plans().then((r) => setPlans(r.plans)).catch((e: Error) => setError(e.message));
  }, []);
  const first = me.user.name.split(" ")[0];
  const active = plans?.filter((p) => p.summary?.health !== "Complete") ?? [];
  const overdue = active.reduce((n, p) => n + (p.summary?.overdueCount ?? 0), 0);
  return (
    <>
      <PageTitle
        title={`Hi ${first}`}
        sub={plans ? (active.length ? `${plural(active.length, "active plan")}${overdue ? ` · ${plural(overdue, "task")} overdue` : ""}` : "No plans yet") : " "}
        actions={<Button onClick={() => go("/new")}><Plus aria-hidden size={18} /> New plan</Button>}
      />
      {error && <Notice tone="bad">{error}</Notice>}
      {!plans && !error && <Spinner label="Loading your plans" />}
      {plans && plans.length === 0 && (
        <Card className="flex flex-col items-start gap-3 p-6">
          <h2 className="m-0 text-lg font-bold">Make your first plan</h2>
          <p className="m-0 max-w-prose text-[15px] leading-relaxed text-ink-2">Already talking about a project with your AI assistant? Copy our prompt into that chat, then paste the reply here. Or start from your own notes.</p>
          <Button onClick={() => go("/new")}><Plus aria-hidden size={18} /> New plan</Button>
        </Card>
      )}
      {plans && plans.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3" aria-label="Your plans">
          {plans.map((p) => (
            <li key={p.id}>
              <Link to={`/p/${p.id}`} className="block h-full rounded-2xl bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-line/60 hover:ring-primary/50">
                <div className="flex items-start gap-3">
                  <ProgressRing percent={p.summary?.percent ?? 0} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="text-[17px] leading-snug font-bold">{p.title}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {p.summary && <HealthChip value={p.state === "review" ? "On hold" : p.summary.health} />}
                      {p.shared && <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary-ink">Shared with you</span>}
                    </span>
                  </div>
                </div>
                {p.summary && (
                  <dl className="m-0 mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-1.5 text-ink-2"><CalendarClock aria-hidden size={16} /><dt className="sr-only">Finish</dt><dd className="m-0">Finish {shortDate(p.summary.finish)}</dd></div>
                    <div className="flex items-center gap-1.5 text-ink-2"><dt className="sr-only">Done</dt><dd className="m-0">{p.summary.doneCount} of {plural(p.summary.countedTasks, "task")} done</dd></div>
                    {p.summary.nextMilestone && (
                      <div className="col-span-2 flex items-center gap-1.5 text-ink-2"><Flag aria-hidden size={16} /><dt className="sr-only">Next milestone</dt><dd className="m-0 truncate">{p.summary.nextMilestone.title} · {shortDate(p.summary.nextMilestone.date)}</dd></div>
                    )}
                    {p.summary.overdueCount > 0 && <div className="col-span-2 font-semibold text-warn"><dt className="sr-only">Overdue</dt><dd className="m-0">{plural(p.summary.overdueCount, "task")} overdue</dd></div>}
                  </dl>
                )}
                {p.state === "review" && <p className="m-0 mt-2 text-sm text-muted">Waiting for a safety review before it can be shared.</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
