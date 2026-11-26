/**
 * A master plan (step K3, from the approved mockups): Overview with what decides the finish and
 * what-ifs, all plans on one timeline, Departments, Discussion and Activity. Every date comes from
 * the same engine, run on the whole master in the browser, so what-ifs answer at once. One page for
 * phone and desktop: it reflows.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { allTasks, crossRef, localSchedule, masterSchedule, MASTER_KEY, progressOf, type MasterPart, type PersonAvailability, type Task } from "@rakuplan/shared";
import { api, ApiError, type MasterData, type MasterMessage, type MasterThread } from "../lib/api";
import { plural, shortDate } from "../lib/format";
import { Link } from "../lib/router";
import { Button, Card, HealthChip, Notice, PageTitle, Spinner } from "../ui/kit";
import { MentionBox } from "../ui/MentionBox";

const VIEWS = [
  { view: "", label: "Overview" },
  { view: "timeline", label: "Timeline" },
  { view: "departments", label: "Departments" },
  { view: "discussion", label: "Discussion" },
  { view: "activity", label: "Activity" },
];
/** Department colors (validated colorblind-safe slots), always shown with the name. */
const DEPT_SLOTS = [
  { c: "#2a78d6", cls: "bg-[#E3EEFB] text-[#1C5CAB] dark:bg-[#16304f] dark:text-[#9cc4f2]" },
  { c: "#eb6834", cls: "bg-[#FDEBE2] text-[#9A3412] dark:bg-[#4a2414] dark:text-[#f8b391]" },
  { c: "#1baf7a", cls: "bg-[#DDF5EC] text-[#0F6B4A] dark:bg-[#123d2e] dark:text-[#86dcb9]" },
  { c: "#eda100", cls: "bg-[#FCF0D2] text-[#7A5300] dark:bg-[#3d2f0b] dark:text-[#f1cf7a]" },
  { c: "#e87ba4", cls: "bg-[#FBE6EE] text-[#9D2B57] dark:bg-[#47202f] dark:text-[#f3b2cb]" },
  { c: "#8b7cf6", cls: "bg-[#EEEBFE] text-[#4B3BBE] dark:bg-[#2b2550] dark:text-[#c3b9fb]" },
];
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

type WhatIf = { kind: "none" } | { kind: "longer"; key: string; id: string; days: number } | { kind: "hours"; person: string; hours: number };

