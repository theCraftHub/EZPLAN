import { UpdateOverdue } from "../ui/StatusUpdate";
import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Building2, CalendarClock, Copy, Flag, Layers, Plus, Search } from "lucide-react";
import { BRAND } from "@rakuplan/shared";
import { isNetworkError, offline } from "../lib/offline";
import { api, ApiError, type Me, type PlanSummary } from "../lib/api";
import { shortDate, plural } from "../lib/format";
import { Link, useRouter } from "../lib/router";
import { Button, Card, HealthChip, Notice, PageTitle, ProgressRing, Spinner } from "../ui/kit";

/** Home: every active plan at a glance (progress, health, finish, next milestone). */
export function Home({ me }: { me: Me }) {
  const { go } = useRouter();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState("");
  const [grouping, setGrouping] = useState(false);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  const [orgs, setOrgs] = useState<Awaited<ReturnType<typeof api.orgs>>["orgs"] | null>(null);
  useEffect(() => {
    api.plans()
      .then((r) => { setPlans(r.plans); void offline.plans(me.user.id, r.plans); })
      .catch(async (e: Error) => {
        const last = isNetworkError(e) ? await offline.lastPlans(me.user.id) : undefined;
        if (last) { setPlans(last.list); setOfflineSince(last.savedAt); }
        else setError(isNetworkError(e) ? "You're offline, and your plans haven't been loaded on this device yet. Plans you've opened here before still open from their own links." : e.message);
      });
    api.orgs().then((r) => setOrgs(r.orgs)).catch(() => setOrgs([]));
  }, []);
  const first = me.user.name.split(" ")[0];
  const active = plans?.filter((p) => p.state !== "archived" && p.summary?.health !== "Complete") ?? [];
  const overdue = active.reduce((n, p) => n + (p.summary?.overdueCount ?? 0), 0);
  return (
    <>
      <PageTitle
        title={`Hi ${first}`}
        sub={plans ? (active.length ? `${plural(active.length, "active plan")}${overdue ? ` · ${plural(overdue, "task")} overdue` : ""}` : "No plans yet") : " "}
        actions={<span className="flex flex-wrap gap-2">{plans && plans.filter((x) => !x.master && !x.masterId && !x.shared).length > 0 && <Button variant="secondary" onClick={() => setGrouping(!grouping)} aria-expanded={grouping}><Layers aria-hidden size={18} /> New master plan</Button>}<Button onClick={() => go("/new")}><Plus aria-hidden size={18} /> New plan</Button></span>}
      />
      {grouping && plans && <NewMaster plans={plans.filter((x) => !x.master && !x.masterId && !x.shared)} onDone={(id) => go(`/m/${id}`)} onCancel={() => setGrouping(false)} />}
      {orgs?.filter((o) => o.setup).map((o) => (
        <Card key={o.id} aria-label={`Finish setting up ${o.name}`} className="flex flex-wrap items-center gap-3">
          <Building2 aria-hidden size={22} className="text-primary" />
          <span className="min-w-0 flex-1"><strong className="block text-[15px]">Finish setting up {o.name}</strong><span className="text-sm text-ink-2">Nothing has gone to employees yet. Pick up where you left off.</span></span>
          <Button onClick={() => go(`/business/${o.id}/${o.setup!.step}`)}>Continue setup</Button>
        </Card>
      ))}
      {offlineSince && <Notice tone="warn">You're offline. These are your plans as of {new Date(offlineSince).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. Plans you've opened on this device work offline; others need a connection.</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      {!plans && !error && <Spinner label="Loading your plans" />}
      {plans && plans.length === 0 && (
        <Card className="flex flex-col items-start gap-3 p-6">
          <h2 className="m-0 text-lg font-bold">Make your first plan</h2>
          <p className="m-0 max-w-prose text-[15px] leading-relaxed text-ink-2">Already talking about a project with your AI assistant? Copy our prompt into that chat, then paste the reply here. Or start from your own notes.</p>
          <Button onClick={() => go("/new")}><Plus aria-hidden size={18} /> New plan</Button>
        </Card>
      )}
      {plans && plans.length > 0 && <Portfolio plans={plans} reload={() => api.plans().then((r) => setPlans(r.plans)).catch((e: Error) => setError(e.message))} />}
      {plans && orgs && orgs.length === 0 && (
        <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-ink-2"><Building2 aria-hidden size={16} /> Planning for a company? <Link to="/business/start" className="font-semibold text-primary-ink underline">Start {BRAND.name} for your business</Link></p>
      )}
    </>
  );
}

/** "New master plan": group existing plans under one master (each keeps its own tasks and people). */
function NewMaster({ plans, onDone, onCancel }: { plans: PlanSummary[]; onDone: (id: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    setError("");
    try { onDone((await api.createMaster(title.trim(), picked)).id); } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't make the master plan."); } finally { setBusy(false); }
  };
  return (
    <Card aria-label="New master plan" className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-bold">New master plan</h2>
      <p className="m-0 text-[15px] text-ink-2">A master plan holds several plans, for example one per room or per workstream, and schedules them as one: a delay in one moves what waits on it in the others, and someone working in several isn't double-booked. Each plan keeps its own tasks and people.</p>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Name<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: HQ remodel" className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal" /></label>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Plans to put in it</legend>
        {plans.map((p) => <label key={p.id} className="flex min-h-11 items-center gap-3 text-[15px]"><input type="checkbox" className="h-5 w-5" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} /> {p.title}</label>)}
      </fieldset>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex flex-wrap gap-2"><Button onClick={() => void create()} disabled={busy || !title.trim() || picked.length === 0}>Make the master plan</Button><Button variant="secondary" onClick={onCancel}>Cancel</Button></div>
    </Card>
  );
}

type Tab = "active" | "completed" | "archived";
const tabOf = (p: PlanSummary): Tab => (p.state === "archived" ? "archived" : p.summary?.health === "Complete" ? "completed" : "active");

/** Home's portfolio (approved Portfolio board): Active, Completed and Archived plans, with search. */
function Portfolio({ plans, reload }: { plans: PlanSummary[]; reload: () => Promise<void> }) {
  const { go } = useRouter();
  const [tab, setTab] = useState<Tab>("active");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const count = (t: Tab) => plans.filter((p) => tabOf(p) === t).length;
  const shown = plans.filter((p) => tabOf(p) === tab && (!q.trim() || p.title.toLowerCase().includes(q.trim().toLowerCase())));
  const setState = async (p: PlanSummary, state: "archived" | "active") => { setBusy(p.id); try { await api.setPlanState(p.id, state); await reload(); } finally { setBusy(""); } };
  const empty = { active: "No active plans.", completed: "No finished plans yet. A plan moves here when every task is done.", archived: "Nothing archived. Archive a plan you've stopped working on to keep Home tidy; you can restore it any time." }[tab];
  return (
    <section aria-label="Portfolio" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Plans by state" className="inline-flex gap-1 rounded-xl bg-surface-2 p-1 ring-1 ring-line">
          {(["active", "completed", "archived"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`min-h-10 rounded-lg px-3 text-[14px] ${tab === t ? "bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(15,23,42,0.08)]" : "font-medium text-ink-2"}`}>{t[0]!.toUpperCase() + t.slice(1)} · {count(t)}</button>
          ))}
        </div>
        <label className="ml-auto flex min-w-0 flex-1 basis-48 items-center gap-2 rounded-xl border border-line bg-surface px-3 sm:max-w-xs"><Search aria-hidden size={16} className="text-muted" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search plans" placeholder="Search plans" className="min-h-11 flex-1 bg-transparent text-base outline-none" /></label>
      </div>
      {shown.length === 0 ? <p className="m-0 text-[15px] text-ink-2">{q.trim() ? "No plans match." : empty}</p> : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3" aria-label="Your plans">
          {shown.map((p) => (
            <li key={p.id} className="flex flex-col rounded-2xl bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-line/60 hover:ring-primary/50">
              <Link to={p.master ? `/m/${p.id}` : `/p/${p.id}`} className="block flex-1 rounded-t-2xl p-4">
                <div className="flex items-start gap-3">
                  <ProgressRing percent={p.summary?.percent ?? 0} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="text-[17px] leading-snug font-bold">{p.title}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {tab === "archived" ? <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-bold text-ink-2 ring-1 ring-line">Archived</span>
                        : tab === "completed" ? <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${p.summary?.plannedDays && (p.summary.tookDays ?? 0) > p.summary.plannedDays ? "bg-surface-2 text-ink-2 ring-1 ring-line" : "bg-good-soft text-good"}`}>{p.summary?.plannedDays && (p.summary.tookDays ?? 0) > p.summary.plannedDays ? "Done late" : "Done"}</span>
                        : p.summary && <HealthChip value={p.state === "review" ? "On hold" : p.summary.health} />}
                      <UpdateOverdue state={p.statusUpdate} />
                      {p.shared && <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary-ink">Shared with you</span>}
                      {p.master && <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary-ink"><Layers aria-hidden size={12} /> Master plan · {plural(p.master.plans, "plan")} inside</span>}
                      {p.masterId && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2 ring-1 ring-line">In a master plan</span>}
                    </span>
                  </div>
                </div>
                {p.summary && tab === "active" && (
                  <dl className="m-0 mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-1.5 text-ink-2"><CalendarClock aria-hidden size={16} /><dt className="sr-only">Finish</dt><dd className="m-0">Finish {shortDate(p.summary.finish)}</dd></div>
                    <div className="flex items-center gap-1.5 text-ink-2"><dt className="sr-only">Done</dt><dd className="m-0">{p.summary.doneCount} of {plural(p.summary.countedTasks, "task")} done</dd></div>
                    {p.summary.nextMilestone && <div className="col-span-2 flex items-center gap-1.5 text-ink-2"><Flag aria-hidden size={16} /><dt className="sr-only">Next milestone</dt><dd className="m-0 truncate">{p.summary.nextMilestone.title} · {shortDate(p.summary.nextMilestone.date)}</dd></div>}
                    {p.summary.overdueCount > 0 && <div className="col-span-2 font-semibold text-warn"><dt className="sr-only">Overdue</dt><dd className="m-0">{plural(p.summary.overdueCount, "task")} overdue</dd></div>}
                    {p.summary.checkScore !== undefined && <div className="text-ink-2"><dt className="sr-only">Plan Check</dt><dd className="m-0">Plan Check {p.summary.checkScore}</dd></div>}
                  </dl>
                )}
                {p.summary && tab === "completed" && (
                  <dl className="m-0 mt-3 grid grid-cols-2 gap-2 text-sm text-ink-2">
                    {p.summary.finishedOn && <div className="col-span-2"><dt className="sr-only">Finished</dt><dd className="m-0">Finished {shortDate(p.summary.finishedOn)}</dd></div>}
                    {p.summary.tookDays && <div><dt className="sr-only">Took</dt><dd className="m-0">Took {plural(p.summary.tookDays, "day")}{p.summary.plannedDays ? ` (planned ${p.summary.plannedDays})` : ""}</dd></div>}
                    {p.summary.onTimePercent !== null && p.summary.onTimePercent !== undefined && <div><dt className="sr-only">On time</dt><dd className="m-0">{p.summary.onTimePercent}% of tasks on time</dd></div>}
                  </dl>
                )}
                {p.summary && tab === "archived" && (
                  <p className="m-0 mt-3 text-sm text-ink-2">{p.archivedAt ? `Archived ${shortDate(new Date(p.archivedAt).toISOString().slice(0, 10))} · ` : ""}{p.summary.doneCount} of {plural(p.summary.countedTasks, "task")} done</p>
                )}
                {p.state === "review" && <p className="m-0 mt-2 text-sm text-muted">Waiting for a safety review before it can be shared.</p>}
              </Link>
              <div className="flex flex-wrap gap-1 border-t border-line px-2 py-1.5">
                {!p.master && <Button variant="ghost" className="min-h-10 text-sm" onClick={() => go(`/new?from=${encodeURIComponent(p.id)}`)} aria-label={`Reuse ${p.title} as a template`}><Copy aria-hidden size={16} /> Reuse as template</Button>}
                {p.canArchive && p.state !== "review" && (p.state === "archived"
                  ? <Button variant="ghost" className="ml-auto min-h-10 text-sm" disabled={busy === p.id} onClick={() => void setState(p, "active")} aria-label={`Restore ${p.title}`}><ArchiveRestore aria-hidden size={16} /> Restore</Button>
                  : <Button variant="ghost" className="ml-auto min-h-10 text-sm" disabled={busy === p.id} onClick={() => void setState(p, "archived")} aria-label={`Archive ${p.title}`}><Archive aria-hidden size={16} /> Archive</Button>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
