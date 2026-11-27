/** Read-only share links (step N1): anyone with the link sees the plan without signing in. */
import { useEffect, useState } from "react";
import { Check, ClipboardCopy, Link2 } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { plural } from "../../lib/format";
import { Button, Card, Notice } from "../../ui/kit";

const when = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function ShareLinks({ planId }: { planId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.shares>> | null>(null);
  const [days, setDays] = useState<string>("30");
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const load = () => api.shares(planId).then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps
  const make = () => { setError(""); api.makeShare(planId, days === "none" ? null : Number(days)).then((r) => { setMade(r.url); setCopied(false); return load(); }).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't make the link.")); };
  return (
    <Card aria-label="Share links" className="flex flex-col gap-3">
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><Link2 aria-hidden size={20} /> Share a read-only link</h2>
      <p className="m-0 text-[15px] text-ink-2">Anyone with the link sees the plan's overview, checklist and timeline, kept up to date, without signing in. They can't change anything or see comments or email addresses. Turn a link off any time.</p>
      {data && !data.canShare && <Notice tone="warn">{data.reason}</Notice>}
      {data?.canShare && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Works for
            <select value={days} onChange={(e) => setDays(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal">
              <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="none">Until I turn it off</option>
            </select>
          </label>
          <Button onClick={make}>Make a link</Button>
        </div>
      )}
      {made && (
        <div className="flex flex-col gap-2 rounded-xl bg-primary-soft p-3">
          <span className="text-sm font-semibold text-primary-ink">Copy it now: for safety, the full link is shown only once.</span>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-2 py-1.5 text-sm">{made}</code>
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(made).then(() => setCopied(true)).catch(() => {})}>{copied ? <><Check aria-hidden size={18} /> Copied</> : <><ClipboardCopy aria-hidden size={18} /> Copy link</>}</Button>
          </div>
        </div>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      {data && data.links.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Links that work now">
          {data.links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">Made by {l.by} on {when(l.createdAt)} · {l.expiresAt ? `works until ${when(l.expiresAt)}` : "no end date"} · {l.lastOpenedAt ? `opened ${plural(l.opens, "time")}, last ${when(l.lastOpenedAt)}` : "not opened yet"}</span>
              {data.canShare !== undefined && <Button variant="secondary" onClick={() => api.revokeShare(planId, l.id).then(load).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't turn it off."))}>Turn off</Button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
