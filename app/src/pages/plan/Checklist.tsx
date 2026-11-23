import { memo, useState } from "react";
import { Link2, MessageCircle, MessageSquareText, Plus } from "lucide-react";
import { parseQuickAdd, type Op, type Phase, type Plan, type Task } from "@ezplan/shared";
import { shortDate } from "../../lib/format";
import { Card } from "../../ui/kit";
import { MilestoneMark, StatusButton } from "../../ui/Status";
import type { usePlanMath } from "./math";
import { TaskSheet } from "./TaskSheet";
import { usePlanCtx } from "./PlanContext";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;

const est = (t: Task) => (t.estimate ? `${t.estimate.amount}${t.estimate.unit}` : null);

export function Checklist({ plan, math, today, canEdit, edit }: { plan: Plan; math: Math; today: string; canEdit: boolean; edit: (op: Op) => void }) {
  // A link like ?task=T3 (from a notification) opens that task.
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(location.search).get("task"));
  const task = open ? math.byId.get(open) : undefined;
  return (
    <div className="flex flex-col gap-4">
      {plan.phases.map((ph, i) => (
        <PhaseCard key={ph.id} phase={ph} index={i} plan={plan} math={math} today={today} canEdit={canEdit} edit={edit} onOpen={setOpen} />
      ))}
      {task && <TaskSheet task={task} plan={plan} math={math} canEdit={canEdit} edit={edit} onClose={() => setOpen(null)} />}
    </div>
  );
}

const PHASE_COLORS = ["#4F46E5", "#0F766E", "#B45309", "#BE185D", "#0369A1", "#4D7C0F"];

function PhaseCard({ phase, index, plan, math, today, canEdit, edit, onOpen }: { phase: Phase; index: number; plan: Plan; math: Math; today: string; canEdit: boolean; edit: (op: Op) => void; onOpen: (id: string) => void }) {
  const counted = phase.tasks.filter((t) => !t.milestone && t.status !== "skipped");
  const { counts } = usePlanCtx();
  const done = counted.filter((t) => t.status === "done").length;
  const pct = counted.length ? Math.round((done / counted.length) * 100) : 0;
  return (
    <Card aria-label={`Phase: ${phase.title}`} className="flex flex-col gap-2 p-0 [contain-intrinsic-size:auto_480px] [content-visibility:auto]">
      <div className="flex flex-col gap-2 px-4 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ background: PHASE_COLORS[index % PHASE_COLORS.length] }} />{phase.title}</h2>
          <span className="shrink-0 text-sm font-semibold text-ink-2">{done} of {counted.length}</span>
        </div>
        {phase.description && <p className="m-0 text-sm text-ink-2">{phase.description}</p>}
        <div aria-hidden className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: PHASE_COLORS[index % PHASE_COLORS.length] }} /></div>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {phase.tasks.map((t) => {
          const comments = counts[t.id] ?? 0;
          const s = math.schedule.tasks.get(t.id);
          const waits = t.depends.filter((d) => !["done", "skipped"].includes(math.byId.get(d.id)?.status ?? "done")).map((d) => math.byId.get(d.id)?.title ?? d.id);
          return <TaskRow key={t.id} t={t} when={s ? { start: s.start, end: s.end, overdue: s.overdue } : null} waits={waits} comments={comments} canEdit={canEdit} edit={edit} onOpen={onOpen} />;
        })}
      </ul>
      {canEdit && <QuickAdd phaseId={phase.id} plan={plan} today={today} edit={edit} />}
    </Card>
  );
}

type RowProps = { t: Task; when: { start: string; end: string; overdue: boolean } | null; waits: string[]; comments: number; canEdit: boolean; edit: (op: Op) => void; onOpen: (id: string) => void };

/** One task. Only re-renders when what it shows changed, so a tap stays instant on big plans. */
const TaskRow = memo(function TaskRow({ t, when: s, waits, comments, canEdit, edit, onOpen }: RowProps) {
  const finished = t.status === "done" || t.status === "skipped";
  const by = t.status === "done" ? t.done : t.status === "skipped" ? t.skipped : undefined;
  const chip = "inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-2";
  return (
    <li className="flex items-start gap-3 border-t border-line px-4 py-3">
      {t.milestone ? (
        <span className="flex min-h-11 min-w-[5.5rem] items-center justify-center gap-1 text-xs font-bold text-primary-ink"><MilestoneMark /> Milestone</span>
      ) : (
        <StatusButton status={t.status} title={t.title} disabled={!canEdit} onChange={(status) => edit({ kind: "setStatus", taskId: t.id, status })} />
      )}
      <button onClick={() => onOpen(t.id)} className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 text-left">
        <span className={`text-[15px] leading-snug font-semibold ${finished ? "text-muted line-through decoration-1" : ""}`}>{t.title}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {t.owner && <span className={chip}>{t.owner}</span>}
          {s && <span className="text-xs text-muted">{t.milestone ? shortDate(s.end) : `${shortDate(s.start)} to ${shortDate(s.end)}`}</span>}
          {est(t) && !t.milestone && <span className={chip}>{est(t)}</span>}
          {waits.length > 0 && !finished && <span className={chip}><Link2 aria-hidden size={12} /> <span className="max-w-[14rem] truncate">waits on {waits[0]}{waits.length > 1 ? ` +${waits.length - 1}` : ""}</span></span>}
          {s?.overdue && !finished && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-bold text-warn">Overdue</span>}
          {t.notes.length > 0 && <MessageSquareText aria-label="Has notes" size={14} className="text-muted" />}
          {comments > 0 && <span className={chip} aria-label={`${comments} comment${comments === 1 ? "" : "s"}`}><MessageCircle aria-hidden size={12} /> {comments}</span>}
          {by && <span className="text-xs font-semibold text-good">{t.status === "done" ? "Done" : "Skipped"}{by.by ? ` by ${by.by}` : ""} · {shortDate(by.date)}</span>}
        </span>
      </button>
    </li>
  );
}, (a, b) => a.comments === b.comments && a.canEdit === b.canEdit && a.edit === b.edit && a.onOpen === b.onOpen && JSON.stringify([a.t, a.when, a.waits]) === JSON.stringify([b.t, b.when, b.waits]));

function QuickAdd({ phaseId, plan, today, edit }: { phaseId: string; plan: Plan; today: string; edit: (op: Op) => void }) {
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseQuickAdd(text, plan, today) : null;
  const add = () => {
    if (!parsed) return;
    const last = plan.phases.find((p) => p.id === phaseId)?.tasks.at(-1);
    edit({ kind: "addTask", phaseId, task: parsed.task, ...(last ? { afterId: last.id } : {}) });
    setText("");
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex flex-col gap-1 border-t border-line px-4 py-3">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`qa-${phaseId}`}>Add a task to this phase</label>
        <input id={`qa-${phaseId}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a task, e.g. Book venue 3d @Ana due Fri" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-base" />
        <button type="submit" disabled={!parsed} aria-label="Add task" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white disabled:opacity-40 dark:text-ground"><Plus aria-hidden /></button>
      </div>
      {parsed && parsed.understood.length > 0 && <span className="text-xs text-muted">We read: {parsed.understood.join(" · ")}</span>}
    </form>
  );
}
