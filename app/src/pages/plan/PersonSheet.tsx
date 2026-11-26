/** One person's availability for this plan: hours a week, working days, days off. */
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { PersonAvailability, WorkWeek } from "@rakuplan/shared";
import { api } from "../../lib/api";
import { longDate } from "../../lib/format";
import { HoursPicker } from "../../ui/HoursPicker";
import { Button, Notice } from "../../ui/kit";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function PersonSheet({ planId, name, initial, workWeek, isNew, title, onSaved, onClose }: { planId: string; name: string; initial: PersonAvailability | undefined; workWeek: WorkWeek; isNew?: boolean; title?: string; onSaved: (name: string, a: PersonAvailability) => void; onClose: () => void }) {
  const [who, setWho] = useState(name);
  const [hours, setHours] = useState(initial?.hoursPerWeek ?? workWeek.hoursPerWeek);
  const [days, setDays] = useState<number[]>(initial?.workdays ?? workWeek.workdays);
  const [off, setOff] = useState(initial?.timeOff ?? []);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (d: number) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort());
  const save = async () => {
    const n = who.trim();
    if (!n) return setError("Enter a name.");
    if (!days.length) return setError("Pick at least one working day.");
    const a: PersonAvailability = { hoursPerWeek: hours, ...(JSON.stringify(days) !== JSON.stringify(workWeek.workdays) ? { workdays: days } : {}), ...(off.length ? { timeOff: off } : {}) };
    setBusy(true);
    try {
      await api.setPerson(planId, n, a);
      onSaved(n, a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/40" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-40 flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-xl lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-[460px] lg:rounded-none">
          <div className="flex items-start gap-3">
            <Dialog.Title className="m-0 flex-1 text-xl font-bold">{title ?? (isNew ? "Add a person to this plan" : `${name}'s availability`)}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line"><X aria-hidden size={18} /></Dialog.Close>
          </div>
          <Dialog.Description className="m-0 text-sm text-ink-2">{isNew ? "They appear in the schedule at once, and you can give them tasks. Inviting them to sign in comes with team accounts." : "Dates across the plan update as soon as you save."}</Dialog.Description>
          {error && <Notice tone="bad">{error}</Notice>}
          {isNew && <label className="flex flex-col gap-1.5 text-sm font-semibold">Name<input autoFocus value={who} onChange={(e) => setWho(e.target.value)} placeholder="e.g. Sam" className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal" /></label>}
          <HoursPicker label="Hours a week for this project" value={hours} fullTime={workWeek.hoursPerWeek} workdays={days.length || 5} onChange={setHours} />
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-semibold">Working days</legend>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggle(d)} className={`min-h-11 min-w-12 rounded-xl border px-2 text-sm font-semibold ${days.includes(d) ? "border-ink bg-ink text-ground" : "border-line bg-surface"}`}>{DAY_NAMES[d]}</button>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Days off</span>
            {off.length === 0 && <span className="text-sm text-muted">None planned.</span>}
            {off.map((o, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                <span>{longDate(o.start)}{o.end !== o.start ? ` to ${longDate(o.end)}` : ""}{o.label ? ` · ${o.label}` : ""}</span>
                <button onClick={() => setOff(off.filter((_, j) => j !== i))} className="min-h-10 px-2 font-semibold text-primary-ink">Remove</button>
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">First day off<input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (!end) setEnd(e.target.value); }} className="min-h-11 rounded-xl border border-line bg-surface px-2" /></label>
              <label className="flex flex-col gap-1 text-sm">Last day off<input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-2" /></label>
              <Button variant="secondary" disabled={!start || !end || end < start} onClick={() => { setOff([...off, { start, end }]); setStart(""); setEnd(""); }}>Add days off</Button>
            </div>
          </div>
          <div className="mt-auto flex gap-2 border-t border-line pt-4">
            <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : isNew ? "Add to plan" : "Save"}</Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
