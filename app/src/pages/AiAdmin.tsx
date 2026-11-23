/**
 * A workspace's AI credits and spending, for the people who manage them (checked on the server).
 * Credits: the pool, requests, allowances, top-ups, departments.
 * Spending: cost and tokens by person, project and department; every row opens its breakdown.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownUp, ArrowLeft, Check, Download, X } from "lucide-react";
import { api, ApiError, type AiAdmin, type CreditRequest, type Me, type SpendDetail, type Spending, type SpendPeriod, type SpendRow, type SpendType } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useIsDesktop } from "../lib/view";
import { Button, Card, Notice, PageTitle, Spinner } from "../ui/kit";
import { describe, numberInput } from "./AskCredits";

const PERIODS: { id: SpendPeriod; label: string }[] = [
  { id: "month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "90d", label: "Last 90 days" },
];
const TYPE_LABEL: Record<SpendType, string> = { person: "Person", project: "Project", department: "Department" };
const VIEW_TYPE = { people: "person", projects: "project", departments: "department" } as const;
type View = keyof typeof VIEW_TYPE;

export const money = (v: number) => (v === 0 ? "$0" : v >= 1 ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : v >= 0.01 ? `$${v.toFixed(2)}` : `$${Number(v.toFixed(4))}`);
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const change = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? "No change" : "New this period") : `${cur >= prev ? "+" : "−"}${Math.round((Math.abs(cur - prev) / prev) * 100)}% vs previous period`);

export function AiAdminPage({ me, ws, tab, detail }: { me: Me; ws: string; tab: string; detail?: { type: SpendType; key: string } }) {
  const name = me.workspaces.find((w) => w.id === ws)?.name ?? "Workspace";
  const { path } = useRouter();
  const period = (new URLSearchParams(path.split("?")[1] ?? "").get("period") as SpendPeriod | null) ?? "month";
  const spending = tab === "spending" || !!detail;
  const tabs = [
    { to: `/admin/ai/${ws}`, label: "Credits", on: !spending },
    { to: `/admin/ai/${ws}/spending?period=${period}`, label: "AI spending", on: spending },
  ];
  return (
    <>
      <PageTitle title={spending ? "AI spending" : "AI credits"} sub={spending ? "Where AI tokens and money go, by person, project and department. Click any name for its breakdown." : `${name}: this month's pool, requests and allowances.`} />
      <nav aria-label="AI admin" className="flex gap-2">
        {tabs.map((t) => (
          <Link key={t.label} to={t.to} aria-current={t.on ? "page" : undefined} className={`flex min-h-11 items-center rounded-xl px-4 text-[15px] font-semibold ${t.on ? "bg-primary text-white dark:text-ground" : "bg-surface text-ink ring-1 ring-line"}`}>{t.label}</Link>
        ))}
      </nav>
      {detail ? <SpendingDetail ws={ws} period={period} type={detail.type} id={detail.key} /> : spending ? <SpendingView ws={ws} period={period} /> : <Credits ws={ws} />}
    </>
  );
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    setError("");
    load().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Can't load this right now. Try again."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

// ---------------------------------------------------------------- credits

function Credits({ ws }: { ws: string }) {
  const admin = useLoad(() => api.aiAdmin(ws), [ws]);
  const reqs = useLoad(() => api.creditRequests(ws), [ws]);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const reload = () => { admin.reload(); reqs.reload(); };
  const run = async (f: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await f(); setMsg({ tone: "good", text: ok }); reload(); } catch (e) { setMsg({ tone: "bad", text: e instanceof ApiError ? e.message : "That didn't work. Try again." }); }
  };
  if (admin.error) return <Notice tone="bad">{admin.error}</Notice>;
  if (!admin.data || !reqs.data) return <Spinner />;
  const a = admin.data;
  const pending = reqs.data.requests.filter((r) => r.status === "pending");
  const answered = reqs.data.requests.filter((r) => r.status !== "pending").slice(0, 8);
  return (
    <>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card aria-label="Pool this month" className="flex flex-col gap-3">
          <h2 className="m-0 text-lg font-bold">Pool this month</h2>
          <p className="m-0 text-sm text-muted">Everyone's AI use here comes out of this pool, on top of each person's own allowance.</p>
          <Bar label="AI checks" used={a.pool.used.checks} total={a.pool.total.checks} />
          <Bar label="AI reports" used={a.pool.used.reports} total={a.pool.total.reports} />
          <TopUp max={a.pool.max} total={a.pool.total} onAdd={(c, r, why) => run(() => api.topUp(ws, { checks: c, reports: r }, why), `Added ${describe({ checks: c, reports: r })} to the pool.`)} />
        </Card>
        <Card aria-label="Requests for more" className="flex flex-col gap-3">
          <h2 className="m-0 text-lg font-bold">Requests for more {pending.length > 0 && <span className="ml-1 rounded-full bg-warn-soft px-2 py-0.5 text-sm text-warn">{pending.length} waiting</span>}</h2>
          {pending.length === 0 && <p className="m-0 text-sm text-muted">No requests waiting.</p>}
          {pending.map((r) => <PendingRequest key={r.id} r={r} left={a.pool.left} onDecide={(d, amounts) => run(() => api.decideCredits(ws, r.id, d, amounts), d === "approve" ? `Gave ${r.name} ${describe(amounts ?? r)} more this month.` : `Declined ${r.name}'s request.`)} />)}
          {answered.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold">Answered ({answered.length})</summary>
              <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-sm">
                {answered.map((r) => <li key={r.id}>{r.name}: {describe(r)}, {r.status === "approved" ? "approved" : "declined"} by {r.decidedBy}</li>)}
              </ul>
            </details>
          )}
        </Card>
      </div>
      <Card aria-label="Allowances" className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-bold">Allowances</h2>
        <AllowanceForm label="Everyone, each month" value={a.defaultAllowance} onSave={(v) => run(() => api.setAllowance(ws, "*", v), "Saved the monthly allowance for everyone.")} />
        <People a={a} onAllowance={(id, n, v) => run(() => api.setAllowance(ws, id, v), `Saved ${n}'s allowance.`)} onDepartment={(id, n, d) => run(() => api.setDepartment(ws, id, d), d ? `${n} is now in ${d}.` : `Removed ${n}'s department.`)} />
      </Card>
    </>
  );
}

function Bar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 100;
  const low = pct >= 80;
  return (
    <div className="flex flex-col gap-1">
      <span className="flex justify-between text-sm"><span>{label}</span><span className={`font-semibold tabular-nums ${low ? "text-warn" : ""}`}>{used} of {total} used · {Math.max(0, total - used)} left</span></span>
      <span role="meter" aria-label={`${label} pool`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={used} className="h-2.5 overflow-hidden rounded-full bg-line"><span className={`block h-full ${low ? "bg-warn" : "bg-primary"}`} style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

function TopUp({ max, total, onAdd }: { max: number; total: { checks: number; reports: number }; onAdd: (checks: number, reports: number, why: string) => void }) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState("50");
  const [r, setR] = useState("0");
  const [why, setWhy] = useState("");
  const room = { checks: Math.max(0, max - total.checks), reports: Math.max(0, max - total.reports) };
  const nc = Number(c);
  const nr = Number(r);
  const valid = Number.isInteger(nc) && Number.isInteger(nr) && nc >= 0 && nr >= 0 && nc + nr > 0 && nc <= room.checks && nr <= room.reports;
  if (!open) return <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>Add credits to the pool</Button>;
  return (
    <form aria-label="Add credits to the pool" className="flex flex-col gap-3 rounded-xl border border-line p-3" onSubmit={(e) => { e.preventDefault(); if (valid) { onAdd(nc, nr, why); setOpen(false); } }}>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">AI checks <input inputMode="numeric" className={numberInput} value={c} onChange={(e) => setC(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm">AI reports <input inputMode="numeric" className={numberInput} value={r} onChange={(e) => setR(e.target.value)} /></label>
      </div>
      <span className={`text-sm ${valid ? "text-muted" : "text-bad"}`}>Room to add this month: {room.checks} checks and {room.reports} reports (a pool holds up to {max} of each until billing is set up).</span>
      <label className="flex flex-col gap-1 text-sm">Reason (kept in the record)<input value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} className="h-11 rounded-xl border border-line bg-surface px-3" placeholder="For example: launch month" /></label>
      <div className="flex gap-2"><Button type="submit" disabled={!valid}>Add to pool</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

function PendingRequest({ r, left, onDecide }: { r: CreditRequest; left: { checks: number; reports: number }; onDecide: (d: "approve" | "decline", amounts?: { checks: number; reports: number }) => void }) {
  const [c, setC] = useState(String(r.checks));
  const [rep, setRep] = useState(String(r.reports));
  const nc = Number(c);
  const nr = Number(rep);
  const fits = nc <= left.checks && nr <= left.reports;
  const valid = Number.isInteger(nc) && Number.isInteger(nr) && nc >= 0 && nr >= 0 && nc + nr > 0;
  return (
    <div aria-label={`Request from ${r.name}`} role="group" className="flex flex-col gap-2 rounded-xl border border-line p-3">
      <span className="text-[15px]"><strong>{r.name}</strong> asks for {describe(r)}</span>
      {r.note && <span className="text-sm text-ink-2">"{r.note}"</span>}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">Checks <input inputMode="numeric" className={numberInput} value={c} onChange={(e) => setC(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm">Reports <input inputMode="numeric" className={numberInput} value={rep} onChange={(e) => setRep(e.target.value)} /></label>
      </div>
      {!fits && <span className="text-sm text-bad">The pool only has {left.checks} checks and {left.reports} reports left. Add credits to the pool first, or give less.</span>}
      <div className="flex gap-2">
        <Button disabled={!valid || !fits} onClick={() => onDecide("approve", { checks: nc, reports: nr })}><Check aria-hidden size={16} /> Approve</Button>
        <Button variant="secondary" onClick={() => onDecide("decline")}><X aria-hidden size={16} /> Decline</Button>
      </div>
    </div>
  );
}

function AllowanceForm({ label, value, onSave }: { label: string; value: { checks: number; reports: number }; onSave: (v: { checks: number; reports: number }) => void }) {
  const [c, setC] = useState(String(value.checks));
  const [r, setR] = useState(String(value.reports));
  useEffect(() => { setC(String(value.checks)); setR(String(value.reports)); }, [value.checks, value.reports]);
  const nc = Number(c);
  const nr = Number(r);
  const valid = Number.isInteger(nc) && Number.isInteger(nr) && nc >= 0 && nr >= 0 && nc <= 10000 && nr <= 10000;
  const dirty = nc !== value.checks || nr !== value.reports;
  return (
    <form aria-label={label} className="flex flex-wrap items-center gap-3" onSubmit={(e) => { e.preventDefault(); if (valid) onSave({ checks: nc, reports: nr }); }}>
      <span className="min-w-40 text-sm font-semibold">{label}</span>
      <label className="flex items-center gap-2 text-sm">Checks <input inputMode="numeric" className={numberInput} value={c} onChange={(e) => setC(e.target.value)} aria-invalid={!valid} /></label>
      <label className="flex items-center gap-2 text-sm">Reports <input inputMode="numeric" className={numberInput} value={r} onChange={(e) => setR(e.target.value)} aria-invalid={!valid} /></label>
      <Button type="submit" variant="secondary" disabled={!valid || !dirty}>Save</Button>
    </form>
  );
}

function People({ a, onAllowance, onDepartment }: { a: AiAdmin; onAllowance: (id: string, name: string, v: { checks: number; reports: number }) => void; onDepartment: (id: string, name: string, d: string) => void }) {
  return (
    <ul aria-label="People" className="m-0 flex list-none flex-col divide-y divide-line p-0">
      {a.people.map((p) => (
        <li key={p.userId} className="flex flex-col gap-2 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span><strong>{p.name}</strong> <span className="text-sm text-muted">{p.email}</span></span>
            <span className="text-sm tabular-nums">{p.checks.used} of {p.checks.limit} checks · {p.reports.used} of {p.reports.limit} reports</span>
          </div>
          <Department value={p.department ?? ""} name={p.name} onSave={(d) => onDepartment(p.userId, p.name, d)} />
          <details>
            <summary className="cursor-pointer text-sm font-semibold">{p.override ? "Own allowance" : "Change allowance for this person"}</summary>
            <div className="mt-2"><AllowanceForm label={`${p.name}, each month`} value={{ checks: p.checks.limit, reports: p.reports.limit }} onSave={(v) => onAllowance(p.userId, p.name, v)} /></div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Department({ value, name, onSave }: { value: string; name: string; onSave: (d: string) => void }) {
  const [d, setD] = useState(value);
  useEffect(() => setD(value), [value]);
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); onSave(d.trim()); }}>
      <label className="flex items-center gap-2 text-sm">Department <input value={d} maxLength={80} onChange={(e) => setD(e.target.value)} className="h-11 w-48 rounded-xl border border-line bg-surface px-3" aria-label={`Department for ${name}`} placeholder="None" /></label>
      {d.trim() !== value && <Button type="submit" variant="secondary">Save</Button>}
    </form>
  );
}

// ---------------------------------------------------------------- spending

function PeriodPicker({ ws, period, extra = "" }: { ws: string; period: SpendPeriod; extra?: string }) {
  return (
    <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
      {PERIODS.map((p) => (
        <Link key={p.id} to={`/admin/ai/${ws}/spending${extra}?period=${p.id}`} aria-current={p.id === period ? "page" : undefined} className={`flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${p.id === period ? "bg-ink text-surface" : "bg-surface ring-1 ring-line"}`}>{p.label}</Link>
      ))}
    </div>
  );
}

function SpendingView({ ws, period }: { ws: string; period: SpendPeriod }) {
  const { data: s, error } = useLoad(() => api.spending(ws, period), [ws, period]);
  const [view, setView] = useState<View>("people");
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!s) return <Spinner />;
  const open = (type: SpendType, key: string) => `/admin/ai/${ws}/spending/${type}/${encodeURIComponent(key)}?period=${period}`;
  const idle = [...s.idle.people, ...s.idle.projects];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodPicker ws={ws} period={period} />
        <a href={api.spendingCsv(ws, view, period)} download className="flex min-h-11 items-center gap-2 rounded-xl bg-surface px-4 text-[15px] font-semibold ring-1 ring-line"><Download aria-hidden size={16} /> Export {view} (CSV)</a>
      </div>
      <span className="text-sm text-muted">{s.from} to {s.to}</span>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Cost" value={money(s.totals.cost)} sub={change(s.totals.cost, s.previousTotals.cost)} />
        <Kpi label="Runs" value={`${count(s.totals.checks, "check")} · ${count(s.totals.reports, "report")}`} sub={`${tokens(s.totals.inputTokens)} tokens in · ${tokens(s.totals.outputTokens)} out · ${count(s.totals.screenings, "screening")}`} />
        <Kpi label="Pool this month" value={`${s.pool.used.checks} of ${s.pool.total.checks} checks`} sub={`${s.pool.used.reports} of ${s.pool.total.reports} reports used`} />
      </div>
      <Card aria-label="Cost per day" className="flex flex-col gap-2">
        <h2 className="m-0 text-lg font-bold">Cost per day</h2>
        <DailyChart cur={s.daily} prev={s.previousDaily} from={s.from} />
      </Card>
      <div className="grid gap-3 lg:grid-cols-3">
        <Top title="Top people" rows={s.people} href={(k) => open("person", k)} total={s.totals.cost} />
        <Top title="Top projects" rows={s.projects} href={(k) => open("project", k)} total={s.totals.cost} />
        <Top title="Departments" rows={s.departments} href={(k) => open("department", k)} total={s.totals.cost} />
      </div>
      {idle.length > 0 && <Notice><strong>Not using AI this period:</strong> {idle.join(", ")}</Notice>}
      <div role="radiogroup" aria-label="Break down by" className="flex gap-2">
        {(Object.keys(VIEW_TYPE) as View[]).map((v) => (
          <button key={v} role="radio" aria-checked={v === view} onClick={() => setView(v)} className={`min-h-11 rounded-xl px-4 text-[15px] font-semibold capitalize ${v === view ? "bg-primary text-white dark:text-ground" : "bg-surface ring-1 ring-line"}`}>{v}</button>
        ))}
      </div>
      <Breakdown key={view} view={view} rows={s[view]} total={s.totals.cost} href={(k) => open(VIEW_TYPE[view], k)} />
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-xl font-bold tabular-nums">{value}</span>
      <span className="text-sm text-ink-2">{sub}</span>
    </Card>
  );
}

function Top({ title, rows, href, total }: { title: string; rows: SpendRow[]; href: (k: string) => string; total: number }) {
  const used = rows.filter((r) => r.cost > 0).slice(0, 5);
  return (
    <Card aria-label={title} className="flex flex-col gap-2">
      <h3 className="m-0 text-base font-bold">{title}</h3>
      {used.length === 0 && <span className="text-sm text-muted">No AI use yet.</span>}
      {used.map((r) => (
        <Link key={r.key} to={href(r.key)} className="flex flex-col gap-1 rounded-lg py-1 hover:bg-surface-2">
          <span className="flex justify-between text-sm"><span className="truncate font-semibold">{r.name}</span><span className="tabular-nums">{money(r.cost)}</span></span>
          <ShareBar share={total ? r.cost / total : 0} />
        </Link>
      ))}
    </Card>
  );
}

const ShareBar = ({ share }: { share: number }) => (
  <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full" style={{ width: `${Math.round(share * 100)}%`, background: "var(--series-1)" }} /></span>
);

function Breakdown({ view, rows, total, href }: { view: View; rows: SpendRow[]; total: number; href: (k: string) => string }) {
  const desktop = useIsDesktop();
  const [sort, setSort] = useState<{ by: "name" | "cost"; down: boolean }>({ by: "cost", down: true });
  const sorted = useMemo(() => [...rows].sort((a, b) => (sort.by === "name" ? a.name.localeCompare(b.name) : a.cost - b.cost) * (sort.down ? -1 : 1)), [rows, sort]);
  const cols: { h: string; v: (r: SpendRow) => ReactNode }[] =
    view === "people"
      ? [{ h: "Checks", v: (r) => r.checks }, { h: "Reports", v: (r) => r.reports }, { h: "Change", v: (r) => change(r.cost, r.previous) }]
      : view === "projects"
        ? [{ h: "Runs", v: (r) => r.runs }, { h: "Cost per run", v: (r) => (r.runs ? money(r.cost / r.runs) : "–") }, { h: "People using AI", v: (r) => r.people ?? 0 }]
        : [{ h: "People", v: (r) => r.people ?? 0 }, { h: "Using AI", v: (r) => r.active ?? 0 }, { h: "Cost per person", v: (r) => (r.people ? money(r.cost / r.people) : "–") }];
  const toggle = (by: "name" | "cost") => setSort((s) => ({ by, down: s.by === by ? !s.down : by === "cost" }));
  const share = (r: SpendRow) => (total ? r.cost / total : 0);
  if (!desktop) {
    return (
      <ul aria-label={`AI spending by ${view}`} className="m-0 flex list-none flex-col gap-2 p-0">
        {sorted.map((r) => (
          <li key={r.key}>
            <Link to={href(r.key)} className="flex flex-col gap-1 rounded-2xl bg-surface p-3 ring-1 ring-line">
              <span className="flex justify-between gap-2"><span className="font-semibold">{r.name}</span><span className="font-semibold tabular-nums">{money(r.cost)}</span></span>
              {r.department && <span className="text-sm text-muted">{r.department}</span>}
              <ShareBar share={share(r)} />
              <span className="text-sm text-ink-2">{cols.map((c) => `${c.h}: ${c.v(r)}`).join(" · ")}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Card className="overflow-x-auto p-0">
      <table aria-label={`AI spending by ${view}`} className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted uppercase">
            <th className="p-3"><button onClick={() => toggle("name")} className="inline-flex items-center gap-1 font-bold uppercase">Name <ArrowDownUp aria-hidden size={12} /></button></th>
            <th className="p-3"><button onClick={() => toggle("cost")} className="inline-flex items-center gap-1 font-bold uppercase">Cost <ArrowDownUp aria-hidden size={12} /></button></th>
            <th className="p-3">Share</th>
            {cols.map((c) => <th key={c.h} className="p-3">{c.h}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
              <td className="p-3"><Link to={href(r.key)} className="flex flex-col"><span className="font-semibold text-primary-ink underline-offset-2 hover:underline">{r.name}</span>{r.department && <span className="text-xs text-muted">{r.department}</span>}</Link></td>
              <td className="p-3 font-semibold tabular-nums">{money(r.cost)}</td>
              <td className="p-3"><span className="flex items-center gap-2"><span className="w-20"><ShareBar share={share(r)} /></span><span className="tabular-nums">{Math.round(share(r) * 100)}%</span></span></td>
              {cols.map((c) => <td key={c.h} className="p-3 tabular-nums">{c.v(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Cost per day, this period (solid) against the previous one (dashed). Hover or tap for the day's numbers. */