export function MasterPage({ id, view }: { id: string; view: string }) {
  const [data, setData] = useState<MasterData | null>(null);
  const [error, setError] = useState("");
  const [whatIf, setWhatIf] = useState<WhatIf>({ kind: "none" });
  useEffect(() => void api.master(id).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Can't open this master plan.")), [id]);

  const calc = useMemo((): Calc | null => {
    if (!data) return null;
    const opts = { workWeek: data.workWeek, today: data.today };
    const parts: MasterPart[] = data.parts.map((p) => ({ key: p.key, title: p.title, plan: p.plan }));
    const base = masterSchedule(parts, { ...opts, people: data.people });
    let tried = null as ReturnType<typeof masterSchedule> | null;
    if (whatIf.kind === "longer") {
      const changed = parts.map((p) => (p.key !== whatIf.key ? p : { ...p, plan: { ...p.plan, phases: p.plan.phases.map((ph) => ({ ...ph, tasks: ph.tasks.map((t) => (t.id !== whatIf.id ? t : { ...t, estimate: { amount: (t.estimate?.unit === "d" ? t.estimate.amount : 0) + whatIf.days, unit: "d" as const } })) })) } }));
      tried = masterSchedule(changed, { ...opts, people: data.people });
    } else if (whatIf.kind === "hours") {
      const people: Record<string, PersonAvailability> = { ...data.people, [whatIf.person]: { ...(data.people[whatIf.person] ?? {}), hoursPerWeek: whatIf.hours } };
      tried = masterSchedule(parts, { ...opts, people });
    }
    return { parts, base, tried, opts };
  }, [data, whatIf]);

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data || !calc) return <Spinner label="Opening the master plan" />;
  const deptNames = [...new Set([...data.parts.flatMap((p) => [p.lead, ...p.needs]), ...data.parts.flatMap((p) => allTasks(p.plan).map((t) => t.dept))].filter((x): x is string => !!x))];
  const dept = (name: string) => DEPT_SLOTS[Math.max(0, deptNames.indexOf(name)) % DEPT_SLOTS.length]!;
  const DeptChip = ({ name, suffix = "" }: { name: string; suffix?: string }) => <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${dept(name).cls}`}><span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: dept(name).c }} />{name}{suffix}</span>;
  const shared: Shared = { id, data, calc, whatIf, setWhatIf, DeptChip, deptColor: (n) => dept(n).c, deptNames };
  return (
    <div className="flex flex-col gap-4">
      <Link to="/" className="text-sm font-semibold text-primary underline">All plans</Link>
      <PageTitle title={data.title} sub={`Master plan · ${plural(data.parts.length - 1, "plan")} inside${deptNames.length ? ` · ${deptNames.join(", ")}` : ""}`} />
      <nav aria-label="Master plan views" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 lg:mx-0 lg:px-0">
        {VIEWS.map((t) => <Link key={t.view} to={`/m/${id}${t.view ? `/${t.view}` : ""}`} aria-current={view === t.view ? "page" : undefined} className={`-mb-px flex min-h-11 shrink-0 items-center border-b-2 px-3 text-[15px] font-semibold ${view === t.view ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink"}`}>{t.label}</Link>)}
      </nav>
      {view === "" && <Overview {...shared} />}
      {view === "timeline" && <Timeline {...shared} />}
      {view === "departments" && <Departments {...shared} />}
      {view === "discussion" && <Discussion id={id} data={data} />}
      {view === "activity" && <Activity id={id} data={data} />}
    </div>
  );
}

type Calc = { parts: MasterPart[]; base: ReturnType<typeof masterSchedule>; tried: ReturnType<typeof masterSchedule> | null; opts: { workWeek: MasterData["workWeek"]; today: string } };
type Shared = { id: string; data: MasterData; calc: Calc; whatIf: WhatIf; setWhatIf: (w: WhatIf) => void; DeptChip: (p: { name: string; suffix?: string }) => ReactElement; deptColor: (name: string) => string; deptNames: string[] };

/** Per plan: its tasks, progress and health on the master's schedule. */
function planSummaries({ data, calc }: Pick<Shared, "data" | "calc">) {
  return data.parts.filter((p) => p.key !== MASTER_KEY).map((p) => {
    const local = localSchedule(calc.base, calc.parts, p.key);
    const progress = progressOf(p.plan, local, calc.opts);
    const open = (id: string) => { const x = crossRef(id); const t = x && allTasks(calc.parts.find((q) => q.key === x.key)?.plan ?? p.plan).find((y) => y.id === x.id); return t && t.status !== "done" && t.status !== "skipped" ? { ...x, title: t.title } : null; };
    const waits = [...new Map(allTasks(p.plan).filter((t) => t.status !== "done").flatMap((t) => t.depends.map((d) => open(d.id)).filter((w): w is NonNullable<typeof w> => !!w)).map((w) => [`${w.key}/${w.id}`, w])).values()];
    const people = [...new Set(allTasks(p.plan).map((t) => t.owner).filter((x): x is string => !!x))];
    const info = calc.base.plans.get(p.key);
    return { ...p, local, progress, waits, people, start: info?.start ?? data.today, finish: info?.finish ?? data.today, critical: info?.critical ?? false };
  });
}

