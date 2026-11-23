/**
 * Team schedule: who does what, when, drawn on top of each person's availability.
 * Desktop: people x days grid. Phone: a week strip with a day list, or one person's week.
 */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, UserPlus, UserRound } from "lucide-react";
import { levelPlan, type Op, type PersonAvailability, type Plan, type WorkWeek } from "@ezplan/shared";
import type { Me } from "../../lib/api";
import { longDate, plural, shortDate } from "../../lib/format";
import { Button, Card, Notice } from "../../ui/kit";
import type { usePlanMath } from "./math";
import { PersonSheet } from "./PersonSheet";
import { findPerson, useTeamData, type DayCell, type PersonRow } from "./teamData";
import { TaskSheet } from "./TaskSheet";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;
const WEEKDAY = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
const h = (n: number) => `${Math.round(n * 10) / 10} h`;

interface Props { me: Me; planId: string; plan: Plan; math: Math; people: Record<string, PersonAvailability>; workWeek: WorkWeek; today: string; canEdit: boolean; edit: (op: Op) => void; onPeople: (p: Record<string, PersonAvailability>) => void }

export function Team(props: Props) {
  const { plan, math, people, workWeek, today, canEdit, edit } = props;
  const data = useTeamData(plan, math, people, workWeek, today);
  const [sheet, setSheet] = useState<{ name: string; isNew?: boolean; mine?: boolean } | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<{ name: string; taskId?: string; finish?: string; days?: number } | null>(null);
  const finishTask = useMemo(() => [...math.schedule.tasks.values()].filter((t) => t.end === math.schedule.finish).map((t) => t.id)[0], [math]);
  const mine = data.rows.find((r) => r.name.toLowerCase() === props.me.user.name.toLowerCase() || r.name.toLowerCase() === props.me.user.name.split(" ")[0]!.toLowerCase());

  // After someone is added: try giving them each open task that decides the finish date, keep the best.
  const suggestFor = (name: string, nextPeople: Record<string, PersonAvailability>) => {
    const opts = { workWeek, today, people: nextPeople };
    const base = levelPlan(plan, opts).finish;
    let best: { taskId: string; finish: string } | null = null;
    for (const id of math.schedule.criticalPath) {
      const t = math.byId.get(id);
      if (!t || t.milestone || t.status === "done" || t.status === "skipped" || t.owner?.toLowerCase() === name.toLowerCase()) continue;
      const trial = structuredClone(plan);
      for (const ph of trial.phases) for (const x of ph.tasks) if (x.id === id) x.owner = name;
      const f = levelPlan(trial, opts).finish;
      if (f < base && (!best || f < best.finish)) best = { taskId: id, finish: f };
    }
    const days = best ? Math.round((Date.parse(base) - Date.parse(best.finish)) / 86_400_000) : 0;
    setSuggest(best ? { name, taskId: best.taskId, finish: best.finish, days } : { name });
  };

  const saved = (name: string, a: PersonAvailability, isNew?: boolean) => {
    const next = { ...Object.fromEntries(Object.entries(people).filter(([n]) => n.toLowerCase() !== name.toLowerCase())), [name]: a };
    props.onPeople(next);
    setSheet(null);
    if (isNew) suggestFor(name, next);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">Finish</span>
            <span className="text-xl font-bold">{longDate(math.schedule.finish)}</span>
            {finishTask && <span className="text-sm text-ink-2">Last up: {math.byId.get(finishTask)?.title}. {math.why(finishTask)}</span>}
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setSheet(mine ? { name: mine.name, mine: true } : { name: props.me.user.name.split(" ")[0]!, isNew: true, mine: true })}><UserRound aria-hidden size={18} /> My availability</Button>
              <Button onClick={() => setSheet({ name: "", isNew: true })}><UserPlus aria-hidden size={18} /> Add person</Button>
            </div>
          )}
        </div>
        {suggest && (
          <Notice tone={suggest.taskId ? "info" : "good"}>
            <span className="flex flex-col gap-2">
              {suggest.taskId ? (
                <>
                  <span><strong>{suggest.name} is on the plan.</strong> Giving {suggest.name} "{math.byId.get(suggest.taskId)?.title}" moves the finish to {shortDate(suggest.finish!)}, {plural(suggest.days!, "day")} earlier.</span>
                  <span className="flex gap-2">
                    <Button onClick={() => { edit({ kind: "setField", taskId: suggest.taskId!, field: "owner", value: suggest.name }); setSuggest(null); }}>Give it to {suggest.name}</Button>
                    <Button variant="secondary" onClick={() => setSuggest(null)}>Not now</Button>
                  </span>
                </>
              ) : (
                <span className="flex items-center justify-between gap-3">{suggest.name} is on the plan. No single task given to {suggest.name} would finish sooner right now; give them tasks from the checklist. <button onClick={() => setSuggest(null)} className="min-h-10 shrink-0 px-2 font-semibold">OK</button></span>
              )}
            </span>
          </Notice>
        )}
        {math.schedule.assumedFullTime.length > 0 && <p className="m-0 text-sm text-ink-2">No hours set for {math.schedule.assumedFullTime.join(", ")}: counted as full time ({workWeek.hoursPerWeek} h/week). Tap a name to change it.</p>}
      </Card>

      <div className="hidden lg:block"><Grid data={data} today={today} math={math} onPerson={(n) => setSheet({ name: n })} onTask={setTaskId} canEdit={canEdit} /></div>
      <div className="lg:hidden"><PhoneView data={data} today={today} math={math} onPerson={(n) => setSheet({ name: n })} onTask={setTaskId} /></div>

      {sheet && <PersonSheet planId={props.planId} name={sheet.name} initial={sheet.isNew ? undefined : findPerson(people, sheet.name)} workWeek={workWeek} {...(sheet.isNew ? { isNew: true } : {})} {...(sheet.mine ? { title: "My availability" } : {})} onSaved={(n, a) => saved(n, a, sheet.isNew && !sheet.mine)} onClose={() => setSheet(null)} />}
      {taskId && math.byId.get(taskId) && <TaskSheet task={math.byId.get(taskId)!} plan={plan} math={math} canEdit={canEdit} edit={edit} onClose={() => setTaskId(null)} />}
    </div>
  );
}

