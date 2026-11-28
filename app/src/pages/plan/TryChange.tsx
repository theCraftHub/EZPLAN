/** "Try a change" on one plan (step N5d): see what a change would do to the dates; make it if you like. */
import { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { allTasks, tryWhatIf, withWhatIf, type Op, type PersonAvailability, type Plan, type WhatIf, type WorkWeek } from "@rakuplan/shared";
import { api, ApiError } from "../../lib/api";
import { plural, shortDate } from "../../lib/format";
import { Button, Card, Notice } from "../../ui/kit";

type Kind = "" | WhatIf["kind"];
const field = "min-h-11 min-w-0 rounded-xl border border-line bg-surface px-3 text-base font-normal";

export function TryChange({ plan, planId, people, workWeek, today, canEdit, edit }: { plan: Plan; planId: string; people: Record<string, PersonAvailability>; workWeek: WorkWeek; today: string; canEdit: boolean; edit: (op: Op) => void }) {
  const [kind, setKind] = useState<Kind>("");
  const [taskId, setTaskId] = useState("");
  const [person, setPerson] = useState("");
  const [days, setDays] = useState(3);
  const [hours, setHours] = useState(20);
  const [from, setFrom] = useState(today);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const open = allTasks(plan).filter((t) => !t.milestone && t.status !== "done" && t.status !== "skipped");
  const names = [...new Set([...open.map((t) => t.owner).filter((x): x is string => !!x), ...Object.keys(people)])].sort();
  const w: WhatIf | null = kind === "longer" && taskId ? { kind, taskId, days } : kind === "hours" && person ? { kind, person, hours } : kind === "away" && person && from ? { kind, person, from, days } : null;
  const opts = useMemo(() => ({ workWeek, today, people }), [workWeek, today, people]);
  const r = useMemo(() => (w ? tryWhatIf(plan, opts, w) : null), [plan, opts, JSON.stringify(w)]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    if (!w || !r) return;
    setError("");
    try {
      const changed = withWhatIf(plan, opts, w);
      if (w.kind === "longer") edit({ kind: "setField", taskId: w.taskId, field: "estimate", value: allTasks(changed.plan).find((t) => t.id === w.taskId)!.estimate! });
      else {
        const key = Object.keys(changed.people).find((k) => changed.people[k] !== people[k]) ?? w.person;
        await api.setPerson(planId, key, changed.people[key]!);
      }
      setDone(`Done: ${r.summary}.`);
      setKind("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't make the change."); }
  };

  return (
    <Card aria-label="Try a change" className="flex flex-col gap-3">
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><FlaskConical aria-hidden size={18} /> Try a change</h2>
      <p className="m-0 text-sm text-ink-2">See what would happen to the dates. Nothing changes unless you choose to make it.</p>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">What if
        <select aria-label="What if" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setDone(""); }} className={field}>
          <option value="">Choose a change…</option>
          <option value="longer">A task takes longer</option>
          <option value="hours">Someone's hours a week change</option>
          <option value="away">Someone is away</option>
        </select>
      </label>
      {kind === "longer" && (
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5 text-sm font-semibold">Task<select aria-label="Task" value={taskId} onChange={(e) => setTaskId(e.target.value)} className={field}><option value="">Choose a task…</option>{open.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
          <label className="flex w-36 flex-col gap-1.5 text-sm font-semibold">More working days<input aria-label="More working days" type="number" min={1} max={120} value={days} onChange={(e) => setDays(Math.min(120, Math.max(1, Number(e.target.value) || 1)))} className={field} /></label>
        </div>
      )}
      {(kind === "hours" || kind === "away") && (
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1.5 text-sm font-semibold">Person<select aria-label="Person" value={person} onChange={(e) => setPerson(e.target.value)} className={field}><option value="">Choose someone…</option>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          {kind === "hours" && <label className="flex w-36 flex-col gap-1.5 text-sm font-semibold">Hours a week<input aria-label="Hours a week" type="number" min={1} max={80} value={hours} onChange={(e) => setHours(Math.min(80, Math.max(1, Number(e.target.value) || 1)))} className={field} /></label>}
          {kind === "away" && <>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">From<input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} /></label>
            <label className="flex w-32 flex-col gap-1.5 text-sm font-semibold">Working days<input aria-label="Working days" type="number" min={1} max={120} value={days} onChange={(e) => setDays(Math.min(120, Math.max(1, Number(e.target.value) || 1)))} className={field} /></label>
          </>}
        </div>
      )}
      <div role="status" className="flex flex-col gap-2">
        {r && (
          <div className="flex flex-col gap-1 rounded-xl bg-surface-2 p-3 text-[15px]">
            <strong>{r.finishDays === 0 ? `The finish stays ${shortDate(r.finishAfter)}.` : `The finish moves from ${shortDate(r.finishBefore)} to ${shortDate(r.finishAfter)} (${plural(Math.abs(r.finishDays), "working day")} ${r.finishDays > 0 ? "later" : "earlier"}).`}</strong>
            {r.milestones.map((m) => <span key={m.id} className="text-sm">{m.title}: {shortDate(m.before)} → {shortDate(m.after)}</span>)}
            <span className="text-sm text-ink-2">{r.tasksMoved ? `${plural(r.tasksMoved, "task")} would finish on a different day.` : "No task's finish changes."}</span>
          </div>
        )}
        {done && <Notice tone="good">{done}</Notice>}
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {r && canEdit && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void apply()}>Make this change</Button><Button variant="ghost" onClick={() => setKind("")}>Clear</Button></div>}
    </Card>
  );
}