function Overview({ id, data, calc, whatIf, setWhatIf, DeptChip }: Shared) {
  const subs = planSummaries({ data, calc });
  const masterPart = data.parts.find((p) => p.key === MASTER_KEY)!;
  const all = calc.parts.flatMap((p) => allTasks(p.plan).filter((t) => !t.milestone));
  const done = all.filter((t) => t.status === "done").length;
  const late = subs.filter((s) => s.progress.suggestedHealth === "At risk" || s.progress.suggestedHealth === "Off track");
  const waiting = [...new Map(subs.flatMap((s) => s.waits.map((w) => [`${w.key}/${w.id}`, { ...w, plan: calc.parts.find((p) => p.key === w.key)!.title, by: [] as string[] }]))).values()].map((w) => ({ ...w, by: subs.filter((s) => s.waits.some((x) => x.key === w.key && x.id === w.id)).map((s) => s.title) }));
  // What decides the finish: the person whose work in other plans holds up the critical path most, else the chain of waits.
  const blocks = new Map<string, number>();
  for (const [tid, r] of calc.base.schedule.reasons) if (r.kind === "person" && calc.base.schedule.tasks.get(tid)?.critical) blocks.set(r.person, (blocks.get(r.person) ?? 0) + 1);
  const top = [...blocks].sort((a, b) => b[1] - a[1])[0];
  const topPlans = top ? subs.filter((s) => s.people.includes(top[0])).length : 0;
  const people = Object.keys(data.people);
  const tasks = calc.parts.flatMap((p) => allTasks(p.plan).filter((t) => !t.milestone && t.status !== "done").map((t) => ({ key: p.key, plan: p.title, t })));
  const finish = calc.tried ? calc.tried.finish : calc.base.finish;
  const milestones = allTasks(masterPart.plan).filter((t) => t.milestone).map((t) => ({ t, s: calc.base.task(MASTER_KEY, t.id) })).sort((a, b) => (a.s?.end ?? "").localeCompare(b.s?.end ?? ""));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Done", `${all.length ? Math.round((done / all.length) * 100) : 0}%`, `${done} of ${plural(all.length, "task")} across all plans`], ["Finish", shortDate(calc.base.finish), "when the last plan is done"], ["Plans at risk", `${late.length} of ${subs.length}`, late.map((s) => s.title).join(", ") || "All plans on track"], ["Waiting across plans", String(waiting.length), waiting.map((w) => w.title).join(", ") || "Nothing"]].map(([k, v, s]) => (
          <Card key={k} className="flex flex-col gap-1"><span className="text-sm text-muted">{k}</span><span className="text-xl font-bold lg:text-2xl">{v}</span><span className="text-sm text-ink-2">{s}</span></Card>
        ))}
      </div>
      <Card aria-label="What decides the finish" className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex flex-1 flex-col gap-1.5">
          <h2 className="m-0 text-lg font-bold">What decides the finish</h2>
          <p className="m-0 text-[15px] leading-relaxed">{top ? `${top[0]} works on ${plural(topPlans, "plan")} and holds up ${plural(top[1], "task")} on the critical path: their time decides when the master finishes, on ${shortDate(calc.base.finish)}. More help or more hours for ${top[0]} would move it.` : `The chain of work on the critical path decides the finish, ${shortDate(calc.base.finish)}. ${calc.base.schedule.criticalPath.length ? `It runs through ${plural(new Set(calc.base.schedule.criticalPath.map((x) => x.split("/")[0])).size, "plan")}.` : ""}`}</p>
        </div>
        <form aria-label="Try a change" className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3 lg:w-[26rem]" onSubmit={(e) => e.preventDefault()}>
          <strong className="text-sm">Try a change (nothing is saved)</strong>
          <label className="flex flex-col gap-1 text-sm font-semibold">A task takes longer
            <select className="min-h-11 rounded-xl border border-line bg-surface px-2 text-base font-normal" value={whatIf.kind === "longer" ? `${whatIf.key}/${whatIf.id}` : ""} onChange={(e) => { const [key, tid] = e.target.value.split("/"); setWhatIf(e.target.value ? { kind: "longer", key: key!, id: tid!, days: whatIf.kind === "longer" ? whatIf.days : 3 } : { kind: "none" }); }}>
              <option value="">Choose a task…</option>
              {tasks.map(({ key, plan, t }) => <option key={`${key}/${t.id}`} value={`${key}/${t.id}`}>{plan}: {t.title}</option>)}
            </select>
          </label>
          {whatIf.kind === "longer" && <label className="flex items-center gap-2 text-sm">by <input type="number" min={1} max={60} value={whatIf.days} onChange={(e) => setWhatIf({ ...whatIf, days: Math.max(1, Number(e.target.value) || 1) })} className="min-h-10 w-20 rounded-lg border border-line bg-surface px-2" /> working days</label>}
          <label className="flex flex-col gap-1 text-sm font-semibold">Someone's hours change
            <select className="min-h-11 rounded-xl border border-line bg-surface px-2 text-base font-normal" value={whatIf.kind === "hours" ? whatIf.person : ""} onChange={(e) => setWhatIf(e.target.value ? { kind: "hours", person: e.target.value, hours: whatIf.kind === "hours" ? whatIf.hours : 50 } : { kind: "none" })}>
              <option value="">Choose a person…</option>
              {[...new Set([...people, ...calc.parts.flatMap((p) => allTasks(p.plan).map((t) => t.owner).filter((x): x is string => !!x))])].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {whatIf.kind === "hours" && <label className="flex items-center gap-2 text-sm"><input type="number" min={1} max={80} value={whatIf.hours} onChange={(e) => setWhatIf({ ...whatIf, hours: Math.max(1, Number(e.target.value) || 1) })} className="min-h-10 w-20 rounded-lg border border-line bg-surface px-2" /> hours a week</label>}
          {calc.tried && <p role="status" className="m-0 text-[15px] font-semibold">{finish === calc.base.finish ? `The finish stays ${shortDate(finish)}.` : `The finish moves from ${shortDate(calc.base.finish)} to ${shortDate(finish)}.`} <button type="button" className="font-semibold text-primary-ink underline" onClick={() => setWhatIf({ kind: "none" })}>Clear</button></p>}
        </form>
      </Card>
      {milestones.length > 0 && (
        <Card aria-label="Whole-building milestones" className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <strong className="text-sm"><Link to={`/p/${masterPart.planId}`} className="underline">Whole building</Link></strong>
          {milestones.map(({ t, s }) => <span key={t.id} className="flex items-center gap-2 text-sm"><span aria-hidden className={`h-3 w-3 rotate-45 rounded-[2px] ${t.status === "done" ? "bg-good" : "border-2 border-primary"}`} /><span><strong>{t.title}</strong> · {s ? shortDate(s.end) : ""}{t.status === "done" ? " · done" : ""}</span></span>)}
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {subs.map((s) => (
          <Card key={s.key} aria-label={s.title} className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2"><Link to={`/p/${s.planId}`} className="text-base font-bold underline decoration-1 underline-offset-4">{s.title}</Link><HealthChip value={s.progress.suggestedHealth} /></div>
            <span className="text-sm text-ink-2">{shortDate(s.start)} to {shortDate(s.finish)} · {s.progress.doneCount} of {s.progress.countedTasks} done</span>
            <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-primary" style={{ width: `${s.progress.percent}%` }} /></span>
            {(s.lead || s.needs.length > 0) && <span className="flex flex-wrap gap-1">{s.lead && <DeptChip name={s.lead} suffix=" leads" />}{s.needs.map((n) => <DeptChip key={n} name={n} />)}</span>}
            {s.waits.length > 0 && <span className="text-xs font-semibold text-warn">Waits on {s.waits.map((w) => w.title).join(", ")}</span>}
            {s.people.length > 0 && <span className="text-xs text-muted">{s.people.join(", ")}</span>}
          </Card>
        ))}
      </div>
      <Card aria-label="Waiting across plans" className="flex flex-col gap-2">
        <h2 className="m-0 text-lg font-bold">Waiting across plans</h2>
        {waiting.length === 0 ? <p className="m-0 text-[15px] text-ink-2">No plan is waiting on another right now.</p> : waiting.map((w) => (
          <div key={`${w.key}/${w.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 first:border-t-0 first:pt-0">
            <strong className="text-[15px]">{w.title}</strong><span className="text-sm text-muted">{w.plan} · due {shortDate(calc.base.task(w.key, w.id)?.end ?? data.today)}</span>
            <span className="text-sm text-ink-2 sm:ml-auto">{plural(w.by.length, "plan")} wait{w.by.length === 1 ? "s" : ""}: {w.by.join(", ")}</span>
          </div>
        ))}
      </Card>
      <span className="sr-only">{id}</span>
    </div>
  );
}

function Timeline({ data, calc, DeptChip, deptColor }: Shared) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const first = calc.base.schedule.projectStart < data.today ? calc.base.schedule.projectStart : data.today;
  const t0 = Date.parse(`${first}T00:00:00Z`), t1 = Date.parse(`${calc.base.finish}T00:00:00Z`) + 3 * 86_400_000, span = t1 - t0;
  const pct = (iso: string) => `${(((Date.parse(`${iso}T00:00:00Z`) - t0) / span) * 100).toFixed(2)}%`;
  const width = (a: string, b: string) => `${(((Date.parse(`${b}T00:00:00Z`) + 86_400_000 - Date.parse(`${a}T00:00:00Z`)) / span) * 100).toFixed(2)}%`;
  const rows = data.parts.map((p) => ({ p, info: calc.base.plans.get(p.key), tasks: allTasks(p.plan).map((t) => ({ t, s: calc.base.task(p.key, t.id)! })).filter((x) => x.s) }));
  return (
    <Card aria-label="All plans on one timeline" className="flex flex-col gap-3">
      <p className="m-0 text-sm text-ink-2">Dark bars hold work on the critical path: they decide the finish. Open a plan to see its tasks, colored by department. Red line: today.</p>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map(({ p, info, tasks }) => (
          <li key={p.key} className="border-t border-line">
            <div className="grid grid-cols-[minmax(8rem,14rem)_1fr] items-center gap-2 py-2">
              <button aria-expanded={!!open[p.key]} onClick={() => setOpen({ ...open, [p.key]: !open[p.key] })} className="flex min-h-11 flex-col items-start text-left">
                <span className="text-[15px] font-bold">{open[p.key] ? "▾" : "▸"} {p.key === MASTER_KEY ? "Whole building" : p.title}</span>
                {info && <span className="text-xs text-muted">{shortDate(info.start)} to {shortDate(info.finish)}</span>}
              </button>
              <div className="relative h-8">
                <span aria-hidden className="absolute top-0 bottom-0 w-0.5 bg-bad" style={{ left: pct(data.today) }} />
                {info && <span role="img" aria-label={`${p.title}: ${shortDate(info.start)} to ${shortDate(info.finish)}${info.critical ? ", on the critical path" : ""}`} className={`absolute top-2 h-4 rounded ${info.critical ? "bg-primary" : "bg-primary-soft ring-1 ring-primary/40"}`} style={{ left: pct(info.start), width: width(info.start, info.finish) }} />}
              </div>
            </div>
            {open[p.key] && tasks.map(({ t, s }) => (
              <div key={t.id} className="grid grid-cols-[minmax(8rem,14rem)_1fr] items-center gap-2 bg-surface-2 py-1.5 pl-3">
                <span className="flex flex-col"><span className="text-sm">{t.title}</span><span className="flex flex-wrap items-center gap-1 text-xs text-muted">{t.dept && <DeptChip name={t.dept} />}{[t.owner, `${shortDate(s.start)}${s.start === s.end ? "" : ` to ${shortDate(s.end)}`}`].filter(Boolean).join(" · ")}</span></span>
                <div className="relative h-6"><span aria-hidden className={`absolute top-1.5 h-3 rounded-sm ${s.critical ? "ring-2 ring-ink" : ""}`} style={{ left: pct(s.start), width: width(s.start, s.end), background: t.dept ? deptColor(t.dept) : "var(--primary)" }} /></div>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Departments({ id, data, calc, DeptChip, deptNames }: Shared) {
  const [openDept, setOpenDept] = useState<string | null>(null);
  const [contacts, setContacts] = useState(data.departments);
  const weeks = Array.from({ length: 8 }, (_, i) => new Date(Date.parse(`${data.today}T00:00:00Z`) + i * 7 * 86_400_000).toISOString().slice(0, 10));
  const rows = deptNames.map((name) => {
    const tasks = calc.parts.flatMap((p) => allTasks(p.plan).filter((t) => t.dept === name && t.status !== "done" && t.status !== "skipped").map((t) => ({ p, t, s: calc.base.task(p.key, t.id) }))).sort((a, b) => (a.s?.end ?? "").localeCompare(b.s?.end ?? ""));
    const where = [...new Set(tasks.map((x) => x.p.title))];
    const owners = [...new Set(tasks.map((x) => x.t.owner).filter((n): n is string => !!n))];
    const load = owners.map((person) => {
      const days = calc.base.schedule.bookings.get(person) ?? calc.base.schedule.bookings.get([...calc.base.schedule.bookings.keys()].find((k) => k.toLowerCase() === person.toLowerCase()) ?? "") ?? new Map();
      const perWeek = data.people[person]?.hoursPerWeek ?? data.workWeek.hoursPerWeek;
      const byWeek = weeks.map((w) => { let h = 0; for (const [d, list] of days) if (d >= w && d < new Date(Date.parse(`${w}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10)) h += (list as { hours: number }[]).reduce((s, b) => s + b.hours, 0); return Math.round(h); });
      return { person, perWeek, byWeek, full: byWeek.filter((h) => h >= perWeek - 0.5).length };
    });
    const contact = contacts.find((c) => c.name === name);
    return { name, tasks, where, load, contact, overloaded: load.some((l) => l.full >= 3) };
  });
  return (
    <Card aria-label="Departments" className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-bold">What each department owes, across all plans</h2>
      <p className="m-0 text-sm text-ink-2">Hours a week per person, counted across every plan, for the next 8 weeks. Red: fully booked.</p>
      {rows.length === 0 && <p className="m-0 text-[15px] text-ink-2">No departments yet. Add "dept: IT" to tasks, or set each plan's lead department.</p>}
      {rows.map((r) => (
        <section key={r.name} aria-label={`Department ${r.name}`} className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <DeptChip name={r.name} />
            <span className="text-sm text-ink-2">{r.contact?.contact ? `${r.contact.contact}${r.contact.role ? ` · ${r.contact.role}` : ""}` : "No contact yet"}</span>
            <strong className="text-sm">{r.tasks.length ? plural(r.tasks.length, "open task") : "Nothing open"}</strong>
            {r.where.length > 0 && <span className="text-sm text-muted">in {r.where.join(", ")}</span>}
            {r.tasks[0] && <span className="text-sm text-muted">Next: {r.tasks[0].t.title}, due {shortDate(r.tasks[0].s?.end ?? data.today)}</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold sm:ml-auto ${r.overloaded ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>{r.overloaded ? "Overloaded" : "OK"}</span>
            <Button variant="secondary" aria-expanded={openDept === r.name} onClick={() => setOpenDept(openDept === r.name ? null : r.name)}>Tasks</Button>
          </div>
          {r.load.map((l) => (
            <div key={l.person} className="grid grid-cols-[9rem_1fr] items-center gap-2">
              <span className="text-sm font-semibold">{l.person} <span className="font-normal text-muted">· {l.perWeek} h/week</span></span>
              <div className="grid grid-cols-8 gap-1">{l.byWeek.map((h, i) => <span key={i} title={`Week of ${shortDate(weeks[i]!)}: ${h} of ${l.perWeek} h`} aria-label={`${l.person}, week of ${shortDate(weeks[i]!)}: ${h} of ${l.perWeek} hours`} className={`flex h-7 items-center justify-center rounded-md text-[11px] font-semibold ${h === 0 ? "bg-surface-2 text-muted" : h >= l.perWeek - 0.5 ? "bg-bad-soft text-bad ring-1 ring-bad" : "bg-primary-soft text-primary-ink"}`}>{h || ""}</span>)}</div>
            </div>
          ))}
          {openDept === r.name && (
            <div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr className="text-left text-xs text-muted uppercase"><th className="py-1 pr-3">Task</th><th className="py-1 pr-3">Plan</th><th className="py-1 pr-3">Who</th><th className="py-1">Due</th></tr></thead>
              <tbody>{r.tasks.map(({ p, t, s }) => <tr key={`${p.key}/${t.id}`} className="border-t border-line"><td className="py-1.5 pr-3 font-semibold">{t.title}</td><td className="py-1.5 pr-3">{p.title}</td><td className="py-1.5 pr-3">{t.owner}</td><td className="py-1.5">{s ? shortDate(s.end) : ""}</td></tr>)}</tbody></table></div>
          )}
          {data.canEdit && <ContactForm masterId={id} name={r.name} current={r.contact} onSaved={(c) => setContacts([...contacts.filter((x) => x.name !== r.name), c])} />}
        </section>
      ))}
    </Card>
  );
}

function ContactForm({ masterId, name, current, onSaved }: { masterId: string; name: string; current: { contact: string | null; role: string | null } | undefined; onSaved: (c: { name: string; contact: string | null; role: string | null }) => void }) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState(current?.contact ?? "");
  const [role, setRole] = useState(current?.role ?? "");
  if (!open) return <button className="min-h-10 self-start text-sm font-semibold text-primary-ink" onClick={() => setOpen(true)}>{current?.contact ? "Change contact" : "Add a contact"}</button>;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void api.setDepartmentContact(masterId, name, contact, role).then(() => { onSaved({ name, contact: contact || null, role: role || null }); setOpen(false); }); }}>
      <label className="flex flex-col gap-1 text-sm font-semibold">{name} contact<input value={contact} onChange={(e) => setContact(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-3 font-normal" /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Role<input value={role} onChange={(e) => setRole(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-3 font-normal" /></label>
      <Button type="submit">Save</Button><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}

function Discussion({ id, data }: { id: string; data: MasterData }) {
  const [threads, setThreads] = useState<MasterThread[] | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<{ messages: MasterMessage[]; people: { name: string }[] } | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const loadThreads = () => void api.masterThreads(id).then((r) => setThreads(r.threads)).catch(() => setError("Couldn't load the discussion."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadThreads, [id]);
  const current = scope ?? threads?.[0]?.scope ?? null;
  useEffect(() => { if (current) void api.masterThread(id, current).then(setMsgs).catch(() => {}); }, [id, current]);
  const titleOf = (about: string | null) => {
    if (!about) return null;
    const x = crossRef(about);
    const part = data.parts.find((p) => (x ? p.key === x.key : p.planId === current) || (!x && current === id && p.key === MASTER_KEY));
    const t = part && allTasks(part.plan).find((y) => y.id === (x ? x.id : about));
    return t ? { label: `About: ${t.title} (${part!.title})`, to: `/p/${part!.planId}` } : null;
  };
  if (!threads) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;
  const thread = threads.find((t) => t.scope === current);
  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <Card aria-label="Discussion threads" className="flex flex-col p-2">
        {threads.map((t) => (
          <button key={t.scope} aria-current={t.scope === current} onClick={() => setScope(t.scope)} className={`flex min-h-11 flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left ${t.scope === current ? "bg-primary-soft" : ""}`}>
            <span className="flex w-full items-center gap-2"><strong className="flex-1 text-[15px]">{t.title}</strong>{t.count > 0 && <span className="text-xs text-muted">{t.count}</span>}</span>
            <span className="w-full truncate text-xs text-ink-2">{t.last ? `${t.last.author}: ${t.last.body}` : "No messages yet."}</span>
          </button>
        ))}
      </Card>
      {thread && (
        <Card aria-label={`${thread.title} discussion`} className="flex flex-col gap-3">
          <h2 className="m-0 text-lg font-bold">{thread.title}</h2>
          <p className="m-0 text-sm text-muted">{thread.scope === id ? "Everyone on any plan in this master reads this thread." : `Everyone on ${thread.title} reads this thread, plus the master plan's people.`}</p>
          {msgs?.messages.length === 0 && <p className="m-0 text-[15px] text-ink-2">No messages yet.</p>}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {msgs?.messages.map((m) => { const about = titleOf(m.about); return (
              <li key={m.id} aria-label={`Message from ${m.author}`} className="flex flex-col gap-1 border-t border-line pt-2 first:border-t-0">
                <span className="text-xs text-muted"><strong className="text-sm text-ink">{m.author}</strong> · {when(m.at)}</span>
                <p className="m-0 text-[15px] whitespace-pre-wrap">{m.body}</p>
                {about && <Link to={about.to} className="self-start rounded-lg px-2 py-1 text-xs font-semibold text-primary-ink ring-1 ring-line">{about.label}</Link>}
              </li>
            ); })}
          </ul>
          {error && <Notice tone="bad">{error}</Notice>}
          <form className="flex flex-col gap-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); if (!text.trim() || !current) return; setError(""); void api.postMasterThread(id, current, text).then(() => { setText(""); loadThreads(); return api.masterThread(id, current).then(setMsgs); }).catch((er) => setError(er instanceof ApiError ? er.message : "That didn't post.")); }}>
            <label className="text-sm font-semibold" htmlFor="master-message">Message {thread.title}</label>
            <MentionBox id="master-message" rows={3} value={text} onValue={setText} people={(msgs?.people ?? []).map((p) => p.name)} placeholder={`Write to everyone on ${thread.title}. Type @ to mention someone.`} className="rounded-xl border border-line bg-surface p-2 text-[15px]" />
            <Button type="submit" className="self-start" disabled={!text.trim()}>Post</Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function Activity({ id, data }: { id: string; data: MasterData }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.masterActivity>>["items"] | null>(null);
  const [plan, setPlan] = useState("all");
  const [dept, setDept] = useState("all");
  useEffect(() => void api.masterActivity(id).then((r) => setItems(r.items)).catch(() => setItems([])), [id]);
  const deptOf = (key: string, taskId: string | null): string | null => { if (!taskId) return null; const p = data.parts.find((x) => x.key === key); return p ? allTasks(p.plan).find((t: Task) => t.id === taskId)?.dept ?? p.lead : null; };
  const depts = [...new Set(data.parts.flatMap((p) => [p.lead, ...p.needs, ...allTasks(p.plan).map((t) => t.dept)]).filter((x): x is string => !!x))];
  if (!items) return <Spinner />;
  const shown = items.filter((a) => (plan === "all" || a.key === plan) && (dept === "all" || deptOf(a.key, a.taskId) === dept));
  const pill = (on: boolean) => `min-h-10 shrink-0 rounded-full px-3 text-sm font-semibold ${on ? "bg-ink text-ground" : "bg-surface-2 text-ink-2 ring-1 ring-line"}`;
  return (
    <Card aria-label="Activity across all plans" className="flex flex-col gap-3">
      <div role="group" aria-label="Plan" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{[{ key: "all", title: "All plans" }, ...data.parts.map((p) => ({ key: p.key, title: p.key === MASTER_KEY ? "Whole building" : p.title }))].map((p) => <button key={p.key} aria-pressed={plan === p.key} onClick={() => setPlan(p.key)} className={pill(plan === p.key)}>{p.title}</button>)}</div>
      {depts.length > 0 && <div role="group" aria-label="Department" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{["all", ...depts].map((d) => <button key={d} aria-pressed={dept === d} onClick={() => setDept(d)} className={pill(dept === d)}>{d === "all" ? "All departments" : d}</button>)}</div>}
      {shown.length === 0 ? <p className="m-0 text-[15px] text-ink-2">Nothing yet for this plan and department.</p> : (
        <ul className="m-0 flex list-none flex-col p-0">{shown.map((a) => <li key={a.id} className="flex flex-col gap-0.5 border-t border-line py-2 first:border-t-0 sm:flex-row sm:items-baseline sm:gap-3"><span className="text-xs text-muted sm:w-36 sm:shrink-0">{when(a.at)}</span><span className="flex-1 text-[15px]">{a.summary}</span><span className="text-sm text-ink-2">{a.plan}</span></li>)}</ul>
      )}
    </Card>
  );
}

