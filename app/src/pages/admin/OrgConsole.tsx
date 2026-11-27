/**
 * The company admin console (step L3a, from the approved AdminConsole and AdminPhone boards): one
 * side panel listing every section (a sheet on phones), then Overview, People (filters, a person
 * panel, changes to many people at once: previewed first, undoable for 24 hours), Add people (the
 * same paste/CSV check as onboarding) and Licenses (seats; freeing seats unused for 60 days).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ClipboardCopy, LayoutGrid, Menu, RotateCcw, X } from "lucide-react";
import { BRAND } from "@rakuplan/shared";
import { api, ApiError, type BulkAction, type BulkResult, type Me, type OrgDetail, type OrgPerson, type OrgRole } from "../../lib/api";
import { plural, shortDate } from "../../lib/format";
import { Link, useRouter } from "../../lib/router";
import { Button, Card, Notice, PageTitle, Spinner } from "../../ui/kit";
import { PeopleEditor, ROLE_WORD, usePeopleList } from "../../ui/PeopleEditor";

const SECTIONS = ["overview", "people", "add", "licenses"] as const;
type Section = (typeof SECTIONS)[number];
const DAY = 86_400_000;
const input = "min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal";
const msg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** "Today", "Yesterday", "12 days ago", "Never". */
export function lastActive(at: number | null, now = Date.now()): string {
  if (!at) return "Never";
  const days = Math.floor((now - at) / DAY);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}

