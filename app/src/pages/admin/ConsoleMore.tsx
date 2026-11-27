/**
 * Admin console, part 2 (step L3b): Offboarding (with orphaned plans), Rules (who a change affects,
 * before saving), Domains, the Audit log, and the Ctrl/Cmd+K command bar.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCopy, Download, Search } from "lucide-react";
import { api, ApiError, type OffboardSummary, type OrgDetail, type OrgPerson, type PlanSummary, type RulePreset } from "../../lib/api";
import { plural } from "../../lib/format";
import { Link, useRouter } from "../../lib/router";
import { Button, Card, Notice, Spinner } from "../../ui/kit";
import { RULES } from "../BusinessStart";

const input = "min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal";
const msg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

// ---------------------------------------------------------------- offboarding

const STEPS = ["Person", "Hand over work", "Confirm"];

export function Offboarding({ org, people, me, reload }: { org: OrgDetail; people: OrgPerson[]; me: string; reload: () => Promise<void> }) {
  const choices = people.filter((p) => p.kind === "person" && p.status === "active" && p.id !== me);
  const [who, setWho] = useState(() => new URLSearchParams(location.search).get("person") ?? "");
  const [step, setStep] = useState(0);
  const [sum, setSum] = useState<OffboardSummary | null>(null);
  const [to, setTo] = useState("");
  const [per, setPer] = useState<Record<string, string>>({});
  const [done, setDone] = useState<OffboardSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(msg(e, "That didn't work.")); } finally { setBusy(false); } };
  const preview = () => run(async () => {
    const s = await api.offboard(org.id, who, { dryRun: true });
    setSum(s);
    setTo(s.recipients[0]?.id ?? "");
    setPer({});
    setStep(1);
  });
  const nameOf = (id: string) => sum?.recipients.find((r) => r.id === id)?.name ?? "";
  const taskCount = sum?.tasks.reduce((n, t) => n + t.count, 0) ?? 0;
  if (!org.can.people) return <><Notice tone="warn">Your role can't offboard people.</Notice><Orphans org={org} /></>;
  return (
    <>
      <Card aria-label="Offboard someone" className="flex flex-col gap-4">
        <ol className="m-0 grid list-none grid-cols-3 gap-2 p-0" aria-label="Steps">
          {STEPS.map((s, i) => <li key={s} aria-current={i === step ? "step" : undefined} className={`rounded-xl px-3 py-2 text-sm font-semibold ${i === step ? "bg-primary-soft text-primary-ink ring-2 ring-primary" : i < step ? "bg-good-soft text-good" : "bg-surface-2 text-ink-2"}`}>{i + 1}{i < step ? " ✓" : ""} {s}</li>)}
        </ol>
        {done ? (
          <>
            <Notice tone="good">{done.person.name} is offboarded: signed out of {plural(done.sessions, "device")}, no longer in the company's plans, and their seat is free.</Notice>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[15px]">
              {done.plans.length > 0 && <li>{plural(done.plans.length, "plan")} handed over</li>}
              {taskCount > 0 && <li>{plural(taskCount, "open task")} handed over</li>}
              {done.invites > 0 && <li>{plural(done.invites, "invite")} they sent turned off</li>}
            </ul>
            <p className="m-0 text-sm text-ink-2">To bring them back, reactivate them in People. The work you handed over stays with its new owners.</p>
            <Button className="self-start" variant="secondary" onClick={() => { setDone(null); setSum(null); setWho(""); setStep(0); }}>Offboard someone else</Button>
          </>
        ) : step === 0 ? (
          <>
            <p className="m-0 text-[15px] text-ink-2">Offboarding ends someone's access to the company's plans, signs them out on every device, hands their plans and open tasks to someone else, and turns off invites they sent. You see everything before it happens.</p>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">Who is leaving?
              <select value={who} onChange={(e) => setWho(e.target.value)} className={input}><option value="">Choose a person</option>{choices.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}</select>
            </label>
            <p className="m-0 text-sm text-muted">They're offboarded as soon as you confirm. Picking a future date comes later.</p>
            <Button className="self-start" disabled={!who || busy} onClick={() => void preview()}>Continue</Button>
          </>
        ) : step === 1 && sum ? (
          <>
            <p className="m-0 text-[15px]"><strong>{sum.person.name}</strong> made {plural(sum.plans.length, "plan")} and has {plural(taskCount, "open task")} in the company's plans.</p>
            {(sum.plans.length > 0 || taskCount > 0) ? (
              <>
                <label className="flex flex-col gap-1.5 text-sm font-semibold">Hand their work to
                  <select value={to} onChange={(e) => setTo(e.target.value)} className={input}>{sum.recipients.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                </label>
                {sum.plans.length > 0 && (
                  <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                    <legend className="mb-1 text-sm font-semibold">Plans they made (change any one)</legend>
                    {sum.plans.map((p) => (
                      <label key={p.id} className="flex flex-wrap items-center gap-2 text-[15px]"><span className="min-w-0 flex-1">{p.title}</span>
                        <select aria-label={`New owner of ${p.title}`} value={per[p.id] ?? to} onChange={(e) => setPer({ ...per, [p.id]: e.target.value })} className={input}>{sum.recipients.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                      </label>
                    ))}
                  </fieldset>
                )}
                {sum.tasks.length > 0 && <p className="m-0 text-sm text-ink-2">Open tasks: {sum.tasks.map((t) => `${t.count} in ${t.title}`).join(", ")}. They go to the plan's new owner where you chose one, else to {nameOf(to)}. Finished tasks keep {sum.person.name}'s name.</p>}
              </>
            ) : <p className="m-0 text-sm text-ink-2">Nothing to hand over.</p>}
            <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setStep(0)}>Back</Button><Button disabled={(sum.plans.length > 0 || taskCount > 0) && !to} onClick={() => setStep(2)}>Continue</Button></div>
          </>
        ) : sum ? (
          <>
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="What will happen">
              {[
                `${sum.person.name} loses access to the company's plans and their seat is freed`,
                `Signed out of ${plural(sum.sessions, "device")} at once`,
                ...sum.plans.map((p) => `${p.title}: new owner ${nameOf(per[p.id] ?? to)}`),
                ...(taskCount ? [`${plural(taskCount, "open task")} handed over`] : []),
                ...(sum.invites ? [`${plural(sum.invites, "invite")} they sent turned off`] : []),
              ].map((l) => <li key={l} className="flex items-start gap-2 text-[15px]"><Check aria-hidden size={18} className="mt-0.5 shrink-0 text-good" />{l}</li>)}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button variant="danger" disabled={busy} onClick={() => void run(async () => { const planOwners = Object.fromEntries(sum.plans.map((p) => [p.id, per[p.id] ?? to])); setDone(await api.offboard(org.id, who, { transferTo: to, planOwners })); await reload(); })}>{busy ? "Offboarding…" : `Offboard ${sum.person.name}`}</Button>
            </div>
          </>
        ) : null}
        {error && <Notice tone="bad">{error}</Notice>}
      </Card>
      <Orphans org={org} />
    </>
  );
}

function Orphans({ org }: { org: OrgDetail }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.orphans>> | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const load = () => api.orphans(org.id).then(setD).catch((e) => setError(msg(e, "Couldn't load.")));
  useEffect(() => { void load(); }, [org.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card aria-label="Orphaned plans" className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-bold">Orphaned plans</h2>
      <p className="m-0 text-sm text-ink-2">Plans whose maker is no longer in the company. Give each one a new owner.</p>
      {!d && !error && <Spinner />}
      {d && d.plans.length === 0 && <p className="m-0 text-[15px] text-good">✓ Every plan has an owner in the company.</p>}
      {d?.plans.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3 ring-1 ring-line">
          <span className="min-w-0 flex-1"><Link to={`/p/${p.id}`} className="font-semibold underline">{p.title}</Link><span className="block text-sm text-ink-2">{p.workspace} · made by {p.maker ?? "someone who left"}</span></span>
          {org.can.people && (
            <>
              <select aria-label={`New owner of ${p.title}`} value={pick[p.id] ?? ""} onChange={(e) => setPick({ ...pick, [p.id]: e.target.value })} className={input}><option value="">Choose</option>{d.recipients.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
              <Button variant="secondary" disabled={!pick[p.id]} onClick={() => api.setPlanOwner(org.id, p.id, pick[p.id]!).then(load).catch((e) => setError(msg(e, "Couldn't change the owner.")))}>Give it to them</Button>
            </>
          )}
        </div>
      ))}
      {error && <Notice tone="bad">{error}</Notice>}
    </Card>
  );
}

// ---------------------------------------------------------------- rules

export function Rules({ org, reload }: { org: OrgDetail; reload: () => Promise<void> }) {
  const [preset, setPreset] = useState<RulePreset>(org.rules.preset);
  const [p, setP] = useState<Awaited<ReturnType<typeof api.rulesPreview>> | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setSaved(false); api.rulesPreview(org.id, preset).then(setP).catch((e) => setError(msg(e, "Couldn't preview."))); }, [org.id, preset]);
  const changed = preset !== org.rules.preset;
  return (
    <Card aria-label="Rules" className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Rules" className="flex flex-col gap-2">
        {(Object.keys(RULES) as RulePreset[]).map((k) => (
          <label key={k} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl p-3.5 ${preset === k ? "bg-surface-2 ring-2 ring-ink" : "bg-surface ring-1 ring-line hover:bg-surface-2"}`}>
            <input type="radio" name="rules" checked={preset === k} onChange={() => setPreset(k)} disabled={!org.can.settings} className="mt-1 h-5 w-5 shrink-0" />
            <span className="flex flex-col gap-0.5"><span className="text-[15px] font-semibold">{RULES[k].label}{org.rules.preset === k ? " · current" : ""}</span><span className="text-sm text-ink-2">{RULES[k].hint}</span></span>
          </label>
        ))}
      </div>
      {p && (
        <section aria-label="Who this affects" className="flex flex-col gap-1.5 rounded-xl bg-surface-2 p-4 ring-1 ring-line">
          <strong className="text-[15px]">{changed ? "Who this affects" : "What these rules mean"}</strong>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-ink-2">
            <li>{changed ? `People who can invite outsiders: ${p.inviters.before} now, ${p.inviters.after} after.` : `${plural(p.inviters.after, "person", "people")} can invite people from outside the company.`}</li>
            <li>{changed ? `People who can download plan files: ${p.exporters.before} now, ${p.exporters.after} after.` : `${plural(p.exporters.after, "person", "people")} can download plan files.`}</li>
            <li>{p.after.guestDays ? `Outside guests who join from now on lose access after ${p.after.guestDays} days.` : "Outside guests who join from now on keep access until someone removes them."}{p.guestsNow ? ` The ${plural(p.guestsNow, "guest")} with access now keep${p.guestsNow === 1 ? "s" : ""} their current end date.` : ""}</li>
            <li>Every download of a company plan is recorded in the audit log.</li>
          </ul>
        </section>
      )}
      {org.can.settings ? <Button className="self-start" disabled={!changed} onClick={() => api.setRules(org.id, preset).then(async () => { setSaved(true); await reload(); }).catch((e) => setError(msg(e, "Couldn't save.")))}>Save rules</Button> : <p className="m-0 text-sm text-muted">Only Owners and Admins change the rules.</p>}
      {saved && <Notice tone="good">Rules saved. The change is in the audit log.</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
    </Card>
  );
}

// ---------------------------------------------------------------- domains

export function Domains({ org, reload }: { org: OrgDetail; reload: () => Promise<void> }) {
  const [domain, setDomain] = useState("");
  const [state, setState] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      {org.domains.map((d) => (
        <Card key={d.domain} aria-label={d.domain} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2"><h2 className="m-0 flex-1 text-lg font-bold">{d.domain}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${d.verified ? "bg-good-soft text-good" : "bg-warn-soft text-warn"}`}>{d.verified ? "Verified" : "Not verified yet"}</span></div>
          {d.verified ? <p className="m-0 text-sm text-ink-2">People on @{d.domain} count as part of the company: they can only join as members, not as outside guests.</p> : (
            <>
              <p className="m-0 text-sm text-ink-2">Add this TXT record where the domain is managed, then check.</p>
              <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-xl bg-surface-2 p-4 text-[15px] ring-1 ring-line">
                <dt className="font-semibold text-ink-2">Type</dt><dd className="m-0 font-mono">TXT</dd>
                <dt className="font-semibold text-ink-2">Name</dt><dd className="m-0 font-mono">@ ({d.domain})</dd>
                <dt className="font-semibold text-ink-2">Value</dt><dd className="m-0 min-w-0 font-mono break-all">{d.record}</dd>
              </dl>
              {org.can.settings && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(d.record).then(() => setCopied(d.domain)).catch(() => {})}>{copied === d.domain ? <><Check aria-hidden size={18} /> Copied</> : <><ClipboardCopy aria-hidden size={18} /> Copy the value</>}</Button>
                  <Button variant="secondary" onClick={() => api.checkDomain(org.id, d.domain).then(async (r) => { setState({ ...state, [d.domain]: r.verified ? "" : r.reason ?? "Not found yet." }); if (r.verified) await reload(); }).catch((e) => setError(msg(e, "Couldn't check.")))}>Check now</Button>
                </div>
              )}
              {state[d.domain] && <p role="status" className="m-0 text-[15px] font-semibold text-ink-2">{state[d.domain]}</p>}
            </>
          )}
        </Card>
      ))}
      {org.can.settings && (
        <Card aria-label="Add a domain" className="flex flex-col gap-2">
          {org.domains.length === 0 && <p className="m-0 text-sm text-ink-2">Verifying your email domain means people on it can only join as members, never as outside guests.</p>}
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setError(""); api.addDomain(org.id, domain.trim()).then(async () => { setDomain(""); await reload(); }).catch((x) => setError(msg(x, "Couldn't add it."))); }}>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-semibold">{org.domains.length ? "Add another domain" : "Your company's domain"}<input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="northfield.com" className={input} /></label>
            <Button type="submit" variant="secondary" disabled={!domain.trim()}>Get the record</Button>
          </form>
        </Card>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
    </>
  );
}

// ---------------------------------------------------------------- audit log

const ACTION_WORD: Record<string, string> = {
  "org.created": "Company created", "org.live": "Went live", "people.invited": "Invited people", "person.joined": "Joined", "seats.changed": "Seats changed",
  "domain.added": "Domain added", "domain.verified": "Domain verified", "rules.changed": "Rules changed", "plan.exported": "Plan downloaded",
  "people.role": "Role changed", "people.department": "Department set", "people.workspace": "Moved workspace", "people.deactivate": "Deactivated",
  "people.reactivate": "Reactivated", "people.resend": "Invite resent", "people.cancel": "Invite cancelled", "people.undo": "Change undone",
  "person.signed_out": "Signed out everywhere", "person.offboarded": "Offboarded", "workspace.added": "Workspace added", "plan.owner_changed": "Plan owner changed",
};

export function AuditLog({ org }: { org: OrgDetail }) {
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [action, setAction] = useState("");
  const [d, setD] = useState<Awaited<ReturnType<typeof api.audit>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!org.can.audit) return;
    const t = setTimeout(() => api.audit(org.id, q, action).then(setD).catch((e) => setError(msg(e, "Couldn't load the log."))), 200);
    return () => clearTimeout(t);
  }, [org.id, q, action, org.can.audit]);
  if (!org.can.audit) return <Notice tone="warn">Only Owners, Admins and Auditors can read the audit log.</Notice>;
  return (
    <>
      {d && (d.intact ? <Notice tone="good">✓ Log intact: every entry matches the one before it, so nothing has been changed or removed.</Notice> : <Notice tone="bad">The log has been changed: entry {d.brokenAt} doesn't match the one before it. Contact support.</Notice>)}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 basis-60 flex-col gap-1.5 text-sm font-semibold">Search<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Person, email, plan…" className={input} /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">What happened<select aria-label="What happened" value={action} onChange={(e) => setAction(e.target.value)} className={input}><option value="">Everything</option>{d?.actions.map((a) => <option key={a} value={a}>{ACTION_WORD[a] ?? a}</option>)}</select></label>
        <a href={`/api/orgs/${encodeURIComponent(org.id)}/audit?format=csv&q=${encodeURIComponent(q)}&action=${encodeURIComponent(action)}`} download className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[15px] font-semibold hover:bg-surface-2"><Download aria-hidden size={18} /> Download CSV</a>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {!d && !error && <Spinner />}
      {d && (
        <Card className="p-0">
          <p className="m-0 border-b border-line px-4 py-3 text-sm text-muted" role="status">{plural(d.total, "entry", "entries")}{d.total > d.items.length ? `, newest ${d.items.length} shown` : ""}</p>
          <ol className="m-0 flex list-none flex-col p-0" aria-label="Audit entries">
            {d.items.map((i) => (
              <li key={i.seq} className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-line px-4 py-2.5 text-[14px] first:border-t-0">
                <span className="w-40 shrink-0 text-ink-2 tabular-nums">{new Date(i.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                <span className="min-w-0 flex-1"><strong>{ACTION_WORD[i.action] ?? i.action}</strong> · {i.target} <span className="text-ink-2">by {i.actor}</span></span>
                <span className="text-xs text-muted">#{i.seq}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- command bar (Ctrl/Cmd+K)

type Hit = { group: string; label: string; to: string };

export function CommandBar({ org, people, sections, onClose }: { org: OrgDetail; people: OrgPerson[]; sections: { label: string; to: string }[]; onClose: () => void }) {
  const { go } = useRouter();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { box.current?.focus(); api.plans().then((r) => setPlans(r.plans.filter((p) => org.workspaces.some((w) => w.id === p.workspace_id)))).catch(() => {}); }, [org]);
  const hits = useMemo<Hit[]>(() => {
    const k = q.trim().toLowerCase();
    const has = (s: string) => !k || s.toLowerCase().includes(k);
    const base = `/admin/org/${org.id}`;
    const out: Hit[] = [
      ...sections.filter((s) => has(s.label)).map((s) => ({ group: "Go to", ...s })),
      ...people.filter((p) => k && has(`${p.name} ${p.email}`)).slice(0, 8).map((p) => ({ group: "People", label: `${p.name} · ${p.email}`, to: p.kind === "person" ? `${base}/people?person=${encodeURIComponent(p.id)}` : `${base}/people?filter=invited` })),
      ...org.workspaces.filter((w) => k && has(w.name)).map((w) => ({ group: "Workspaces", label: w.name, to: base })),
      ...plans.filter((p) => k && has(p.title)).slice(0, 8).map((p) => ({ group: "Plans", label: p.title, to: `/p/${p.id}` })),
    ];
    if (k && org.can.audit) out.push({ group: "Audit log", label: `Search the audit log for “${q.trim()}”`, to: `${base}/audit?q=${encodeURIComponent(q.trim())}` });
    return out;
  }, [q, plans, people, org, sections]);
  useEffect(() => setAt(0), [q]);
  const open = (h: Hit | undefined) => { if (!h) return; onClose(); go(h.to); };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[10vh]" onClick={onClose}>
      <div role="dialog" aria-label="Command bar" className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface shadow-xl ring-1 ring-line" onClick={(e) => e.stopPropagation()}>
        <label className="flex items-center gap-2 border-b border-line px-4">
          <Search aria-hidden size={18} className="text-muted" />
          <input ref={box} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people, plans, workspaces and settings" placeholder="Search people, plans, workspaces, settings…" className="min-h-14 flex-1 bg-transparent text-base outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setAt(Math.min(hits.length - 1, at + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setAt(Math.max(0, at - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); open(hits[at]); }
            }} />
        </label>
        <ul role="listbox" aria-label="Results" className="m-0 max-h-[60vh] list-none overflow-auto p-2">
          {hits.map((h, i) => (
            <li key={`${h.group}-${h.to}-${h.label}`} role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onClick={() => open(h)} className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] ${i === at ? "bg-primary-soft text-primary-ink" : ""}`}>
              <span className="w-24 shrink-0 text-xs font-bold text-muted uppercase">{h.group}</span><span className="min-w-0 flex-1 truncate">{h.label}</span>
            </li>
          ))}
          {hits.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}
