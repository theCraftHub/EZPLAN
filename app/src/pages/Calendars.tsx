/** Calendars (step N3): your tasks in your own calendar, and your calendar's busy times in your plans. */
import { useEffect, useState } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { shortDate } from "../lib/format";
import { Button, Card, Notice } from "../ui/kit";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That didn't work. Try again.");
const field = "min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-base font-normal";

export function CalendarsCard() {
  const [feed, setFeed] = useState<{ active: boolean; createdAt: number | null } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<Awaited<ReturnType<typeof api.calendarBusy>> | null>(null);
  const [address, setAddress] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const load = () => Promise.all([api.calendarFeed().then(setFeed), api.calendarBusy().then(setBusy)]).catch((e) => setError(msg(e)));
  useEffect(() => { void load(); }, []);
  if (!feed || !busy) return null;
  return (
    <Card aria-label="Calendars" className="flex flex-col gap-4">
      <h2 className="m-0 text-lg font-bold">Calendars</h2>

      <section aria-label="Your tasks in your calendar" className="flex flex-col gap-2">
        <h3 className="m-0 text-[15px] font-bold">Your tasks in your calendar</h3>
        <p className="m-0 text-sm text-ink-2">A private link with your tasks and every milestone of your plans. In Google Calendar choose "Other calendars, From URL"; in Outlook "Add calendar, Subscribe from web"; on Apple "File, New Calendar Subscription". It updates by itself. Anyone with the link can see it, so keep it to yourself.</p>
        {url ? (
          <div className="flex flex-col gap-2 rounded-xl bg-primary-soft p-3">
            <span className="text-sm font-semibold text-primary-ink">Copy it now: for safety, the link is shown only once.</span>
            <div className="flex flex-wrap items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-2 py-1.5 text-sm">{url}</code><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => {})}>{copied ? <><Check aria-hidden size={18} /> Copied</> : <><ClipboardCopy aria-hidden size={18} /> Copy link</>}</Button></div>
          </div>
        ) : feed.active && <p className="m-0 text-sm">Your calendar link is on (made {shortDate(new Date(feed.createdAt!).toISOString().slice(0, 10))}).</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant={feed.active ? "secondary" : "primary"} onClick={() => api.makeCalendarFeed().then((r) => { setUrl(r.url); setCopied(false); return load(); }).catch((e) => setError(msg(e)))}>{feed.active ? "Make a new link (the old one stops)" : "Make my calendar link"}</Button>
          {feed.active && <Button variant="ghost" onClick={() => api.stopCalendarFeed().then(() => { setUrl(null); return load(); }).catch((e) => setError(msg(e)))}>Turn off</Button>}
        </div>
      </section>

      <section aria-label="Busy times from your calendar" className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="m-0 text-[15px] font-bold">Busy times from your calendar</h3>
        <p className="m-0 text-sm text-ink-2">Paste your calendar's private address (iCal or .ics) from Google Calendar, Outlook, Apple iCloud, Proton, Fastmail or Zoho. Only how many hours you're busy each day is kept, never what the events are. Your plans then schedule your work around them. Refreshed every 6 hours.</p>
        {busy.connected ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-sm">Connected to <strong>{busy.host}</strong>{busy.syncedAt ? `, last read ${new Date(busy.syncedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}.</p>
            {busy.error && <Notice tone="warn">{busy.error}</Notice>}
            {busy.next && busy.next.length > 0 ? <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Busy in the next two weeks">{busy.next.map((b) => <li key={b.date} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold ring-1 ring-line">{shortDate(b.date)}: {b.hours >= 24 ? "all day" : `${b.hours} h`}</li>)}</ul> : <p className="m-0 text-sm text-muted">Nothing busy in the next two weeks.</p>}
            <Button variant="ghost" className="self-start" onClick={() => api.disconnectCalendar().then(load).catch((e) => setError(msg(e)))}>Disconnect</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5 text-sm font-semibold">Private calendar address<input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" className={field} /></label>
            <Button disabled={!address.trim() || working} onClick={() => { setWorking(true); setError(""); api.connectCalendar(address.trim()).then(() => { setAddress(""); return load(); }).catch((e) => setError(msg(e))).finally(() => setWorking(false)); }}>{working ? "Reading…" : "Connect"}</Button>
          </div>
        )}
      </section>
      {error && <Notice tone="bad">{error}</Notice>}
    </Card>
  );
}
