/** Reminders and digests (step N2): how often you hear about your work, and plans you follow. */
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button, Card, Notice } from "../ui/kit";

export interface DigestPref { mode: "daily" | "weekly" | "off"; hour: number; tz: string; weekday: number }
export const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hourLabel = (h: number) => new Date(Date.UTC(2027, 0, 4, h)).toLocaleTimeString([], { hour: "numeric", timeZone: "UTC" });
const field = "min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal";

/** Makes sure digests use this person's time zone (saved once, the first time the app opens). */
export async function rememberZone(): Promise<void> {
  try {
    const r = await api.getPref("digest");
    if (r.value === null) await api.setPref("digest", { mode: "daily", hour: 8, weekday: 1, tz: browserZone() });
  } catch { /* offline or not signed in: try next time */ }
}

export function RemindersCard() {
  const [pref, setPref] = useState<DigestPref | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api.getPref("digest").then((r) => setPref({ mode: "daily", hour: 8, weekday: 1, tz: browserZone(), ...((r.value as Partial<DigestPref> | null) ?? {}) })).catch((e: Error) => setError(e.message));
  }, []);
  if (!pref) return null;
  const zones = (() => { try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [pref.tz]; } catch { return [pref.tz]; } })();
  const set = (p: Partial<DigestPref>) => { setPref({ ...pref, ...p }); setSaved(false); };
  return (
    <Card aria-label="Reminders and digests" className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-bold">Reminders and digests</h2>
      <p className="m-0 text-[15px] text-ink-2">A short summary of what's due today, what's overdue, what starts soon, milestones this week, and anything waiting for your approval. Only sent when there's something to tell you. It shows here in the app, and comes by email once email sending is set up.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">How often
          <select aria-label="How often" value={pref.mode} onChange={(e) => set({ mode: e.target.value as DigestPref["mode"] })} className={field}><option value="daily">Every day</option><option value="weekly">Once a week</option><option value="off">Never</option></select>
        </label>
        {pref.mode === "weekly" && <label className="flex flex-col gap-1.5 text-sm font-semibold">On<select aria-label="On" value={pref.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })} className={field}>{DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></label>}
        {pref.mode !== "off" && <label className="flex flex-col gap-1.5 text-sm font-semibold">At<select aria-label="At" value={pref.hour} onChange={(e) => set({ hour: Number(e.target.value) })} className={field}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select></label>}
        {pref.mode !== "off" && <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">Time zone<select aria-label="Time zone" value={pref.tz} onChange={(e) => set({ tz: e.target.value })} className={`${field} max-w-[16rem]`}>{[...new Set([pref.tz, ...zones])].map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</select></label>}
        <Button onClick={() => api.setPref("digest", pref).then(() => setSaved(true)).catch((e: Error) => setError(e.message))}>Save</Button>
      </div>
      {saved && <Notice tone="good">Saved.</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
    </Card>
  );
}

/** On a plan's Status report page: a summary of this plan every Monday. */
export function FollowSwitch({ planId }: { planId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { api.follow(planId).then((r) => setOn(r.following)).catch(() => {}); }, [planId]);
  if (on === null) return null;
  return (
    <label className="flex min-h-11 items-center gap-3 text-[15px]">
      <input type="checkbox" className="h-5 w-5" checked={on} onChange={(e) => { const v = e.target.checked; setOn(v); void api.setFollow(planId, v).catch(() => setOn(!v)); }} />
      Send me a summary of this plan every Monday
    </label>
  );
}