function DailyChart({ cur, prev, from }: { cur: number[]; prev?: number[]; from: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the box's real width so labels stay 12px on every screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 180, L = 52, R = 12, T = 12, B = 26;
  const max = Math.max(0.0001, ...cur, ...(prev ?? []));
  const nice = niceMax(max);
  const n = Math.max(cur.length, 2);
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / nice) * (H - T - B);
  const pts = (vs: number[]) => vs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const dayLabel = (i: number) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const pick = (clientX: number, rect: DOMRect) => setHover(Math.max(0, Math.min(cur.length - 1, Math.round((((clientX - rect.left) / rect.width) * W - L) / ((W - L - R) / (n - 1))))));
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="flex flex-wrap gap-4 text-sm text-ink-2">
        <span className="flex items-center gap-2"><svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke="var(--series-1)" strokeWidth="2" /></svg>This period</span>
        {prev && <span className="flex items-center gap-2"><svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke="var(--series-2)" strokeWidth="2" strokeDasharray="4 3" /></svg>Previous period</span>}
      </figcaption>
      <div ref={box} className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block touch-none" role="img" aria-label={`AI cost per day from ${from}. Total ${money(cur.reduce((a, b) => a + b, 0))}.`}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerLeave={() => setHover(null)}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={W - R} y1={y(nice * f)} y2={y(nice * f)} stroke="var(--line)" strokeWidth="1" />
              <text x={L - 6} y={y(nice * f) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{money(nice * f)}</text>
            </g>
          ))}
          <text x={L} y={H - 6} fontSize="12" fill="var(--muted)">{dayLabel(0)}</text>
          <text x={W - R} y={H - 6} textAnchor="end" fontSize="12" fill="var(--muted)">{dayLabel(cur.length - 1)}</text>
          {prev && <polyline points={pts(prev)} fill="none" stroke="var(--series-2)" strokeWidth="2" strokeDasharray="4 3" strokeLinejoin="round" />}
          <polyline points={pts(cur)} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" />
          {cur.length > 0 && <circle cx={x(cur.length - 1)} cy={y(cur[cur.length - 1]!)} r="4" fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth="1" />
              <circle cx={x(hover)} cy={y(cur[hover] ?? 0)} r="4" fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />
            </g>
          )}
          <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" />
        </svg>
        {hover !== null && (
          <div role="status" className="pointer-events-none absolute top-0 rounded-lg bg-surface px-3 py-2 text-sm shadow ring-1 ring-line" style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}>
            <strong>{dayLabel(hover)}</strong>: {money(cur[hover] ?? 0)}{prev && <> · previous {money(prev[hover] ?? 0)}</>}
          </div>
        )}
      </div>
    </figure>
  );
}

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function SpendingDetail({ ws, period, type, id }: { ws: string; period: SpendPeriod; type: SpendType; id: string }) {
  const { data: d, error } = useLoad<SpendDetail>(() => api.spendingDetail(ws, type, id, period), [ws, type, id, period]);
  const back = `/admin/ai/${ws}/spending?period=${period}`;
  if (error) return <><Link to={back} className="text-sm font-semibold text-primary underline">Back to AI spending</Link><Notice tone="bad">{error}</Notice></>;
  if (!d) return <Spinner />;
  const i = d.item;
  const facts: [string, string][] = [
    ["Cost", money(i.cost)],
    ["Compared with the previous period", change(i.cost, i.previous)],
    ["AI checks", String(i.checks)],
    ["AI reports", String(i.reports)],
    ["Screenings of new plans", String(i.screenings)],
    ["Tokens in / out", `${tokens(i.inputTokens)} / ${tokens(i.outputTokens)}`],
    ["Average cost per run", i.runs ? money(i.cost / i.runs) : "–"],
    ["Declined by the AI", String(i.declined)],
  ];
  return (
    <>
      <Link to={back} className="flex min-h-11 items-center gap-2 self-start text-sm font-semibold text-primary"><ArrowLeft aria-hidden size={16} /> Back to AI spending</Link>
      <PeriodPicker ws={ws} period={period} extra={`/${type}/${encodeURIComponent(id)}`} />
      <Card aria-label="Cost detail" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-muted uppercase">{TYPE_LABEL[type]}</span>
          <h2 className="m-0 text-xl font-bold">{i.name}</h2>
          {i.department && <span className="text-sm text-muted">{i.department}</span>}
        </div>
        <dl className="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {facts.map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1"><dt className="text-sm text-muted">{k}</dt><dd className="m-0 font-semibold tabular-nums">{v}</dd></div>)}
        </dl>
        {i.declined > 0 && <Notice tone="warn">The AI declined {i.declined === 1 ? "a request" : `${i.declined} requests`} here. Plans declined twice wait for a safety review.</Notice>}
      </Card>
      <Card aria-label="Cost per day for this item" className="flex flex-col gap-2"><h3 className="m-0 text-base font-bold">Cost per day</h3><DailyChart cur={d.daily} from={d.from} /></Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <Split title="By feature" rows={d.byFeature.map((f) => ({ key: f.key, label: FEATURE[f.key] ?? f.key, cost: f.cost, runs: f.runs }))} total={i.cost} />
        <Split title="By model" rows={d.byModel.map((f) => ({ key: f.key, label: f.key, cost: f.cost, runs: f.runs }))} total={i.cost} />
      </div>
      {d.related.length > 0 && (
        <Card aria-label="Related" className="flex flex-col gap-2">
          <h3 className="m-0 text-base font-bold">Related</h3>
          <div className="flex flex-wrap gap-2">
            {d.related.map((r) => <Link key={`${r.type}:${r.key}`} to={`/admin/ai/${ws}/spending/${r.type}/${encodeURIComponent(r.key)}?period=${period}`} className="flex min-h-11 items-center rounded-full bg-surface-2 px-4 text-sm font-semibold ring-1 ring-line">{TYPE_LABEL[r.type]}: {r.name} →</Link>)}
          </div>
        </Card>
      )}
    </>
  );
}

const FEATURE: Record<string, string> = { check: "AI Plan Check", report: "Status reports", moderation: "Screening new plans" };

function Split({ title, rows, total }: { title: string; rows: { key: string; label: string; cost: number; runs: number }[]; total: number }) {
  return (
    <Card aria-label={title} className="flex flex-col gap-2">
      <h3 className="m-0 text-base font-bold">{title}</h3>
      {rows.length === 0 && <span className="text-sm text-muted">No AI use in this period.</span>}
      {rows.map((r) => (
        <div key={r.key} className="flex flex-col gap-1">
          <span className="flex justify-between text-sm"><span>{r.label} · {r.runs} run{r.runs === 1 ? "" : "s"}</span><span className="font-semibold tabular-nums">{money(r.cost)}</span></span>
          <ShareBar share={total ? r.cost / total : 0} />
        </div>
      ))}
    </Card>
  );
}