function cellStyle(c: DayCell): { cls: string; label: string } {
  if (!c.workday) return { cls: "bg-surface-2", label: "not a working day" };
  if (c.off) return { cls: "bg-[repeating-linear-gradient(45deg,var(--surface-2),var(--surface-2)_4px,var(--line)_4px,var(--line)_8px)]", label: c.off };
  if (c.available === 0) return { cls: "bg-surface-2", label: "not working" };
  if (c.booked > c.available + 0.01) return { cls: "bg-bad-soft", label: `${h(c.booked)} booked of ${h(c.available)}, over by ${h(c.booked - c.available)}` };
  return { cls: "bg-surface", label: `${h(c.booked)} booked of ${h(c.available)}` };
}

function Grid({ data, today, math, onPerson, onTask, canEdit }: { data: ReturnType<typeof useTeamData>; today: string; math: Math; onPerson: (n: string) => void; onTask: (id: string) => void; canEdit: boolean }) {
  const W = 44;
  return (
    <Card aria-label="Team schedule grid" className="overflow-x-auto p-0">
      <table className="border-collapse text-xs" style={{ minWidth: 200 + data.dates.length * W }}>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-[200px] bg-surface px-4 py-2 text-left text-sm font-semibold">Person</th>
            {data.dates.map((d) => (
              <th key={d} scope="col" className={`px-0 py-2 text-center font-semibold ${d === today ? "text-primary" : "text-muted"}`} style={{ width: W, minWidth: W }}>
                <span className="block text-[10px] font-normal">{WEEKDAY(d)}</span>{new Date(`${d}T12:00:00Z`).getUTCDate()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.name} className="border-t border-line">
              <th scope="row" className="sticky left-0 z-10 bg-surface px-2 text-left">
                <button onClick={() => onPerson(r.name)} disabled={!canEdit} className="flex min-h-14 w-full flex-col items-start justify-center rounded-lg px-2 text-left hover:bg-surface-2">
                  <span className="text-sm font-bold">{r.name}</span>
                  <span className="text-xs font-normal text-muted">{r.set ? `${r.weekHours} h/week` : `${r.weekHours} h/week (assumed)`}</span>
                </button>
              </th>
              {r.days.map((c) => {
                const s = cellStyle(c);
                return (
                  <td key={c.date} className={`relative border-l border-line/60 p-0.5 align-top ${s.cls}`} style={{ height: 56 }} title={`${r.name}, ${longDate(c.date)}: ${s.label}`}>
                    <span className="sr-only">{`${longDate(c.date)}: ${s.label}`}</span>
                    {c.off && c.workday && <span className="absolute inset-x-0 top-1 truncate text-center text-[9px] font-semibold text-ink-2">{c.off}</span>}
                    <div className="flex h-full flex-col justify-end gap-0.5">
                      {c.tasks.map((t) => {
                        const task = math.byId.get(t.id);
                        return (
                          <button key={t.id} onClick={() => onTask(t.id)} aria-label={`${task?.title ?? t.id}, ${h(t.hours)} on ${shortDate(c.date)}`} className={`block w-full truncate rounded px-0.5 text-left text-[9px] leading-tight font-semibold ${math.schedule.tasks.get(t.id)?.critical ? "bg-primary text-white dark:text-ground" : "bg-primary-soft text-primary-ink"}`} style={{ height: Math.max(12, Math.min(40, (t.hours / Math.max(1, c.available || 8)) * 40)) }}>
                            {t.id}
                          </button>
                        );
                      })}
                    </div>
                    {c.booked > c.available + 0.01 && c.workday && !c.off && <span className="absolute top-0.5 right-0.5 rounded bg-bad px-0.5 text-[9px] font-bold text-white">+{Math.round((c.booked - c.available) * 10) / 10}h</span>}
                  </td>
                );
              })}
            </tr>
          ))}
          {data.unassigned.length > 0 && (
            <tr className="border-t border-line">
              <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2 text-left text-sm font-bold">Unassigned</th>
              <td colSpan={data.dates.length} className="px-2 py-2">
                <span className="flex flex-wrap gap-1.5">{data.unassigned.map((t) => <button key={t.id} onClick={() => onTask(t.id)} className="min-h-9 rounded-lg bg-warn-soft px-2 text-xs font-semibold text-warn">{t.title}</button>)}</span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="m-0 border-t border-line px-4 py-3 text-xs text-muted">Blocks are hours booked that day. Striped = day off. Grey = not working. Red with +h = more booked than that person has.</p>
    </Card>
  );
}

function PhoneView({ data, today, math, onPerson, onTask }: { data: ReturnType<typeof useTeamData>; today: string; math: Math; onPerson: (n: string) => void; onTask: (id: string) => void }) {
  const [mode, setMode] = useState<"day" | "person">("day");
  const startIdx = Math.max(0, data.dates.indexOf(today));
  const [week, setWeek] = useState(Math.floor(startIdx / 7));
  const [day, setDay] = useState(data.dates[startIdx] ?? data.dates[0]!);
  const [person, setPerson] = useState(data.rows[0]?.name ?? "");
  const weekDates = data.dates.slice(week * 7, week * 7 + 7);
  const maxWeek = Math.ceil(data.dates.length / 7) - 1;
  const row = data.rows.find((r) => r.name === person);
  const seg = (on: boolean) => `min-h-10 flex-1 rounded-lg text-sm font-semibold ${on ? "bg-surface text-ink shadow-sm" : "text-muted"}`;
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Show" className="flex rounded-xl bg-surface-2 p-1">
        <button role="radio" aria-checked={mode === "day"} onClick={() => setMode("day")} className={seg(mode === "day")}>By day</button>
        <button role="radio" aria-checked={mode === "person"} onClick={() => setMode("person")} className={seg(mode === "person")}>By person</button>
      </div>
      {mode === "day" && (
        <>
          <div className="flex items-center gap-1">
            <button aria-label="Previous week" disabled={week === 0} onClick={() => setWeek(week - 1)} className="flex h-11 w-9 items-center justify-center disabled:opacity-30"><ChevronLeft aria-hidden /></button>
            <div className="grid flex-1 grid-cols-7 gap-1" role="radiogroup" aria-label="Day">
              {weekDates.map((d) => (
                <button key={d} role="radio" aria-checked={d === day} onClick={() => setDay(d)} className={`flex min-h-14 flex-col items-center justify-center rounded-xl text-xs ${d === day ? "bg-ink text-ground" : "bg-surface ring-1 ring-line"}`}>
                  <span>{WEEKDAY(d).slice(0, 2)}</span>
                  <span className="text-sm font-bold">{new Date(`${d}T12:00:00Z`).getUTCDate()}</span>
                  <span aria-hidden className="mt-0.5 flex gap-0.5">{data.rows.slice(0, 4).map((r) => { const c = r.days.find((x) => x.date === d)!; return <span key={r.name} className={`h-1.5 w-1.5 rounded-full ${!c.workday || c.off || !c.available ? "bg-line" : c.booked > c.available + 0.01 ? "bg-bad" : c.booked > 0 ? "bg-primary" : "bg-good"}`} />; })}</span>
                </button>
              ))}
            </div>
            <button aria-label="Next week" disabled={week >= maxWeek} onClick={() => setWeek(week + 1)} className="flex h-11 w-9 items-center justify-center disabled:opacity-30"><ChevronRight aria-hidden /></button>
          </div>
          <h2 className="m-0 text-lg font-bold">{longDate(day)}{day === today ? " · today" : ""}</h2>
          {data.rows.map((r) => <PersonDay key={r.name} r={r} c={r.days.find((x) => x.date === day)!} math={math} onPerson={onPerson} onTask={onTask} />)}
        </>
      )}
      {mode === "person" && (
        <>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label="Person">
            {data.rows.map((r) => <button key={r.name} role="radio" aria-checked={r.name === person} onClick={() => setPerson(r.name)} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold ${r.name === person ? "bg-ink text-ground" : "bg-surface ring-1 ring-line"}`}>{r.name}</button>)}
          </div>
          {row && (() => {
            const days = row.days.slice(week * 7, week * 7 + 7);
            const booked = days.reduce((s, c) => s + c.booked, 0);
            const avail = days.reduce((s, c) => s + c.available, 0);
            return (
              <>
                <div className="flex items-center gap-1">
                  <button aria-label="Previous week" disabled={week === 0} onClick={() => setWeek(week - 1)} className="flex h-11 w-9 items-center justify-center disabled:opacity-30"><ChevronLeft aria-hidden /></button>
                  <Card className="flex flex-1 flex-col gap-2 p-3">
                    <span className="text-sm font-semibold">Week of {shortDate(days[0]!.date)}: {h(booked)} of {h(avail)}</span>
                    <span aria-hidden className="h-2 overflow-hidden rounded-full bg-line"><span className={`block h-full ${booked > avail + 0.01 ? "bg-bad" : "bg-primary"}`} style={{ width: `${Math.min(100, avail ? (booked / avail) * 100 : 0)}%` }} /></span>
                  </Card>
                  <button aria-label="Next week" disabled={week >= maxWeek} onClick={() => setWeek(week + 1)} className="flex h-11 w-9 items-center justify-center disabled:opacity-30"><ChevronRight aria-hidden /></button>
                </div>
                <Button variant="secondary" onClick={() => onPerson(row.name)}>Edit {row.name}'s availability</Button>
                {days.map((c) => <PersonDay key={c.date} r={row} c={c} math={math} onPerson={onPerson} onTask={onTask} dayTitle />)}
              </>
            );
          })()}
        </>
      )}
      {data.unassigned.length > 0 && <Notice tone="warn">{plural(data.unassigned.length, "task")} with no owner: {data.unassigned.map((t) => t.title).join(", ")}.</Notice>}
    </div>
  );
}

function PersonDay({ r, c, math, onPerson, onTask, dayTitle }: { r: PersonRow; c: DayCell; math: Math; onPerson: (n: string) => void; onTask: (id: string) => void; dayTitle?: boolean }) {
  const over = c.booked > c.available + 0.01;
  const status = !c.workday ? "Not a working day" : c.off ? `Off: ${c.off}` : c.available === 0 ? "Not working" : `${h(c.booked)} of ${h(c.available)}${over ? `, over by ${h(c.booked - c.available)}` : ""}`;
  return (
    <Card className={`flex flex-col gap-2 p-3 ${over ? "ring-2 ring-bad/60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        {dayTitle ? <span className="text-[15px] font-bold">{longDate(c.date)}</span> : <button onClick={() => onPerson(r.name)} className="min-h-10 text-left text-[15px] font-bold underline-offset-4 hover:underline">{r.name}</button>}
        <span className={`text-sm font-semibold ${over ? "text-bad" : c.off ? "text-warn" : "text-ink-2"}`}>{status}</span>
      </div>
      {c.tasks.map((t) => (
        <button key={t.id} onClick={() => onTask(t.id)} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-primary-soft px-3 text-left text-sm font-semibold text-primary-ink">
          <span className="truncate">{math.byId.get(t.id)?.title ?? t.id}</span><span className="shrink-0">{h(t.hours)}</span>
        </button>
      ))}
    </Card>
  );
}
