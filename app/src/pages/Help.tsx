/**
 * Help: your company's support (when a manager set it), a request to our support team, your
 * requests, requests from your team (for managers when the company routes help through IT),
 * and the security contact.
 */
import { useEffect, useState } from "react";
import { ExternalLink, LifeBuoy, Mail, Phone, Send, ShieldCheck } from "lucide-react";
import { BRAND } from "@rakuplan/shared";
import { api, ApiError, type HelpInfo, type Me, type PlanSummary, type SupportContact, type TicketRow, type TicketThread, type TicketTopic } from "../lib/api";
import { recentErrors } from "../lib/errors";
import { Link, useRouter } from "../lib/router";
import { Button, Card, Notice, PageTitle, Spinner } from "../ui/kit";

export const TOPIC: Record<TicketTopic, string> = { problem: "Something isn't working", question: "A question", billing: "Billing", account: "My account or sign-in", safety: "Report abuse or a safety problem" };
const STATUS: Record<string, string> = { open: "Open", waiting: "Waiting for you", solved: "Solved" };
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const domain = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };
const field = "min-h-11 rounded-xl border border-line bg-surface px-3 text-base";

export function HelpPage({ me }: { me: Me }) {
  const [help, setHelp] = useState<HelpInfo | null>(null);
  const [tickets, setTickets] = useState<{ mine: TicketRow[]; company: TicketRow[] } | null>(null);
  const load = () => { void api.help().then(setHelp).catch(() => {}); void api.tickets().then(setTickets).catch(() => {}); };
  useEffect(load, []);
  if (!help || !tickets) return <Spinner />;
  const contacts = help.workspaces.filter((w) => w.contact);
  const itOnly = help.workspaces.find((w) => w.contact?.route === "it_only" && !w.canManage);
  return (
    <>
      <PageTitle title="Help" sub="Get help from your company's support or from ours." />
      {contacts.map((w) => <CompanyContact key={w.workspaceId} name={help.workspaces.length > 1 ? w.name : null} c={w.contact!} />)}
      <ContactUs me={me} itOnly={itOnly ? itOnly.contact!.team : null} onSent={load} />
      <Requests title="Your requests" rows={tickets.mine} empty="You haven't asked for help yet." />
      {tickets.company.length > 0 && <Requests title="Requests from your team" rows={tickets.company} empty="" />}
      <Card aria-label="Security" className="flex flex-col gap-1">
        <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><ShieldCheck aria-hidden size={20} /> Found a security problem?</h2>
        <p className="m-0 text-sm text-ink-2">{BRAND.securityEmail ? <>Email <a className="font-semibold text-primary underline" href={`mailto:${BRAND.securityEmail}`}>{BRAND.securityEmail}</a>. Please don't post details anywhere public.</> : <>Send a request below with the topic "Report abuse or a safety problem". A dedicated security address is coming.</>}</p>
      </Card>
    </>
  );
}

function CompanyContact({ name, c }: { name: string | null; c: SupportContact }) {
  const link = "flex min-h-11 items-center gap-2 rounded-xl bg-surface-2 px-3 font-semibold ring-1 ring-line";
  return (
    <Card aria-label="Your company's support" className="flex flex-col gap-2">
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><LifeBuoy aria-hidden size={20} /> {c.team}{name ? ` · ${name}` : ""}</h2>
      {c.note && <p className="m-0 text-sm text-ink-2">{c.note}</p>}
      {c.hours && <p className="m-0 text-sm text-muted">{c.hours}</p>}
      <div className="flex flex-wrap gap-2">
        {c.email && <a className={link} href={`mailto:${c.email}`}><Mail aria-hidden size={16} /> {c.email}</a>}
        {c.phone && <a className={link} href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}><Phone aria-hidden size={16} /> {c.phone}</a>}
        {c.url && <a className={link} href={c.url} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden size={16} /> Help desk ({domain(c.url)})</a>}
      </div>
    </Card>
  );
}