export function OrgConsole({ me, orgId, section }: { me: Me; orgId: string; section: string }) {
  const { go } = useRouter();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [people, setPeople] = useState<{ people: OrgPerson[]; reclaimable: string[]; inactiveDays: number } | null>(null);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const load = async () => {
    try {
      const [o, p] = await Promise.all([api.org(orgId), api.orgPeople(orgId)]);
      setOrg(o);
      setPeople(p);
    } catch (e) { setError(msg(e, "Couldn't load the company.")); }
  };
  useEffect(() => { void load(); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  const at: Section = (SECTIONS as readonly string[]).includes(section) ? (section as Section) : "overview";
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!org || !people) return <Spinner label="Loading the admin console" />;

  const titles: Record<Section, string> = { overview: "Overview", people: "People", add: "Add people", licenses: "Licenses" };
  const managedWs = me.workspaces.filter((w) => w.org_id === org.id && w.role === "manager");
  const groups: { heading: string; items: { to: string; label: string; cur: boolean; badge?: number }[] }[] = [
    { heading: "Manage", items: [
      { to: `/admin/org/${org.id}`, label: "Overview", cur: at === "overview" },
      { to: `/admin/org/${org.id}/people`, label: "People", cur: at === "people", ...(org.stats.invited ? { badge: org.stats.invited } : {}) },
      ...(org.can.people ? [{ to: `/admin/org/${org.id}/add`, label: "Add people", cur: at === "add" }] : []),
    ] },
    { heading: "Security and billing", items: [
      ...(!org.onboarding.done && org.can.settings ? [{ to: `/business/${org.id}`, label: "Finish setup", cur: false }] : []),
      { to: `/admin/org/${org.id}/licenses`, label: "Licenses", cur: at === "licenses", ...(org.stats.reclaimable ? { badge: org.stats.reclaimable } : {}) },
      ...managedWs.flatMap((w) => [
        { to: `/admin/ai/${w.id}`, label: `AI credits${managedWs.length > 1 ? ` · ${w.name}` : ""}`, cur: false },
        { to: `/admin/ai/${w.id}/spending`, label: `AI spending${managedWs.length > 1 ? ` · ${w.name}` : ""}`, cur: false },
      ]),
    ] },
  ];
  const panel = (
    <nav aria-label="Admin console" className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.heading} className="flex flex-col gap-1">
          <span className="px-3 text-xs font-bold tracking-wide text-muted uppercase">{g.heading}</span>
          {g.items.map((i) => (
            <Link key={i.to} to={i.to} aria-current={i.cur ? "page" : undefined} className={`flex min-h-11 items-center gap-2 rounded-xl px-3 text-[15px] font-medium ${i.cur ? "bg-primary-soft text-primary-ink" : "text-ink-2 hover:bg-surface-2"}`}>
              <span className="truncate">{i.label}</span>
              {i.badge ? <><span aria-hidden className="ml-auto rounded-full bg-surface-2 px-2 text-xs font-bold text-ink-2 ring-1 ring-line">{i.badge}</span><span className="sr-only">, {i.badge} to look at</span></> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
  const reload = () => load();
  return (
    <>
      <PageTitle
        title={titles[at]}
        sub={`${org.name} · admin console · you're ${ROLE_WORD[org.role]}`}
        actions={<Button variant="secondary" className="lg:hidden" onClick={() => setMenu(true)} aria-haspopup="dialog"><Menu aria-hidden size={18} /> Sections</Button>}
      />
      {menu && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40 lg:hidden" onClick={() => setMenu(false)}>
          <div role="dialog" aria-label="Console sections" className="max-h-[80dvh] w-full overflow-auto rounded-t-3xl bg-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom))]" onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).closest("a")) setMenu(false); }}>
            <div className="mb-2 flex items-center justify-between"><strong className="text-[17px]">{org.name}</strong><Button variant="ghost" aria-label="Close" onClick={() => setMenu(false)}><X aria-hidden size={20} /></Button></div>
            {panel}
          </div>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">{panel}</aside>
        <div className="flex min-w-0 flex-col gap-4">
          {at === "overview" && <Overview org={org} people={people.people} reload={reload} />}
          {at === "people" && <People org={org} people={people.people} reclaimable={people.reclaimable} reload={reload} />}
          {at === "add" && <AddPeople org={org} reload={reload} done={() => go(`/admin/org/${org.id}/people`)} />}
          {at === "licenses" && <Licenses org={org} people={people.people} reclaimable={people.reclaimable} inactiveDays={people.inactiveDays} reload={reload} />}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- overview

function Kpi({ label, value, note, action }: { label: string; value: string; note: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className="text-[22px] font-bold tabular-nums">{value}</span>
      <span className="text-sm text-ink-2">{note}</span>
      {action}
    </Card>
  );
}

function Overview({ org, people, reload }: { org: OrgDetail; people: OrgPerson[]; reload: () => Promise<void> }) {
  const { go } = useRouter();
  const s = org.stats;
  const left = org.seats.total - org.seats.taken;
  const domain = org.domains[0];
  const checklist: [string, boolean][] = [
    [domain ? `Domain ${domain.domain} verified` : "Domain verified", !!domain?.verified],
    ["At least 2 admins", s.admins >= 2],
    ["Setup finished (Go live)", !!org.onboarding.done],
    ["Guests from outside lose access after a set time", org.rules.preset !== "open"],
  ];
  const alerts: { title: string; body: string; action: string; to: string }[] = [];
  if (s.invited) alerts.push({ title: `${plural(s.invited, "invite")} not accepted`, body: "They can't see the company's plans until they join. Resend from People if needed.", action: "See invites", to: `/admin/org/${org.id}/people?filter=invited` });
  if (s.expired) alerts.push({ title: `${plural(s.expired, "invite")} expired`, body: "Expired links don't work. Resend to send a new one.", action: "See invites", to: `/admin/org/${org.id}/people?filter=invited` });
  if (left <= 2) alerts.push({ title: left <= 0 ? "No seats left" : `${plural(left, "seat")} left`, body: "New invites need a free seat.", action: "Manage seats", to: `/admin/org/${org.id}/licenses` });
  if (s.reclaimable) alerts.push({ title: `${plural(s.reclaimable, "person", "people")} inactive for 60+ days`, body: "Their seats can be freed for someone else.", action: "Review seat reclaim", to: `/admin/org/${org.id}/licenses` });
  const max = Math.max(1, ...s.departments.map((d) => d.people));
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Seats" value={`${org.seats.taken} of ${org.seats.total}`} note={s.reclaimable ? `${plural(s.reclaimable, "person", "people")} inactive for 60+ days` : `${plural(Math.max(0, left), "seat")} free`} action={<Link to={`/admin/org/${org.id}/licenses`} className="text-sm font-semibold text-primary-ink underline">Licenses</Link>} />
        <Kpi label="People" value={`${s.active} active`} note={`${s.activeThisWeek} used ${BRAND.name} this week`} />
        <Kpi label="Invites" value={`${s.invited} waiting`} note={s.expired ? `${s.expired} expired` : "None expired"} />
        <Kpi label="Rules" value={org.rules.preset[0]!.toUpperCase() + org.rules.preset.slice(1)} note={org.rules.guestDays ? `Outside guests: ${org.rules.guestDays} days` : "Outside guests keep access"} />
      </div>
      {alerts.length > 0 && (
        <Card aria-label="Needs attention" className="flex flex-col gap-3">
          <h2 className="m-0 text-lg font-bold">Needs attention</h2>
          {alerts.map((a) => (
            <div key={a.title} className="flex flex-wrap items-center gap-3 rounded-xl bg-warn-soft/50 p-3 ring-1 ring-warn/30">
              <span className="min-w-0 flex-1"><strong className="block text-[15px]">{a.title}</strong><span className="text-sm text-ink-2">{a.body}</span></span>
              <Button variant="secondary" onClick={() => go(a.to)}>{a.action}</Button>
            </div>
          ))}
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card aria-label="Setup checklist" className="flex flex-col gap-2">
          <h2 className="m-0 text-lg font-bold">Setup checklist · {checklist.filter((c) => c[1]).length} of {checklist.length} done</h2>
          {checklist.map(([label, ok]) => (
            <div key={label} className="flex items-center gap-3 text-[15px]">
              <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${ok ? "bg-good-soft text-good" : "bg-warn-soft text-warn"}`}>{ok ? "✓" : "!"}</span>
              <span className="flex-1">{label}</span>
              <span className={`text-xs font-bold ${ok ? "text-good" : "text-warn"}`}>{ok ? "Done" : "Not yet"}</span>
            </div>
          ))}
        </Card>
        <Card aria-label="People by department" className="flex flex-col gap-2">
          <h2 className="m-0 text-lg font-bold">People by department</h2>
          {s.departments.length === 0 && <p className="m-0 text-sm text-muted">No one yet.</p>}
          {s.departments.map((d) => (
            <div key={d.name ?? ""} className="flex flex-col gap-1">
              <span className="flex justify-between text-sm"><span>{d.name ?? "No department"}</span><span className="font-semibold tabular-nums">{d.people}</span></span>
              <span className="h-2 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-primary" style={{ width: `${(d.people / max) * 100}%` }} /></span>
            </div>
          ))}
        </Card>
      </div>
      <Workspaces org={org} people={people} reload={reload} />
    </>
  );
}

function Workspaces({ org, people, reload }: { org: OrgDetail; people: OrgPerson[]; reload: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card aria-label="Workspaces" className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-bold">Workspaces</h2>
      <p className="m-0 text-sm text-ink-2">Each workspace holds its own plans. People see the plans in their workspace; Owners and Admins see every workspace.</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {org.workspaces.map((w) => <li key={w.id} className="flex justify-between rounded-xl bg-surface-2 px-3 py-2 text-[15px]"><span>{w.name}</span><span className="text-sm text-ink-2">{plural(people.filter((p) => p.status === "active" && p.workspaces.includes(w.id)).length, "person", "people")}</span></li>)}
      </ul>
      {org.can.settings && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setBusy(true); setError(""); api.addWorkspace(org.id, name.trim()).then(() => { setName(""); return reload(); }).catch((x) => setError(msg(x, "Couldn't add it."))).finally(() => setBusy(false)); }}>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-semibold">New workspace<input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Field Ops North" className={input} /></label>
          <Button type="submit" variant="secondary" disabled={busy || !name.trim()}>Add workspace</Button>
        </form>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
    </Card>
  );
}

// ---------------------------------------------------------------- bulk changes: preview, apply, undo

const ACTIONS: { key: BulkAction; label: string }[] = [
  { key: "role", label: "Change role" },
  { key: "department", label: "Set department" },
  { key: "workspace", label: "Move to workspace" },
  { key: "resend", label: "Resend invite" },
  { key: "cancel", label: "Cancel invite" },
  { key: "deactivate", label: "Deactivate" },
  { key: "reactivate", label: "Reactivate" },
];
const VERB: Record<BulkAction, string> = { role: "Change role", department: "Set department", workspace: "Move", resend: "Resend", cancel: "Cancel invites", deactivate: "Deactivate", reactivate: "Reactivate" };

function LinkList({ links }: { links: { email: string; link: string }[] }) {
  const [copied, setCopied] = useState("");
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Invite links">
      {links.map((l) => (
        <li key={l.email} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3 ring-1 ring-line">
          <span className="min-w-0 flex-1 truncate text-[15px]">{l.email}</span>
          <Button variant="secondary" aria-label={`Copy link: ${l.link}`} onClick={() => void navigator.clipboard.writeText(l.link).then(() => setCopied(l.email)).catch(() => {})}>{copied === l.email ? <><Check aria-hidden size={18} /> Copied</> : <><ClipboardCopy aria-hidden size={18} /> Copy link</>}</Button>
        </li>
      ))}
    </ul>
  );
}

/** Preview → apply → undo for one action on some people. */
function BulkRun({ org, action, ids, value, onDone, onCancel }: { org: OrgDetail; action: BulkAction; ids: string[]; value?: string; onDone: (r: BulkResult) => void; onCancel: () => void }) {
  const [preview, setPreview] = useState<BulkResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPreview(null);
    api.bulkPeople(org.id, action, ids, value, true).then(setPreview).catch((e) => setError(msg(e, "Couldn't preview this.")));
  }, [org.id, action, ids.join(","), value]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = async () => {
    setBusy(true);
    try { onDone(await api.bulkPeople(org.id, action, ids, value, false)); } catch (e) { setError(msg(e, "That didn't work.")); setBusy(false); }
  };
  return (
    <section aria-label="Preview" className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4 ring-1 ring-line">
      {!preview && !error && <Spinner label="Checking" />}
      {preview && (
        <>
          <p className="m-0 text-[15px] font-semibold" role="status">{plural(preview.changes.length, "person", "people")} will change{preview.skipped.length ? `, ${preview.skipped.length} skipped` : ""}.{action !== "resend" && preview.changes.length ? " You can undo this for 24 hours." : ""}</p>
          {preview.changes.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" aria-label="Will change">
              {preview.changes.slice(0, 50).map((c) => <li key={c.id}><strong>{c.name}</strong>: {c.from} → {c.to}</li>)}
              {preview.changes.length > 50 && <li className="text-muted">and {preview.changes.length - 50} more</li>}
            </ul>
          )}
          {preview.skipped.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-warn" aria-label="Skipped">
              {preview.skipped.slice(0, 50).map((s) => <li key={s.id}><strong>{s.name}</strong>: {s.reason}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void apply()} disabled={busy || preview.changes.length === 0} variant={action === "deactivate" || action === "cancel" ? "danger" : "primary"}>{busy ? "Applying…" : `${VERB[action]} ${plural(preview.changes.length, "person", "people")}`}</Button>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          </div>
        </>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
    </section>
  );
}

/** What just happened, with Undo while it's allowed. */
function Done({ org, result, onUndone, onClose }: { org: OrgDetail; result: BulkResult; onUndone: () => void; onClose: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl bg-good-soft px-4 py-3 text-sm text-good">
        <span className="flex-1">Changed {plural(result.changes.length, "person", "people")}.{result.undoId ? " You can undo this for 24 hours." : ""}</span>
        {result.undoId && <Button variant="secondary" disabled={busy} onClick={() => { setBusy(true); api.undoBulk(org.id, result.undoId!).then(onUndone).catch((e) => { setError(msg(e, "Couldn't undo.")); setBusy(false); }); }}><RotateCcw aria-hidden size={16} /> Undo</Button>}
        <Button variant="ghost" aria-label="Dismiss" onClick={onClose}><X aria-hidden size={16} /></Button>
      </div>
      {result.links && result.links.length > 0 && <><p className="m-0 text-sm text-ink-2">New links (the old ones stop working). Emails wait in the outbox until sending is switched on, so send these yourself for now.</p><LinkList links={result.links} /></>}
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}

// ---------------------------------------------------------------- people

const STATUS_TONE: Record<OrgPerson["status"], string> = { active: "bg-good-soft text-good", invited: "bg-primary-soft text-primary-ink", expired: "bg-warn-soft text-warn", deactivated: "bg-surface-2 text-ink-2 ring-1 ring-line" };
const STATUS_WORD: Record<OrgPerson["status"], string> = { active: "Active", invited: "Invited", expired: "Invite expired", deactivated: "Deactivated" };

function People({ org, people, reclaimable, reload }: { org: OrgDetail; people: OrgPerson[]; reclaimable: string[]; reload: () => Promise<void> }) {
  const initial = new URLSearchParams(location.search).get("filter") ?? "all";
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(initial);
  const [role, setRole] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<BulkAction>("role");
  const [value, setValue] = useState("");
  const [running, setRunning] = useState<{ action: BulkAction; ids: string[]; value?: string } | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const ws = new Map(org.workspaces.map((w) => [w.id, w.name]));
  const departments = [...new Set(people.map((p) => p.department).filter((d): d is string => !!d))].sort();
  const idle = new Set(reclaimable);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return people.filter((p) =>
      (!k || `${p.name} ${p.email} ${p.department ?? ""}`.toLowerCase().includes(k)) &&
      (!role || p.role === role) &&
      (filter === "all" ? true : filter === "invited" ? p.status === "invited" || p.status === "expired" : filter === "deactivated" ? p.status === "deactivated" : filter === "inactive" ? idle.has(p.id) : p.department === filter.slice(5)));
  }, [people, q, filter, role]); // eslint-disable-line react-hooks/exhaustive-deps
  const allOn = shown.length > 0 && shown.every((p) => sel.has(p.id));
  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); setRunning(null); };
  const chosen = [...sel].filter((id) => people.some((p) => p.id === id));
  const needsValue = action === "role" || action === "department" || action === "workspace";
  const chips = [["all", "All"], ["invited", "Invited"], ["inactive", "Inactive 60+ days"], ["deactivated", "Deactivated"], ...departments.map((d) => [`dept:${d}`, d])] as [string, string][];
  const finish = async (r: BulkResult) => { setResult(r); setRunning(null); setSel(new Set()); await reload(); };

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-0 flex-1 basis-60 flex-col gap-1.5 text-sm font-semibold">Search<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or department" className={input} /></label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Role<select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} className={input}><option value="">Any role</option>{(Object.keys(ROLE_WORD) as OrgRole[]).map((r) => <option key={r} value={r}>{ROLE_WORD[r]}</option>)}</select></label>
        </div>
        <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
          {chips.map(([k, label]) => <button key={k} aria-pressed={filter === k} onClick={() => { setFilter(k); setSel(new Set()); }} className={`min-h-9 rounded-full px-3 text-[13px] font-semibold ${filter === k ? "bg-ink text-ground" : "bg-surface text-ink ring-1 ring-line hover:bg-surface-2"}`}>{label}</button>)}
        </div>
      </div>

      {result && <Done org={org} result={result} onUndone={() => { setResult(null); void reload(); }} onClose={() => setResult(null)} />}

      {chosen.length > 0 && org.can.support && (
        <Card aria-label="Change selected people" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <strong className="mr-auto self-center text-[15px]">{plural(chosen.length, "person", "people")} selected</strong>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">Change<select aria-label="Change" value={action} onChange={(e) => { setAction(e.target.value as BulkAction); setValue(""); setRunning(null); }} className={input}>{ACTIONS.filter((a) => org.can.people || a.key === "resend").map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></label>
            {action === "role" && <label className="flex flex-col gap-1.5 text-sm font-semibold">New role<select aria-label="New role" value={value} onChange={(e) => setValue(e.target.value)} className={input}><option value="">Choose</option>{(["member", "admin", "dept_admin", "helpdesk", "auditor", "guest", ...(org.role === "owner" ? ["owner"] : [])] as OrgRole[]).map((r) => <option key={r} value={r}>{ROLE_WORD[r]}</option>)}</select></label>}
            {action === "department" && <label className="flex flex-col gap-1.5 text-sm font-semibold">Department<input value={value} onChange={(e) => setValue(e.target.value)} list="departments" placeholder="Empty clears it" className={input} /><datalist id="departments">{departments.map((d) => <option key={d} value={d} />)}</datalist></label>}
            {action === "workspace" && <label className="flex flex-col gap-1.5 text-sm font-semibold">Workspace<select aria-label="Workspace" value={value} onChange={(e) => setValue(e.target.value)} className={input}><option value="">Choose</option>{org.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
            <Button disabled={(needsValue && action !== "department" && !value)} onClick={() => setRunning({ action, ids: chosen, ...(needsValue ? { value } : {}) })}>Preview</Button>
          </div>
          {running && <BulkRun org={org} {...running} onDone={(r) => void finish(r)} onCancel={() => setRunning(null)} />}
        </Card>
      )}

      <Card className="p-0">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(shown.map((p) => p.id)))} aria-label="Select everyone shown" /> Select all</label>
          <span className="ml-auto text-sm text-muted" role="status">Showing {plural(shown.length, "person", "people")}{shown.length !== people.length ? ` of ${people.length}` : ""}</span>
        </div>
        <table className="hidden w-full border-collapse text-left text-[14px] md:table">
          <thead><tr className="text-xs text-muted uppercase"><th className="w-10 px-4 py-2" /><th className="px-2 py-2">Name</th><th className="px-2 py-2">Department</th><th className="px-2 py-2">Workspace</th><th className="px-2 py-2">Role</th><th className="px-2 py-2">Last active</th><th className="px-4 py-2">Status</th></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className={`border-t border-line ${sel.has(p.id) ? "bg-primary-soft/40" : ""}`}>
                <td className="px-4 py-2"><input type="checkbox" className="h-5 w-5" checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} /></td>
                <td className="px-2 py-2">{p.kind === "person" ? <button className="text-left font-semibold underline-offset-2 hover:underline" onClick={() => setOpen(p.id)}>{p.name}</button> : <span className="font-semibold">{p.name}</span>}<span className="block text-xs text-muted">{p.email}</span></td>
                <td className="px-2 py-2">{p.department ?? <span className="text-muted">None</span>}</td>
                <td className="px-2 py-2">{p.workspaces.map((w) => ws.get(w)).filter(Boolean).join(", ") || <span className="text-muted">{p.role === "owner" || p.role === "admin" ? "All" : "None"}</span>}</td>
                <td className="px-2 py-2">{ROLE_WORD[p.role]}</td>
                <td className="px-2 py-2">{p.kind === "person" ? lastActive(p.lastActiveAt) : "Not joined"}</td>
                <td className="px-4 py-2"><span className={`rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${idle.has(p.id) ? "bg-warn-soft text-warn" : STATUS_TONE[p.status]}`}>{idle.has(p.id) ? "Inactive 60+ days" : STATUS_WORD[p.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="m-0 flex list-none flex-col p-0 md:hidden" aria-label="People">
          {shown.map((p) => (
            <li key={p.id} className={`flex items-start gap-3 border-t border-line px-4 py-3 ${sel.has(p.id) ? "bg-primary-soft/40" : ""}`}>
              <input type="checkbox" className="mt-1 h-5 w-5" checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {p.kind === "person" ? <button className="text-left text-[15px] font-semibold" onClick={() => setOpen(p.id)}>{p.name}</button> : <span className="text-[15px] font-semibold">{p.name}</span>}
                <span className="truncate text-sm text-ink-2">{p.email}</span>
                <span className="text-sm text-ink-2">{ROLE_WORD[p.role]}{p.department ? ` · ${p.department}` : ""} · {p.kind === "person" ? lastActive(p.lastActiveAt) : "Not joined"}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${idle.has(p.id) ? "bg-warn-soft text-warn" : STATUS_TONE[p.status]}`}>{idle.has(p.id) ? "Inactive" : STATUS_WORD[p.status]}</span>
            </li>
          ))}
        </ul>
        {shown.length === 0 && <p className="m-0 p-4 text-sm text-muted">No one matches.</p>}
      </Card>
      {open && <PersonPanel org={org} userId={open} onClose={() => setOpen(null)} onChanged={(r) => { setOpen(null); void finish(r); }} />}
    </>
  );
}

function PersonPanel({ org, userId, onClose, onChanged }: { org: OrgDetail; userId: string; onClose: () => void; onChanged: (r: BulkResult) => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.orgPerson>> | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [run, setRun] = useState<BulkAction | null>(null);
  useEffect(() => { api.orgPerson(org.id, userId).then(setD).catch((e) => setError(msg(e, "Couldn't load this person."))); }, [org.id, userId]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);
  const ws = new Map(org.workspaces.map((w) => [w.id, w.name]));
  const p = d?.person;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div role="dialog" aria-label={p?.name ?? "Person"} className="flex h-full w-full max-w-md flex-col gap-4 overflow-auto bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1"><h2 className="m-0 text-xl font-bold">{p?.name ?? "…"}</h2>{p && <p className="m-0 truncate text-sm text-ink-2">{p.email}</p>}</div>
          <Button variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden size={20} /></Button>
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        {!d && !error && <Spinner />}
        {p && d && (
          <>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
              <dt className="text-ink-2">Role</dt><dd className="m-0">{ROLE_WORD[p.role]}</dd>
              <dt className="text-ink-2">Status</dt><dd className="m-0">{STATUS_WORD[p.status]}</dd>
              <dt className="text-ink-2">Department</dt><dd className="m-0">{p.department ?? "None"}</dd>
              <dt className="text-ink-2">Workspaces</dt><dd className="m-0">{p.workspaces.map((w) => ws.get(w)).filter(Boolean).join(", ") || (p.role === "owner" || p.role === "admin" ? "All" : "None")}</dd>
              <dt className="text-ink-2">Joined</dt><dd className="m-0">{p.joinedAt ? shortDate(new Date(p.joinedAt).toISOString().slice(0, 10)) : "Not yet"}</dd>
              <dt className="text-ink-2">Last active</dt><dd className="m-0">{lastActive(p.lastActiveAt)}</dd>
              <dt className="text-ink-2">Signed in on</dt><dd className="m-0">{plural(d.sessions, "device")}</dd>
            </dl>
            <section aria-label="Plans they made" className="flex flex-col gap-1">
              <h3 className="m-0 text-[15px] font-bold">Plans they made</h3>
              {d.plans.length ? d.plans.map((x) => <Link key={x.id} to={`/p/${x.id}`} className="text-[15px] text-primary-ink underline">{x.title}</Link>) : <p className="m-0 text-sm text-muted">None in this company.</p>}
            </section>
            {org.can.support && (
              <div className="flex flex-col gap-2">
                <Button variant="secondary" onClick={() => api.signOutPerson(org.id, p.id).then((r) => setNote(`Signed out of ${plural(r.ended, "device")}. Their next sign-in works as usual.`)).catch((e) => setNote(msg(e, "Couldn't sign them out.")))}>Sign out everywhere</Button>
                {note && <Notice tone="good">{note}</Notice>}
              </div>
            )}
            {org.can.people && (
              <div className="flex flex-wrap gap-2">
                {p.status === "active" ? <Button variant="danger" onClick={() => setRun("deactivate")}>Deactivate…</Button> : <Button variant="secondary" onClick={() => setRun("reactivate")}>Reactivate…</Button>}
              </div>
            )}
            {run && <BulkRun org={org} action={run} ids={[p.id]} onDone={onChanged} onCancel={() => setRun(null)} />}
            {d.activity.length > 0 && (
              <section aria-label="Recent activity" className="flex flex-col gap-1">
                <h3 className="m-0 text-[15px] font-bold">Recent activity</h3>
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-ink-2">{d.activity.map((a, i) => <li key={i}>{new Date(a.at).toLocaleDateString()} · {a.actor}: {a.action} {a.target}</li>)}</ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- add people

function AddPeople({ org, reload, done }: { org: OrgDetail; reload: () => Promise<void>; done: () => void }) {
  const { list, view } = usePeopleList(org);
  const [sent, setSent] = useState<Awaited<ReturnType<typeof api.invitePeople>> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!org.can.people) return <Notice tone="warn">Your role can't add people.</Notice>;
  if (sent) {
    return (
      <Card className="flex flex-col gap-3">
        <Notice tone="good">Invited {plural(sent.invited.length, "person", "people")}. Each link works once, for that address, for 7 days. Emails wait in the outbox until sending is switched on, so send these yourself for now.</Notice>
        <LinkList links={sent.invited} />
        {sent.skipped.length > 0 && <Notice tone="warn">Not invited: {sent.skipped.map((s) => `${s.email || "a row"} (${s.problem?.replace(/\.$/, "")})`).join("; ")}.</Notice>}
        <div className="flex flex-wrap gap-2"><Button onClick={done}>See People</Button><Button variant="secondary" onClick={() => { setSent(null); list.clear(); }}>Add more</Button></div>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-4">
      <p className="m-0 text-[15px] text-ink-2">Paste names and email addresses, or upload a spreadsheet. Every row is checked before anyone is invited. {plural(Math.max(0, org.seats.total - org.seats.taken), "seat")} free.</p>
      <PeopleEditor view={view} />
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || list.dirty || list.busy || list.ready === 0} onClick={() => { setBusy(true); setError(""); api.invitePeople(org.id, list.requests).then(async (r) => { setSent(r); await reload(); }).catch((e) => setError(msg(e, "Couldn't send the invites."))).finally(() => setBusy(false)); }}>
          {busy ? "Inviting…" : list.ready ? `Invite ${plural(list.ready, "person", "people")}` : "Invite"}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- licenses

function Licenses({ org, people, reclaimable, inactiveDays, reload }: { org: OrgDetail; people: OrgPerson[]; reclaimable: string[]; inactiveDays: number; reload: () => Promise<void> }) {
  const [seats, setSeats] = useState(org.seats.total);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const idle = people.filter((p) => reclaimable.includes(p.id));
  const [pick, setPick] = useState<Set<string>>(() => new Set(reclaimable));
  const save = () => { setError(""); setSaved(false); api.setSeats(org.id, seats).then(async () => { setSaved(true); await reload(); }).catch((e) => setError(msg(e, "Couldn't change seats."))); };
  return (
    <>
      <Card aria-label="Seats" className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-bold">Seats</h2>
        <dl className="m-0 grid grid-cols-3 gap-2 text-center">
          {[["Seats", org.seats.total], ["In use", org.seats.taken], ["Free", Math.max(0, org.seats.total - org.seats.taken)]].map(([k, v]) => <div key={k} className="rounded-xl bg-surface-2 p-3"><dt className="text-sm text-ink-2">{k}</dt><dd className="m-0 text-[22px] font-bold tabular-nums">{v}</dd></div>)}
        </dl>
        <p className="m-0 text-sm text-ink-2">People in the company and open invites use a seat; guests from outside don't. There's no billing yet: the Owner sets the number.</p>
        {org.can.seats ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex items-center gap-1">
              <Button variant="secondary" aria-label="Fewer seats" onClick={() => setSeats(Math.max(org.seats.taken, seats - 1))}>−</Button>
              <label className="flex flex-col gap-1.5 text-sm font-semibold">Number of seats<input type="number" min={org.seats.taken} value={seats} onChange={(e) => setSeats(Number(e.target.value))} className={`${input} w-28 text-center`} /></label>
              <Button variant="secondary" aria-label="More seats" onClick={() => setSeats(seats + 1)}>+</Button>
            </div>
            <Button onClick={save} disabled={seats === org.seats.total}>Save seats</Button>
          </div>
        ) : <p className="m-0 text-sm text-muted">Only the Owner changes the number of seats.</p>}
        {saved && <Notice tone="good">Seats saved.</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}
      </Card>

      <Card aria-label="Seat reclaim" className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-bold">Inactive for {inactiveDays}+ days</h2>
        <p className="m-0 text-sm text-ink-2">People who haven't opened {BRAND.name} in {inactiveDays} days. Freeing their seat deactivates them: they lose access to the company's plans and are told. You can undo for 24 hours.</p>
        {result && <Done org={org} result={result} onUndone={() => { setResult(null); void reload(); }} onClose={() => setResult(null)} />}
        {idle.length === 0 && !result && <p className="m-0 text-[15px] text-good">✓ Everyone has been active recently.</p>}
        {idle.length > 0 && (
          <>
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Inactive people">
              {idle.map((p) => (
                <li key={p.id}><label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="checkbox" className="h-5 w-5" checked={pick.has(p.id)} onChange={() => { const n = new Set(pick); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); setPick(n); setRunning(false); }} /> <span className="flex-1">{p.name} <span className="text-sm text-ink-2">· {ROLE_WORD[p.role]}</span></span><span className="text-sm text-ink-2">{lastActive(p.lastActiveAt ?? p.joinedAt)}</span></label></li>
              ))}
            </ul>
            {org.can.people && !running && <Button className="self-start" variant="secondary" disabled={pick.size === 0} onClick={() => setRunning(true)}>Preview freeing {plural(pick.size, "seat")}</Button>}
            {running && <BulkRun org={org} action="deactivate" ids={[...pick]} onDone={(r) => { setResult(r); setRunning(false); void reload(); }} onCancel={() => setRunning(false)} />}
          </>
        )}
      </Card>
    </>
  );
}

/** For the sidebar: which companies' consoles this person opens. */
export const consoles = (me: Me) => (me.orgs ?? []).filter((o) => o.console);
export const ConsoleIcon = LayoutGrid;
