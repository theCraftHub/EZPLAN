/** The workspace's standard week ("Full time"), with a preview of every plan's new finish date. */
import { useState } from "react";
import { HOLIDAY_COUNTRIES } from "@rakuplan/shared";
import { Minus, Plus } from "lucide-react";
import type { WorkWeek as Week } from "@rakuplan/shared";
import { api, type Me } from "../lib/api";
import { shortDate } from "../lib/format";
import { Button, Card, Notice } from "../ui/kit";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Impact = Awaited<ReturnType<typeof api.workWeek>>["impact"];

export function WorkWeekCard({ me, onSaved }: { me: Me; onSaved: (w: Week) => void }) {
  const ws = me.workspaces[0];
  const [hours, setHours] = useState(ws?.work_week.hoursPerWeek ?? 40);
  const [days, setDays] = useState<number[]>(ws?.work_week.workdays ?? [1, 2, 3, 4, 5]);
  const [country, setCountry] = useState(ws?.work_week.holidayCountry ?? "");
  const [draft, setDraft] = useState(String(hours));
  const [impact, setImpact] = useState<Impact | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ws) return null;
  const manager = ws.role === "manager";
  const n = Number(draft);
  const valid = draft.trim() !== "" && n >= 1 && n <= 60 && Math.round(n * 2) === n * 2 && days.length > 0;
  const changed = n !== ws.work_week.hoursPerWeek || JSON.stringify(days) !== JSON.stringify(ws.work_week.workdays) || country !== (ws.work_week.holidayCountry ?? "");
  const setH = (v: number) => { setHours(v); setDraft(String(v)); setImpact(null); };
  const run = async (dryRun: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.workWeek(ws.id, { hoursPerWeek: n, workdays: days, holidayCountry: (country || null) as unknown as string }, dryRun);
      if (dryRun) setImpact(r.impact);
      else {
        setImpact(null);
        setMsg({ tone: "good", text: "Saved. Every plan in this workspace now uses this week." });
        onSaved(r.workWeek);
      }
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "That didn't work." });
    } finally {
      setBusy(false);
    }
  };
  const chip = (on: boolean) => `min-h-11 rounded-xl border px-3 text-sm font-semibold ${on ? "border-ink bg-ink text-ground" : "border-line bg-surface"}`;
  return (
    <Card aria-label="Standard work week" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-lg font-bold">Standard work week</h2>
        <p className="m-0 text-sm text-ink-2">What "Full time" means in {ws.name}: people with no hours set count as this, and a "1d" estimate is one of these days.</p>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <fieldset disabled={!manager} className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-sm font-semibold">Hours a week</legend>
        <div className="flex flex-wrap items-center gap-2">
          {[40, 37.5, 35].map((v) => <button key={v} type="button" aria-pressed={n === v} onClick={() => setH(v)} className={chip(n === v)}>{v} h</button>)}
          <span className="flex items-center gap-1">
            <button type="button" aria-label="Half an hour less" onClick={() => setH(Math.max(1, (valid ? n : hours) - 0.5))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line"><Minus aria-hidden size={18} /></button>
            <label className="sr-only" htmlFor="ww-hours">Hours a week (1 to 60, half hours allowed)</label>
            <input id="ww-hours" inputMode="decimal" value={draft} onChange={(e) => { setDraft(e.target.value); setImpact(null); }} className="h-11 w-20 rounded-xl border border-line bg-surface text-center font-semibold" aria-invalid={!valid} />
            <button type="button" aria-label="Half an hour more" onClick={() => setH(Math.min(60, (valid ? n : hours) + 0.5))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line"><Plus aria-hidden size={18} /></button>
          </span>
        </div>
        <span className={`text-sm ${valid ? "text-muted" : "font-semibold text-bad"}`}>{valid ? `${Math.round((n / days.length) * 100) / 100} h a day over ${days.length} days` : "Use 1 to 60 hours (whole or half) and at least one working day."}</span>
      </fieldset>
      <fieldset disabled={!manager} className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-sm font-semibold">Working days</legend>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => { setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort()); setImpact(null); }} className={`${chip(days.includes(d))} min-w-12`}>{DAY_NAMES[d]}</button>)}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Public holidays (days off for everyone)
        <select aria-label="Public holidays" value={country} disabled={!manager} onChange={(e) => { setCountry(e.target.value); setImpact(null); }} className="min-h-11 max-w-sm rounded-xl border border-line bg-surface px-3 text-base font-normal">
          <option value="">None</option>
          {Object.entries(HOLIDAY_COUNTRIES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        <span className="font-normal text-muted">National holidays only. Add regional ones as days off for people.</span>
      </label>
      {!manager && <p className="m-0 text-sm text-muted">Only workspace managers can change this.</p>}
      {impact && (
        <div className="flex flex-col gap-2 rounded-xl bg-warn-soft p-3 text-warn">
          <span className="text-sm font-bold">Before you save: {impact.filter((i) => i.before !== i.after).length} of {impact.length} plans change their finish date</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {impact.map((i) => <li key={i.planId}>{i.title}: {i.before === i.after ? `stays ${shortDate(i.before)}` : `${shortDate(i.before)} → ${shortDate(i.after)}`}</li>)}
          </ul>
        </div>
      )}
      {manager && (
        <div className="flex flex-wrap gap-2">
          {!impact ? <Button onClick={() => void run(true)} disabled={!valid || !changed || busy}>Preview changes</Button> : <Button onClick={() => void run(false)} disabled={busy}>Save</Button>}
          {impact && <Button variant="secondary" onClick={() => setImpact(null)}>Cancel</Button>}
        </div>
      )}
    </Card>
  );
}
