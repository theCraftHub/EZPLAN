/**
 * A plan opened from a share link (step N1): no sign-in, read-only. Overview, checklist and timeline,
 * kept up to date (checked every 30 seconds), and presentation mode. No comments or emails.
 */
import { useEffect, useState } from "react";
import { MonitorPlay } from "lucide-react";
import { allTasks, awaitingApproval, BRAND, type Plan } from "@rakuplan/shared";
import { api, ApiError, type People } from "../lib/api";
import { plural, shortDate } from "../lib/format";
import { usePlanMath } from "./plan/math";
import { Timeline } from "./plan/Timeline";
import { Button, Card, HealthChip, Notice, ProgressRing, Spinner } from "../ui/kit";
import { Present } from "../ui/Present";
import { STATUS } from "../ui/Status";

type Data = { version: number; plan: Plan; people: People; workWeek: NonNullable<Awaited<ReturnType<typeof api.publicShare>>["workWeek"]>; today: string; expiresAt: number | null };
const VIEWS = ["Overview", "Checklist", "Timeline"] as const;

export function SharedPlan({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<(typeof VIEWS)[number]>("Overview");
  const [present, setPresent] = useState(false);
  useEffect(() => {
    // Search engines are told not to list shared plans.
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    meta.content = "noindex, nofollow";
  }, []);
  useEffect(() => {
    let version: number | undefined;
    let stopped = false;
    const load = () => api.publicShare(token, version).then((r) => {
      if (stopped || r.unchanged) return;
      version = r.version;
      setData({ version: r.version, plan: r.plan!, people: r.people ?? {}, workWeek: r.workWeek!, today: r.today!, expiresAt: r.expiresAt ?? null });
      document.title = `${r.plan!.title} · ${BRAND.name}`;
    }).catch((e) => { if (!stopped) setError(e instanceof ApiError ? e.message : "Can't open this link right now. Check your connection."); });
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [token]);
  const math = usePlanMath(data?.plan ?? null, data ? { workWeek: data.workWeek, today: data.today, people: data.people } : null);

  if (error && !data) return <main className="mx-auto max-w-xl p-6"><Notice tone="warn">{error}</Notice></main>;
  if (!data || !math) return <Spinner label="Opening the shared plan" />;
  const { plan } = data;
  const p = math.progress;
  const tasks = allTasks(plan);
  const next = tasks.filter((t) => !t.milestone && t.status !== "done" && t.status !== "skipped").map((t) => ({ t, s: math.schedule.tasks.get(t.id) })).sort((a, b) => (a.s?.start ?? "").localeCompare(b.s?.start ?? "")).slice(0, 6);
  const milestones = tasks.filter((t) => t.milestone).map((t) => ({ t, s: math.schedule.tasks.get(t.id) })).sort((a, b) => (a.s?.end ?? "").localeCompare(b.s?.end ?? ""));
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 lg:px-8">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="m-0 text-sm text-muted">Shared with you · read-only · kept up to date{data.expiresAt ? ` · link works until ${new Date(data.expiresAt).toLocaleDateString()}` : ""}</p>
          <h1 className="m-0 text-[26px] leading-tight font-bold tracking-tight">{plan.title}</h1>
        </div>
        <Button variant="secondary" onClick={() => setPresent(true)}><MonitorPlay aria-hidden size={18} /> Present</Button>
      </header>
      <nav aria-label="Shared plan views" className="flex gap-1 border-b border-line">
        {VIEWS.map((v) => <button key={v} aria-current={view === v ? "page" : undefined} onClick={() => setView(v)} className={`-mb-px min-h-11 border-b-2 px-3 text-[15px] font-semibold ${view === v ? "border-primary text-ink" : "border-transparent text-muted"}`}>{v}</button>)}
      </nav>
      {error && <Notice tone="warn">{error}</Notice>}
      {view === "Overview" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="flex items-center gap-4">
            <ProgressRing percent={p.percent} size={88} />
            <div className="flex flex-col gap-1.5"><HealthChip value={p.suggestedHealth} /><span className="text-[15px]">{p.doneCount} of {plural(p.countedTasks, "task")} done</span><span className="text-[15px]">Finishing {shortDate(math.schedule.finish)}</span>{p.overdueCount > 0 && <span className="text-[15px] font-semibold text-warn">{plural(p.overdueCount, "task")} overdue</span>}</div>
          </Card>
          <Card aria-label="Milestones" className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-bold">Milestones</h2>
            {milestones.length === 0 ? <p className="m-0 text-sm text-muted">None.</p> : milestones.map(({ t, s }) => <span key={t.id} className="flex justify-between gap-3 text-[15px]"><span>{t.title}</span><span className="text-ink-2">{t.status === "done" ? "done" : s ? shortDate(s.end) : ""}</span></span>)}
          </Card>
          <Card aria-label="Up next" className="flex flex-col gap-2 lg:col-span-2">
            <h2 className="m-0 text-lg font-bold">Up next</h2>
            {next.length === 0 ? <p className="m-0 text-sm text-muted">Nothing left to do.</p> : next.map(({ t, s }) => <span key={t.id} className="flex flex-wrap justify-between gap-x-3 text-[15px]"><span>{t.title}</span><span className="text-ink-2">{t.owner ? `${t.owner} · ` : ""}{s ? `${shortDate(s.start)} to ${shortDate(s.end)}` : ""}</span></span>)}
          </Card>
        </div>
      )}
      {view === "Checklist" && plan.phases.map((ph) => (
        <Card key={ph.id} aria-label={`Phase: ${ph.title}`} className="flex flex-col gap-1">
          <h2 className="m-0 text-lg font-bold">{ph.title}</h2>
          <ul className="m-0 flex list-none flex-col p-0">
            {ph.tasks.map((t) => {
              const s = math.schedule.tasks.get(t.id);
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line py-2 first:border-t-0">
                  <span className="w-24 shrink-0 text-sm font-semibold text-ink-2">{t.milestone ? "Milestone" : awaitingApproval(t) ? "Waiting" : STATUS[t.status].label}</span>
                  <span className={`min-w-0 flex-1 text-[15px] ${t.status === "done" ? "text-muted line-through" : ""}`}>{t.title}</span>
                  <span className="text-sm text-ink-2">{t.owner ? `${t.owner} · ` : ""}{s ? (t.milestone ? shortDate(s.end) : `${shortDate(s.start)} to ${shortDate(s.end)}`) : ""}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      {view === "Timeline" && <Timeline plan={plan} math={math} today={data.today} />}
      <p className="m-0 text-center text-sm text-muted">Made with {BRAND.name}</p>
      {present && <Present plan={plan} math={math} today={data.today} onClose={() => setPresent(false)} />}
    </main>
  );
}
