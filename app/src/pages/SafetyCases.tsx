/**
 * Safety follow-ups between our safety team and a company's managers: the list (in Help, and in
 * Safety review for our team) and one case's conversation. Each message is also emailed, and an
 * emailed reply lands here. A case never shows who reported or what they wrote.
 */
import { useEffect, useState } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { api, ApiError, type SafetyCase, type SafetyCaseRow } from "../lib/api";
import { Link } from "../lib/router";
import { Button, Card, Notice, PageTitle, Spinner } from "../ui/kit";

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const STATUS = { open: "Open", closed: "Closed" } as const;
const chip = (s: "open" | "closed") => `rounded-full px-2 py-0.5 text-xs font-bold ${s === "open" ? "bg-warn-soft text-warn" : "bg-good-soft text-good"}`;

/** The cases this person can open; renders nothing when there are none. */
export function SafetyCaseList({ title = "Safety follow-ups" }: { title?: string }) {
  const [rows, setRows] = useState<SafetyCaseRow[] | null>(null);
  useEffect(() => void api.safetyCases().then((r) => setRows(r.items)).catch(() => setRows([])), []);
  if (!rows || rows.length === 0) return null;
  return (
    <Card aria-label={title} className="flex flex-col gap-2">
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><ShieldCheck aria-hidden size={20} /> {title}</h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r) => (
          <li key={r.id} className="border-t border-line first:border-t-0">
            <Link to={`/help/cases/${r.id}`} className="flex min-h-11 flex-wrap items-center gap-x-3 py-2">
              <span className="font-semibold">Safety case for {r.workspace}</span>
              <span className="text-sm text-muted">{r.lastFrom ? `last from ${r.lastFrom} · ` : ""}{when(r.updatedAt)}</span>
              <span className={`ml-auto ${chip(r.status)}`}>{STATUS[r.status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SafetyCasePage({ id }: { id: string }) {
  const [c, setC] = useState<SafetyCase | null>(null);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const load = () => void api.safetyCase(id).then(setC).catch((e) => setError(e instanceof ApiError ? e.message : "Can't load this case."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);
  const run = async (f: () => Promise<unknown>) => { setError(""); try { await f(); load(); return true; } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); return false; } };
  if (error && !c) return <Notice tone="bad">{error}</Notice>;
  if (!c) return <Spinner />;
  const staff = c.as === "staff";
  return (
    <>
      <Link to={staff ? "/admin/safety" : "/help"} className="text-sm font-semibold text-primary underline">{staff ? "Back to safety review" : "Back to Help"}</Link>
      <PageTitle title={`Safety case for ${c.case.workspace}`} sub={`Opened ${when(c.case.createdAt)} · ${STATUS[c.case.status]}`} />
      <Notice>
        {staff
          ? <>The company sees "safety team" for your messages and never sees the report. {c.case.reportId && <Link to={`/help/requests/${c.case.reportId}`} className="font-semibold underline">Open the original report</Link>}</>
          : <>This conversation is between your workspace's managers and our safety team. It doesn't say who reported anything or what they wrote. You can also reply to the emails we send.</>}
      </Notice>
      {error && <Notice tone="bad">{error}</Notice>}
      <Card aria-label="Conversation" className="flex flex-col gap-3">
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {c.messages.map((m) => (
            <li key={m.id} aria-label={`Message from ${m.author}`} className={`flex flex-col gap-1 rounded-xl p-3 ${m.fromStaff ? "bg-primary-soft" : "bg-surface-2"}`}>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <strong className="text-ink-2">{m.author}</strong> · {when(m.createdAt)}
                {m.via === "email" && <span className="inline-flex items-center gap-1"><Mail aria-hidden size={12} /> by email</span>}
              </span>
              <p className="m-0 text-[15px] break-words whitespace-pre-wrap">{m.body}</p>
              {staff && m.emails && m.emails.length > 0 && (
                <span className="text-xs text-muted">Emailed to {m.emails.map((e) => e.to).join(", ")}{m.emails.every((e) => e.status === "off") ? " (not sent: email is off on this server, kept in the outbox)" : m.emails.some((e) => e.status === "failed") ? " (some failed to send)" : ""}</span>
              )}
            </li>
          ))}
        </ul>
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => api.replySafetyCase(id, reply)).then((ok) => ok && setReply("")); }}>
          <label className="text-sm font-semibold" htmlFor="case-reply">{staff ? "Write to the company's managers" : "Reply to our safety team"}</label>
          <textarea id="case-reply" rows={3} maxLength={5000} value={reply} onChange={(e) => setReply(e.target.value)} className="rounded-xl border border-line bg-surface p-3 text-base" />
          <span className="text-sm text-muted">{staff ? "They get it in the app and by email." : "Our safety team gets it in the app and by email."}</span>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!reply.trim()}>Send</Button>
            {staff && (c.case.status === "open"
              ? <Button type="button" variant="secondary" onClick={() => void run(() => api.safetyCaseStatus(id, "closed"))}>Close the case</Button>
              : <Button type="button" variant="secondary" onClick={() => void run(() => api.safetyCaseStatus(id, "open"))}>Reopen</Button>)}
          </div>
        </form>
      </Card>
    </>
  );
}
