/** The safety review queue for the owner's team (PLATFORM_ADMINS; checked on the server). */
import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { api, ApiError, type SafetyItem } from "../lib/api";
import { Link } from "../lib/router";
import { Button, Card, Notice, PageTitle, Spinner } from "../ui/kit";

const FEATURE: Record<string, string> = { check: "AI Plan Check", report: "Status report", moderation: "Screening a new plan" };
const OUTCOME: Record<string, string> = { released: "Released", kept: "Kept held", suspended: "Account suspended" };
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function SafetyPage({ onCount }: { onCount: (n: number) => void }) {
  const [data, setData] = useState<{ open: number; items: SafetyItem[] } | null>(null);
  const [error, setError] = useState("");
  const load = () => api.safety().then((d) => { setData(d); onCount(d.open); }).catch((e) => setError(e instanceof ApiError && e.status === 404 ? "This page is only for the review team." : "Can't load the queue right now."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), []);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Spinner />;
  const open = data.items.filter((i) => i.status === "held");
  const done = data.items.filter((i) => i.status !== "held");
  return (
    <>
      <PageTitle title="Safety review" sub="Plans held because the AI declined them twice, or because screening flagged them. Only the flagged part is shown." />
      {open.length === 0 && <Notice tone="good">Nothing waiting for review.</Notice>}
      {open.map((i) => <Held key={i.id} item={i} onDone={() => void load()} />)}
      {done.length > 0 && (
        <Card aria-label="Decided" className="flex flex-col gap-2">
          <h2 className="m-0 text-lg font-bold">Decided</h2>
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0 text-sm">
            {done.map((i) => (
              <li key={i.id} className="flex flex-col gap-0.5 py-2">
                <span><strong>{OUTCOME[i.status]}</strong>: {i.planTitle ?? "A new plan"} ({i.person}) by {i.decidedBy}{i.decidedAt ? `, ${when(i.decidedAt)}` : ""}</span>
                {i.note && <span className="text-muted">Note: {i.note}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function Held({ item, onDone }: { item: SafetyItem; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const act = async (action: "release" | "keep" | "suspend") => {
    setError("");
    try { await api.safetyAction(item.id, action, note); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work. Try again."); }
  };
  return (
    <Card aria-label={`Held: ${item.planTitle ?? "new plan"}`} className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <ShieldAlert aria-hidden className="mt-1 shrink-0 text-warn" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 text-lg font-bold">{item.planTitle ?? "A new plan (not saved)"}</h2>
          <span className="text-sm text-ink-2">{item.person} · {item.email} · {FEATURE[item.feature] ?? item.feature}{item.category ? ` · ${item.category}` : ""} · {when(item.createdAt)}</span>
          {item.planId && <span className="text-xs text-muted">Plan id {item.planId} (the plan itself stays private; only this excerpt is shown)</span>}
        </div>
      </div>
      <pre className="m-0 max-h-60 overflow-auto rounded-xl bg-surface-2 p-3 text-sm whitespace-pre-wrap">{item.excerpt}</pre>
      <label className="flex flex-col gap-1 text-sm">Note for the people on the plan (needed to keep it held)
        <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="rounded-xl border border-line bg-surface p-2" />
      </label>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void act("release")}>Release</Button>
        <Button variant="secondary" disabled={!note.trim()} onClick={() => void act("keep")}>Keep held</Button>
        {!confirm ? <Button variant="danger" onClick={() => setConfirm(true)}>Suspend the account</Button> : (
          <span className="flex flex-wrap items-center gap-2 text-sm">Sign {item.person} out everywhere and block sign-in?
            <Button variant="danger" onClick={() => void act("suspend")}>Yes, suspend</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </span>
        )}
      </div>
    </Card>
  );
}

/** Links to admin pages, for Settings (phones have no side panel). */
export function AdminLinks({ manages, platformAdmin, safetyOpen }: { manages: { id: string; name: string }[]; platformAdmin: boolean; safetyOpen: number }) {
  if (!manages.length && !platformAdmin) return null;
  return (
    <Card aria-label="Admin" className="flex flex-col gap-2">
      <h2 className="m-0 text-lg font-bold">Admin</h2>
      {manages.map((w) => (
        <div key={w.id} className="flex flex-wrap gap-x-4 gap-y-1">
          <Link to={`/admin/ai/${w.id}`} className="flex min-h-11 items-center font-semibold text-primary underline">AI credits{manages.length > 1 ? ` (${w.name})` : ""}</Link>
          <Link to={`/admin/ai/${w.id}/spending`} className="flex min-h-11 items-center font-semibold text-primary underline">AI spending{manages.length > 1 ? ` (${w.name})` : ""}</Link>
        </div>
      ))}
      {platformAdmin && <Link to="/admin/safety" className="flex min-h-11 items-center font-semibold text-primary underline">Safety review{safetyOpen ? ` (${safetyOpen} waiting)` : ""}</Link>}
    </Card>
  );
}
