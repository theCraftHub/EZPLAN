/**
 * "Hours a week for this project": quick picks always show the weekly total, "Full time" follows
 * the workspace's standard week, and Custom takes any whole number from 1 to 60.
 */
import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";

export function HoursPicker({ value, fullTime, workdays = 5, onChange, label }: { value: number | undefined; fullTime: number; workdays?: number; onChange: (hours: number) => void; label: string }) {
  const presets = [5, 20, 30].filter((h) => h < fullTime);
  const current = value ?? fullTime;
  const isPreset = current === fullTime || presets.includes(current);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState(String(current));
  const id = useId();
  const n = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 60;
  const pick = (h: number) => {
    setCustom(false);
    setDraft(String(h));
    onChange(h);
  };
  const set = (text: string) => {
    setDraft(text);
    const v = Number(text);
    if (text.trim() !== "" && Number.isInteger(v) && v >= 1 && v <= 60) onChange(v);
  };
  const chip = (on: boolean) => `min-h-11 rounded-xl border px-3 text-sm font-semibold ${on ? "border-ink bg-ink text-ground" : "border-line bg-surface text-ink hover:bg-surface-2"}`;
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {presets.map((h) => (
          <button key={h} type="button" role="radio" aria-checked={!custom && current === h} onClick={() => pick(h)} className={chip(!custom && current === h)}>
            {h} h/week
          </button>
        ))}
        <button type="button" role="radio" aria-checked={!custom && current === fullTime} onClick={() => pick(fullTime)} className={chip(!custom && current === fullTime)}>
          Full time · {fullTime} h/week
        </button>
        <button type="button" role="radio" aria-checked={custom} onClick={() => setCustom(true)} className={chip(custom)}>
          Custom
        </button>
      </div>
      {custom && (
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-sm text-ink-2">Hours a week (1 to 60)</label>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="One hour less" onClick={() => set(String(Math.max(1, (valid ? n : current) - 1)))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface"><Minus aria-hidden size={18} /></button>
            <input id={id} inputMode="numeric" value={draft} onChange={(e) => set(e.target.value)} aria-invalid={!valid} aria-describedby={`${id}-hint`} className="h-11 w-20 rounded-xl border border-line bg-surface text-center text-base font-semibold tabular-nums" />
            <button type="button" aria-label="One hour more" onClick={() => set(String(Math.min(60, (valid ? n : current) + 1)))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface"><Plus aria-hidden size={18} /></button>
          </div>
          <span id={`${id}-hint`} className={`text-sm ${valid ? "text-muted" : "font-semibold text-bad"}`}>
            {valid ? `About ${Math.round((n / workdays) * 10) / 10} h a day over ${workdays} days` : "Enter 1 to 60 hours a week"}
          </span>
        </div>
      )}
    </fieldset>
  );
}