function ContactUs({ me, itOnly, onSent }: { me: Me; itOnly: string | null; onSent: () => void }) {
  const { path, go } = useRouter();
  const preset = new URLSearchParams(path.split("?")[1] ?? "").get("plan") ?? "";
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [topic, setTopic] = useState<TicketTopic>("problem");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [planId, setPlanId] = useState(preset);
  const [share, setShare] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => void api.plans().then((r) => setPlans(r.plans)).catch(() => {}), []);
  const send = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await api.newTicket({ topic, subject, body, ...(planId ? { planId, sharePlan: share } : {}), context: { page: path, browser: navigator.userAgent, version: "web", errors: recentErrors() } });
      onSent();
      go(`/help/requests/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };
  void me;
  return (
    <Card aria-label={`Contact ${BRAND.name} support`} className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-bold">Contact {BRAND.name} support</h2>
      {itOnly && topic !== "safety" && <Notice>Your company asks you to go through {itOnly} first. Your request goes to them, and they'll pass it on to us if needed.</Notice>}
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">What is it about?
          <select value={topic} onChange={(e) => setTopic(e.target.value as TicketTopic)} className={field}>
            {(Object.keys(TOPIC) as TicketTopic[]).map((t) => <option key={t} value={t}>{TOPIC[t]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Subject<input value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">What happened?<textarea rows={5} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} className="rounded-xl border border-line bg-surface p-3 text-base" placeholder="What you did, what you expected, what you saw instead." /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Which plan (optional)
          <select value={planId} onChange={(e) => { setPlanId(e.target.value); if (!e.target.value) setShare(false); }} className={field}>
            <option value="">Not about a plan</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </label>
        {planId && (
          <label className="flex items-start gap-3 text-[15px]">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-1 h-5 w-5" />
            <span>Let support see this plan for 7 days<span className="block text-sm text-muted">Otherwise our team sees only what you write here. You can take access back at any time, and you'll see each time it's opened.</span></span>
          </label>
        )}
        <p className="m-0 text-xs text-muted">We also send the page you're on, your browser and any recent error messages, to help find the problem.</p>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" className="self-start" disabled={busy || !subject.trim() || !body.trim()}><Send aria-hidden size={16} /> Send request</Button>
      </form>
    </Card>
  );
}

function Requests({ title, rows, empty }: { title: string; rows: TicketRow[]; empty: string }) {
  return (
    <Card aria-label={title} className="flex flex-col gap-2">
      <h2 className="m-0 text-lg font-bold">{title}</h2>
      {rows.length === 0 && <p className="m-0 text-sm text-muted">{empty}</p>}
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((t) => (
          <li key={t.id} className="border-t border-line first:border-t-0">
            <Link to={`/help/requests/${t.id}`} className="flex min-h-11 flex-wrap items-center gap-x-3 py-2">
              <span className="font-semibold">{t.subject}</span>
              {t.from && <span className="text-sm text-muted">from {t.from}</span>}
              <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${t.status === "waiting" ? "bg-warn-soft text-warn" : t.status === "solved" ? "bg-good-soft text-good" : "bg-surface-2 text-ink-2"}`}>{STATUS[t.status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** One request: the conversation, plan access, and what each side can do. */
export function RequestPage({ id }: { id: string }) {
  const [t, setT] = useState<TicketThread | null>(null);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [plan, setPlan] = useState<{ title: string; until: number; text: string } | null>(null);
  const load = () => void api.ticket(id).then(setT).catch((e) => setError(e instanceof ApiError ? e.message : "Can't load this request."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);
  const run = async (f: () => Promise<unknown>) => { setError(""); try { await f(); load(); return true; } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); return false; } };
  if (error && !t) return <Notice tone="bad">{error}</Notice>;
  if (!t) return <Spinner />;
  const back = t.as === "staff" ? "/admin/support" : "/help";
  return (
    <>
      <Link to={back} className="text-sm font-semibold text-primary underline">{t.as === "staff" ? "Back to the support inbox" : "Back to Help"}</Link>
      <PageTitle title={t.ticket.subject} sub={`${TOPIC[t.ticket.topic]} · from ${t.ticket.from} · ${STATUS[t.ticket.status]}${t.ticket.via === "it" ? " · with your company's support" : ""}`} />
      {error && <Notice tone="bad">{error}</Notice>}
      <Card aria-label="Conversation" className="flex flex-col gap-3">
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {t.messages.map((m) => (
            <li key={m.id} aria-label={`Message from ${m.fromStaff && t.as === "author" && t.ticket.via === "direct" ? "Support" : m.author}`} className={`flex flex-col gap-1 rounded-xl p-3 ${m.fromStaff ? "bg-primary-soft" : "bg-surface-2"}`}>
              <span className="text-xs text-muted"><strong className="text-ink-2">{m.fromStaff && t.as === "author" && t.ticket.via === "direct" ? `${BRAND.name} support (${m.author})` : m.author}</strong> · {when(m.createdAt)}</span>
              <p className="m-0 text-[15px] break-words whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => api.replyTicket(id, reply)).then((ok) => ok && setReply("")); }}>
          <label className="text-sm font-semibold" htmlFor="reply">Reply</label>
          <textarea id="reply" rows={3} maxLength={5000} value={reply} onChange={(e) => setReply(e.target.value)} className="rounded-xl border border-line bg-surface p-3 text-base" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!reply.trim()}>Send reply</Button>
            {t.ticket.status !== "solved" ? <Button type="button" variant="secondary" onClick={() => void run(() => api.ticketStatus(id, "solved"))}>Mark solved</Button> : <Button type="button" variant="secondary" onClick={() => void run(() => api.ticketStatus(id, "open"))}>Reopen</Button>}
            {t.as === "it" && <Button type="button" variant="secondary" onClick={() => void run(() => api.forwardTicket(id))}>Pass on to {BRAND.name} support</Button>}
          </div>
        </form>
      </Card>
      {t.grants.length > 0 && (
        <Card aria-label="Plan access" className="flex flex-col gap-2">
          <h2 className="m-0 text-lg font-bold">Plan access</h2>
          {t.grants.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center gap-3">
              <span>{g.planTitle ?? "A plan"}: {g.active ? `support can open it until ${when(g.expiresAt)}` : "access ended"}</span>
              {g.active && t.as === "author" && <Button variant="secondary" onClick={() => void run(() => api.revokeGrant(g.id))}>Take back access</Button>}
              {g.active && t.as === "staff" && <Button variant="secondary" onClick={() => void api.supportPlan(id).then(setPlan).catch((e) => setError(e instanceof ApiError ? e.message : "Can't open it."))}>Open the plan (read-only)</Button>}
            </div>
          ))}
          {t.views.length > 0 && <p className="m-0 text-sm text-muted">Opened by support: {t.views.map((v) => `${v.by}, ${when(v.at)}`).join("; ")}</p>}
          {plan && <pre aria-label="Plan (read-only)" className="m-0 max-h-96 overflow-auto rounded-xl bg-surface-2 p-3 text-sm whitespace-pre-wrap">{plan.text}</pre>}
        </Card>
      )}
      {t.ticket.context && (
        <Card aria-label="Technical details" className="flex flex-col gap-1 text-sm">
          <h2 className="m-0 text-base font-bold">Technical details</h2>
          <span>Page: {t.ticket.context.page || "–"}</span>
          <span className="break-all">Browser: {t.ticket.context.browser || "–"}</span>
          <span>Recent errors: {t.ticket.context.errors.length ? t.ticket.context.errors.join(" | ") : "none"}</span>
        </Card>
      )}
    </>
  );
}

/** Our team's inbox (PLATFORM_ADMINS only; checked on the server). */
export function SupportInbox({ onCount }: { onCount: (n: number) => void }) {
  const [data, setData] = useState<{ open: number; items: (TicketRow & { email: string })[] } | null>(null);
  const [error, setError] = useState("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void api.supportInbox().then((d) => { setData(d); onCount(d.open); }).catch((e) => setError(e instanceof ApiError && e.status === 404 ? "This page is only for the support team." : "Can't load the inbox.")), []);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Spinner />;
  return (
    <>
      <PageTitle title="Support inbox" sub={`${data.open} open. Plans are visible only when the person gave access on that request.`} />
      <Card className="flex flex-col gap-1">
        {data.items.length === 0 && <p className="m-0 text-sm text-muted">No requests yet.</p>}
        <ul className="m-0 flex list-none flex-col p-0">
          {data.items.map((t) => (
            <li key={t.id} className="border-t border-line first:border-t-0">
              <Link to={`/help/requests/${t.id}`} className="flex min-h-11 flex-wrap items-center gap-x-3 py-2">
                <span className="font-semibold">{t.subject}</span>
                <span className="text-sm text-muted">{TOPIC[t.topic]} · {t.from} · {t.email}</span>
                <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold">{STATUS[t.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/** Settings card for managers: who employees contact, and how requests to us are routed. */
export function CompanySupportCard({ me }: { me: Me }) {
  const managed = me.workspaces.filter((w) => w.role === "manager");
  const [help, setHelp] = useState<HelpInfo | null>(null);
  useEffect(() => void api.help().then(setHelp).catch(() => {}), []);
  if (!managed.length || !help) return null;
  return <>{managed.map((w) => <ContactForm key={w.id} ws={w.id} name={managed.length > 1 ? w.name : null} current={help.workspaces.find((x) => x.workspaceId === w.id)?.contact ?? null} />)}</>;
}

function ContactForm({ ws, name, current }: { ws: string; name: string | null; current: SupportContact | null }) {
  const [c, setC] = useState({ team: current?.team ?? "", email: current?.email ?? "", phone: current?.phone ?? "", url: current?.url ?? "", hours: current?.hours ?? "", note: current?.note ?? "", route: current?.route ?? ("direct" as const) });
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const set = (k: keyof typeof c) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value });
  const save = async () => {
    try { await api.setSupportContact(ws, c); setMsg({ tone: "good", text: "Saved. People on your plans see it under Help." }); } catch (e) { setMsg({ tone: "bad", text: e instanceof ApiError ? e.message : "That didn't save." }); }
  };
  return (
    <Card aria-label="Company support contact" className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-bold">Company support contact{name ? ` · ${name}` : ""}</h2>
      <p className="m-0 text-sm text-ink-2">Who people should contact for sign-in, access and other company questions. Shown under Help.</p>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Team name<input value={c.team} onChange={set("team")} className={field} placeholder="IT help desk" /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Email<input type="email" value={c.email} onChange={set("email")} className={field} /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Phone<input type="tel" value={c.phone} onChange={set("phone")} className={field} /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Help-desk link<input type="url" value={c.url} onChange={set("url")} className={field} placeholder="https://" /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Hours<input value={c.hours} onChange={set("hours")} className={field} placeholder="Mon to Fri, 8 to 6" /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Note<input value={c.note} onChange={set("note")} className={field} placeholder="For sign-in and access problems" /></label>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0 sm:col-span-2">
          <legend className="mb-1 p-0 text-sm font-semibold">Requests to {BRAND.name} support</legend>
          <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="radio" name={`route-${ws}`} checked={c.route === "direct"} onChange={() => setC({ ...c, route: "direct" })} className="h-5 w-5" /> People contact {BRAND.name} support directly</label>
          <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="radio" name={`route-${ws}`} checked={c.route === "it_only"} onChange={() => setC({ ...c, route: "it_only" })} className="h-5 w-5" /> Through our team only (requests come to you first; safety reports still reach us directly)</label>
        </fieldset>
        {msg && <div className="sm:col-span-2"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        <Button type="submit" className="self-start">Save contact</Button>
      </form>
    </Card>
  );
}
