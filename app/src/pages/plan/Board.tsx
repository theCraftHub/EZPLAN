/**
 * Board (step N5a): tasks as cards in To do / Doing / Waiting for approval / Done. Drag a card to
 * another column, or focus it and press the left and right arrow keys; phones show one column at a
 * time with a "Move to" choice on each card. Every move is an ordinary live edit.
 */
import { useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import type { Op, Plan, Task } from "@rakuplan/shared";
import { COLUMNS, columnOf, moveOp, type Column } from "./board";
import { shortDate } from "../../lib/format";
import { useIsDesktop } from "../../lib/view";
import { Card } from "../../ui/kit";
import type { usePlanMath } from "./math";
import { TaskSheet } from "./TaskSheet";
import { usePlanCtx } from "./PlanContext";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;
const label = (c: Column) => COLUMNS.find((x) => x.id === c)!.label;

export function Board({ plan, math, canEdit, edit }: { plan: Plan; math: Math; canEdit: boolean; edit: (op: Op) => void }) {
  const desktop = useIsDesktop();
  const { me, manager } = usePlanCtx();
  const [person, setPerson] = useState("");
  const [phase, setPhase] = useState("");
  const [dept, setDept] = useState("");
  const [shown, setShown] = useState<Column>("todo");
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [over, setOver] = useState<Column | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const tasks = useMemo(() => plan.phases.flatMap((ph) => ph.tasks.filter((t) => !t.milestone).map((t) => ({ t, phase: ph }))), [plan]);
  const owners = [...new Set(tasks.map(({ t }) => t.owner).filter((x): x is string => !!x))].sort();
  const depts = [...new Set(tasks.map(({ t }) => t.dept).filter((x): x is string => !!x))].sort();
  const visible = tasks.filter(({ t, phase: ph }) => (!person || (person === "-" ? !t.owner : t.owner === person)) && (!phase || ph.id === phase) && (!dept || t.dept === dept));
  const byCol = (c: Column) => visible.filter(({ t }) => columnOf(t) === c);

  const move = (t: Task, to: Column) => {
    const r = moveOp(t, to, { me, manager });
    if (!r) return;
    if ("why" in r) return setSaid(r.why);
    edit(r.op);
    setSaid(`${t.title} moved to ${label(to === "done" && t.approver && !t.approved && columnOf(t) !== "waiting" ? "waiting" : to)}.`);
  };
  const onKey = (e: KeyboardEvent, t: Task) => {
    if (!canEdit || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const i = COLUMNS.findIndex((c) => c.id === columnOf(t)) + (e.key === "ArrowRight" ? 1 : -1);
    if (i >= 0 && i < COLUMNS.length) move(t, COLUMNS[i]!.id);
    requestAnimationFrame(() => document.getElementById(`card-${t.id}`)?.focus());
  };
  const drop = (e: DragEvent, c: Column) => {
    e.preventDefault();
    setOver(null);
    const t = math.byId.get(e.dataTransfer.getData("text/plain"));
    if (t) move(t, c);
  };

  const select = "min-h-11 rounded-xl border border-line bg-surface px-3 text-[15px]";
  const task = open ? math.byId.get(open) : undefined;
  const cols = desktop ? COLUMNS : COLUMNS.filter((c) => c.id === shown);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Filter the board">
        <label className="flex flex-col gap-1 text-sm font-semibold">Person<select value={person} onChange={(e) => setPerson(e.target.value)} className={select}><option value="">Everyone</option>{owners.map((o) => <option key={o} value={o}>{o}</option>)}<option value="-">Nobody yet</option></select></label>
        {plan.phases.length > 1 && <label className="flex flex-col gap-1 text-sm font-semibold">Phase<select value={phase} onChange={(e) => setPhase(e.target.value)} className={select}><option value="">All phases</option>{plan.phases.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>}
        {depts.length > 0 && <label className="flex flex-col gap-1 text-sm font-semibold">Department<select value={dept} onChange={(e) => setDept(e.target.value)} className={select}><option value="">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>}
      </div>
      {!desktop && (
        <div role="radiogroup" aria-label="Column" className="flex flex-wrap gap-1.5">
          {COLUMNS.map((c) => <button key={c.id} role="radio" aria-checked={shown === c.id} onClick={() => setShown(c.id)} className={`min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold ring-1 ${shown === c.id ? "bg-ink text-ground ring-ink" : "bg-surface ring-line"}`}>{c.label} · {byCol(c.id).length}</button>)}
        </div>
      )}
      <p role="status" className="m-0 min-h-5 text-sm text-ink-2">{said}</p>
      <div className={desktop ? "grid grid-cols-4 items-start gap-3" : "flex flex-col"}>
        {cols.map((c) => {
          const items = byCol(c.id);
          return (
            <section key={c.id} aria-label={`${c.label} column`}
              onDragOver={(e) => { if (canEdit && dragging) { e.preventDefault(); setOver(c.id); } }}
              onDragLeave={() => setOver((o) => (o === c.id ? null : o))}
              onDrop={(e) => drop(e, c.id)}
              className={`flex min-h-40 flex-col gap-2 rounded-2xl p-2 ${over === c.id ? "bg-primary-soft ring-2 ring-primary" : "bg-surface-2"}`}>
              {desktop && <h2 className="m-0 flex items-center justify-between px-2 pt-1 text-[15px] font-bold">{c.label}<span className="text-sm font-semibold text-muted">{items.length}</span></h2>}
              {items.length === 0 && <p className="m-0 px-2 py-4 text-center text-sm text-muted">{c.id === "waiting" ? "Nothing waiting for approval." : "No tasks here."}</p>}
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {items.map(({ t, phase: ph }) => {
                  const s = math.schedule.tasks.get(t.id);
                  const late = s?.overdue && t.status !== "done" && t.status !== "skipped";
                  return (
                    <li key={t.id}>
                      <Card aria-label={t.title} className={`flex flex-col gap-1.5 p-3 ${dragging === t.id ? "opacity-50" : ""}`}>
                        <button id={`card-${t.id}`} draggable={canEdit && desktop}
                          aria-description={canEdit ? "Press Enter to open. Left and right arrow keys move it to another column." : undefined}
                          onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; setDragging(t.id); }}
                          onDragEnd={() => { setDragging(null); setOver(null); }}
                          onKeyDown={(e) => onKey(e, t)} onClick={() => setOpen(t.id)}
                          className={`text-left text-[15px] leading-snug font-semibold ${canEdit && desktop ? "cursor-grab" : ""} ${t.status === "skipped" ? "text-muted line-through" : ""}`}>{t.title}</button>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs">
                          {t.owner && <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-ink-2">{t.owner}</span>}
                          {s && t.status !== "skipped" && <span className="text-muted">{columnOf(t) === "waiting" ? `Waiting for ${t.approver}` : t.status === "done" ? "Done" : `Finish ${shortDate(s.end)}`}</span>}
                          {late && <span className="rounded-full bg-warn-soft px-2 py-0.5 font-bold text-warn">Overdue</span>}
                          {t.status === "skipped" && <span className="text-muted">Skipped</span>}
                          {plan.phases.length > 1 && <span className="text-muted">· {ph.title}</span>}
                        </span>
                        {canEdit && !desktop && (
                          <label className="flex items-center gap-2 text-sm font-semibold">Move to
                            <select value={columnOf(t)} onChange={(e) => move(t, e.target.value as Column)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-2 text-sm font-normal">
                              {COLUMNS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                            </select>
                          </label>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {task && <TaskSheet task={task} plan={plan} math={math} canEdit={canEdit} edit={edit} onClose={() => setOpen(null)} />}
    </div>
  );
}
