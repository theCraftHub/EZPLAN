/** Edit one task. A side panel on desktop, a sheet from the bottom on phones; same fields on both. */
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Comments } from "./Comments";
import { Trash2, X } from "lucide-react";
import { awaitingApproval, parseEstimate, repeatLabel, sameName, type Op, type Plan, type Task } from "@rakuplan/shared";
import { usePlanCtx } from "./PlanContext";
import { TaskMoney } from "./Budget";
import { longDate } from "../../lib/format";
import { Button } from "../../ui/kit";
import { STATUS } from "../../ui/Status";
import type { usePlanMath } from "./math";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;

export function TaskSheet({ task, plan, math, canEdit, edit, onClose, options, optionsLoading }: { task: Task; plan: Plan; math: Math; canEdit: boolean; edit: (op: Op) => void; onClose: () => void; options?: { person: string; finish: string; finishChange: number; moved: number; fits: boolean }[]; optionsLoading?: boolean }) {
  const [title, setTitle] = useState(task.title);
  const [owner, setOwner] = useState(task.owner ?? "");
  const [dept, setDept] = useState(task.dept ?? "");
  const [approver, setApprover] = useState(task.approver ?? "");
  const [repeat, setRepeat] = useState(task.repeat ?? "");
  const [note, setNote] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  const ctx = usePlanCtx();
  const { me, manager, canComment } = ctx;
  const mayApprove = canComment && !!task.approver && (!!manager || sameName(task.approver, me ?? ""));
  const [due, setDue] = useState(task.due ?? "");
  const [notBefore, setNotBefore] = useState(task.notBefore ?? "");
  const [estimate, setEstimate] = useState(task.estimate ? `${task.estimate.amount}${task.estimate.unit}` : "");
  const [notes, setNotes] = useState(task.notes.join("\n"));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const s = math.schedule.tasks.get(task.id);
  const est = estimate.trim() ? parseEstimate(estimate) : null;
  const estBad = estimate.trim() !== "" && !est;
  const people = [...new Set([...plan.team.map((m) => m.name), ...plan.phases.flatMap((p) => p.tasks.map((t) => t.owner)).filter(Boolean)])] as string[];
  const save = () => {
    const set = (field: Extract<Op, { kind: "setField" }>["field"], value: unknown) => edit({ kind: "setField", taskId: task.id, field, value });
    if (title.trim() && title.trim() !== task.title) set("title", title.trim());
    if ((owner.trim() || null) !== (task.owner ?? null)) set("owner", owner.trim() || null);
    if ((dept.trim() || null) !== (task.dept ?? null)) set("dept", dept.trim() || null);
    if ((approver.trim() || null) !== (task.approver ?? null)) set("approver", approver.trim() || null);
    if ((repeat || null) !== (task.repeat ?? null)) set("repeat", repeat || null);
    if ((due || null) !== (task.due ?? null)) set("due", due || null);
    if ((notBefore || null) !== (task.notBefore ?? null)) set("notBefore", notBefore || null);
    if (!estBad && JSON.stringify(est ?? null) !== JSON.stringify(task.estimate ?? null)) set("estimate", est ?? null);
    const n = notes.split("\n").map((l) => l.trim()).filter(Boolean);
    if (JSON.stringify(n) !== JSON.stringify(task.notes)) set("notes", n);
    onClose();
  };
  const field = "min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal disabled:bg-surface-2";
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/40" />
        <Dialog.Content onEscapeKeyDown={(e) => { if ((document.activeElement as HTMLElement | null)?.getAttribute("aria-expanded") === "true") e.preventDefault(); /* Escape closes an open @mention list first */ }} className="fixed inset-x-0 bottom-0 z-40 flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-xl lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-[440px] lg:rounded-none">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs font-bold text-muted">{task.id} · {task.milestone ? "Milestone" : STATUS[task.status].label}</span>
              <Dialog.Title className="m-0 text-xl font-bold">{task.title}</Dialog.Title>
            </div>
            <Dialog.Close aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line"><X aria-hidden size={18} /></Dialog.Close>
          </div>
          <Dialog.Description className="m-0 text-sm text-ink-2">
            {s ? (task.milestone ? `Due ${longDate(s.end)}. ` : `${longDate(s.start)} to ${longDate(s.end)}. `) : ""}
            {s && !task.milestone ? math.why(task.id) : ""}
          </Dialog.Description>
          {task.done && <p className="m-0 text-sm font-semibold text-good">Done by {task.done.by ?? "someone"} · {longDate(task.done.date)}</p>}
          {task.approved && <p className="m-0 text-sm font-semibold text-good">Approved by {task.approved.by ?? "someone"} · {longDate(task.approved.date)}</p>}
          {awaitingApproval(task) && (
            <section aria-label="Approval" className="flex flex-col gap-2 rounded-xl bg-primary-soft p-3 text-primary-ink">
              <p className="m-0 text-sm font-semibold">Waiting for {task.approver}'s approval. It counts as done once approved.</p>
              {mayApprove && !sendingBack && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => { edit({ kind: "approve", taskId: task.id, decision: "approve" }); onClose(); }}>Approve</Button>
                  <Button variant="secondary" onClick={() => setSendingBack(true)}>Send back…</Button>
                </div>
              )}
              {mayApprove && sendingBack && (
                <div className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1.5 text-sm font-semibold">What needs changing? (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={field} /></label>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => { edit({ kind: "approve", taskId: task.id, decision: "reject", ...(note.trim() ? { note: note.trim() } : {}) }); onClose(); }}>Send back to Doing</Button>
                    <Button variant="secondary" onClick={() => setSendingBack(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </section>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Task<input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} className={field} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-semibold">Owner
              <input value={owner} onChange={(e) => setOwner(e.target.value)} list="sheet-people" disabled={!canEdit} className={field} />
              <datalist id="sheet-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
            </label>
            {!task.milestone && (
              <label className="flex flex-col gap-1.5 text-sm font-semibold">Takes
                <input value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="e.g. 3d or 6h" aria-invalid={estBad} disabled={!canEdit} className={field} />
                {estBad && <span className="font-normal text-bad">Use hours, days or weeks, like 6h, 3d or 1w.</span>}
              </label>
            )}
            <label className="flex flex-col gap-1.5 text-sm font-semibold">Due by<input type="date" value={due} onChange={(e) => setDue(e.target.value)} disabled={!canEdit} className={field} />
              {s && task.due && s.end > task.due && task.status !== "done" && task.status !== "skipped" && <span className="font-normal text-warn">Scheduled to finish {longDate(s.end)}, after this.</span>}</label>
            {!task.milestone && <label className="flex flex-col gap-1.5 text-sm font-semibold">Can't start before<input type="date" value={notBefore} onChange={(e) => setNotBefore(e.target.value)} disabled={!canEdit} className={field} /></label>}
            <label className="flex flex-col gap-1.5 text-sm font-semibold">Department<input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="e.g. IT" maxLength={60} disabled={!canEdit} className={field} /></label>
            {!task.milestone && task.status !== "done" && task.status !== "skipped" && (
              <label className="col-span-2 flex flex-col gap-1.5 text-sm font-semibold">Repeats
                <select value={repeat} onChange={(e) => setRepeat(e.target.value)} disabled={!canEdit} className={field}>
                  <option value="">Doesn't repeat</option>
                  {[...new Set(["daily", "weekdays", "weekly", "every 2 weeks", "monthly", "quarterly", "yearly", ...(task.repeat ? [task.repeat] : [])])].map((r) => <option key={r} value={r}>{repeatLabel(r)}</option>)}
                </select>
                {repeat && <span className="font-normal text-ink-2">When it's done, the next one is added right after it, due {repeatLabel(repeat).toLowerCase().replace(/^every /, "a ").replace(/^a (\d)/, "$1")} later.</span>}
              </label>
            )}
            {!task.milestone && <label className="col-span-2 flex flex-col gap-1.5 text-sm font-semibold">Needs approval from<input value={approver} onChange={(e) => setApprover(e.target.value)} list="sheet-people" placeholder="Nobody (leave empty)" disabled={!canEdit} className={field} /></label>}
          </div>
          {canEdit && !task.milestone && (options || optionsLoading) && (
            <section aria-label="Best people for this task" className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Best people for this task</span>
              {optionsLoading && <span className="text-sm text-muted">Working out options…</span>}
              {options?.length === 0 && <span className="text-sm text-muted">Nobody else is on this plan yet.</span>}
              {options?.map((o) => (
                <button key={o.person} onClick={() => { edit({ kind: "setField", taskId: task.id, field: "owner", value: o.person }); onClose(); }} className={`flex min-h-12 items-center justify-between gap-2 rounded-xl px-3 text-left text-sm ring-1 ${o.fits ? "bg-good-soft text-good ring-good/30" : "bg-surface-2 text-ink-2 ring-line"}`}>
                  <span className="font-semibold">Give to {o.person}</span>
                  <span>{o.fits ? "Free then" : "Less free time then"} · finish {new Date(`${o.finish}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}{o.finishChange ? ` (${Math.abs(o.finishChange)}d ${o.finishChange < 0 ? "earlier" : "later"})` : ""}</span>
                </button>
              ))}
            </section>
          )}
          {ctx.planId && ctx.workWeek && <TaskMoney task={task} plan={plan} planId={ctx.planId} people={ctx.people ?? {}} workWeek={ctx.workWeek} canEdit={canEdit} edit={edit} />}
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Notes<textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} className={`${field} py-2`} /></label>
          {canEdit && !task.milestone && task.status !== "skipped" && (
            <button onClick={() => { edit({ kind: "setStatus", taskId: task.id, status: "skipped" }); onClose(); }} className="min-h-11 self-start text-sm font-semibold text-ink-2 underline underline-offset-4">Skip this task</button>
          )}
          {canEdit && (
            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <Button onClick={save} disabled={!title.trim() || estBad}>Save</Button>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <span className="flex-1" />
              {confirmDelete ? (
                <Button variant="danger" onClick={() => { edit({ kind: "deleteTask", taskId: task.id }); onClose(); }}>Move to Trash</Button>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 aria-hidden size={18} /> Delete</Button>
              )}
            </div>
          )}
          {confirmDelete && <p className="m-0 text-sm text-ink-2">It goes to the Trash and can be brought back for 30 days.</p>}
          <Comments taskId={task.id} title={task.title} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
