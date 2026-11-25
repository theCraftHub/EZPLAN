/**
 * The risk log (step J3): risks, assumptions, issues and decisions, with a 5 × 5 heat map of open
 * risks (likelihood × impact). Every cell shows its count and level in words, never color alone.
 * Works as a list on phones. Editors add, change, close and delete; everyone on the plan reads.
 */
import { useEffect, useMemo, useState } from "react";
import { CircleHelp, Flag, Gavel, ShieldAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { allTasks, type Plan } from "@ezplan/shared";
import { api, ApiError, type RaidItem, type RaidKind } from "../../lib/api";
import { shortDate } from "../../lib/format";
import { Button, Card, Notice } from "../../ui/kit";

const KIND: Record<RaidKind, { word: string; plural: string; icon: LucideIcon }> = {
  risk: { word: "Risk", plural: "Risks", icon: ShieldAlert },
  assumption: { word: "Assumption", plural: "Assumptions", icon: CircleHelp },
  issue: { word: "Issue", plural: "Issues", icon: TriangleAlert },
  decision: { word: "Decision", plural: "Decisions", icon: Gavel },
};
const level = (l: number, i: number) => (l * i >= 15 ? "high" : l * i >= 8 ? "medium" : "low");
const LEVEL = { high: { word: "High", cls: "bg-bad-soft text-bad" }, medium: { word: "Medium", cls: "bg-warn-soft text-warn" }, low: { word: "Low", cls: "bg-good-soft text-good" } } as const;
const SCALE = ["", "Rare", "Unlikely", "Possible", "Likely", "Almost certain"];
const IMPACT = ["", "Minor", "Small", "Moderate", "Major", "Severe"];
const field = "min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal";

export function Risks({ planId, plan, today, people, onOpenChange }: { planId: string; plan: Plan; today: string; people: string[]; onOpenChange: (open: { risks: number; issues: number }) => void }) {
  const [data, setData] = useState<{ canEdit: boolean; items: RaidItem[] } | null>(null);
  const [kind, setKind] = useState<RaidKind | "all">("all");
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [cell, setCell] = useState<{ l: number; i: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const load = () => void api.raid(planId).then((r) => { setData(r); onOpenChange(r.open); }).catch(() => setError("Couldn't load the risk log."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [planId]);
  const run = async (f: () => Promise<unknown>) => { setError(""); try { await f(); load(); return true; } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't save."); return false; } };
  const titles = useMemo(() => new Map(allTasks(plan).map((t) => [t.id, t.title])), [plan]);
  if (!data) return error ? <Notice tone="bad">{error}</Notice> : null;
  const shown = data.items.filter((x) => (kind === "all" || x.kind === kind) && (status === "all" || x.status === status) && (!cell || (x.kind === "risk" && x.likelihood === cell.l && x.impact === cell.i)));
  const pill = (on: boolean) => `min-h-10 rounded-full px-3 text-sm font-semibold ${on ? "bg-ink text-ground" : "bg-surface-2 text-ink-2 ring-1 ring-line"}`;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card aria-label="Risk log" className="flex flex-col gap-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-bold">Risks, assumptions, issues and decisions</h2>
          {data.canEdit && !adding && <Button onClick={() => setAdding(true)}>Add to the log</Button>}
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        {adding && <RaidForm titles={titles} people={people} onCancel={() => setAdding(false)} onSave={(v) => run(() => api.addRaid(planId, v)).then((ok) => ok && setAdding(false))} />}
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {(["all", "risk", "assumption", "issue", "decision"] as const).map((k) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)} className={pill(kind === k)}>{k === "all" ? "Everything" : KIND[k].plural}</button>)}
          <span aria-hidden className="mx-1 w-px self-stretch bg-line" />
          {(["open", "closed", "all"] as const).map((s) => <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)} className={pill(status === s)}>{s === "open" ? "Open" : s === "closed" ? "Closed" : "Open and closed"}</button>)}
        </div>
        {cell && <Notice>Showing risks rated likelihood {cell.l}, impact {cell.i}. <button className="font-semibold underline" onClick={() => setCell(null)}>Show all</button></Notice>}
        {shown.length === 0 ? <p className="m-0 text-[15px] text-ink-2">{data.items.length === 0 ? "Nothing in the log yet. Add risks you see coming, assumptions the plan relies on, issues to solve and decisions made." : "Nothing matches."}</p> : (
          <ul className="m-0 flex list-none flex-col p-0">
            {shown.map((x) => <RaidRow key={x.id} x={x} today={today} titles={titles} people={people} canEdit={data.canEdit} run={run} planId={planId} />)}
          </ul>
        )}
      </Card>
      <HeatMap items={data.items} cell={cell} onCell={(c) => { setCell(c); setKind("all"); setStatus("open"); }} />
    </div>
  );
}

function RaidRow({ x, today, titles, people, canEdit, run, planId }: { x: RaidItem; today: string; titles: Map<string, string>; people: string[]; canEdit: boolean; run: (f: () => Promise<unknown>) => Promise<boolean>; planId: string }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const K = KIND[x.kind];
  const lv = x.kind === "risk" && x.likelihood && x.impact ? level(x.likelihood, x.impact) : null;
  const late = x.status === "open" && x.due && x.due < today;
  if (editing) return <li className="border-t border-line py-3"><RaidForm initial={x} titles={titles} people={people} onCancel={() => setEditing(false)} onSave={(v) => run(() => api.updateRaid(planId, x.id, v)).then((ok) => ok && setEditing(false))} /></li>;
  return (
    <li aria-label={`${K.word}: ${x.title}`} className={`flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0 ${x.status === "closed" ? "opacity-70" : ""}`}>
      <span className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-ink-2 ring-1 ring-line"><K.icon aria-hidden size={13} /> {K.word}</span>
        {lv && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${LEVEL[lv].cls}`}>{LEVEL[lv].word} · likelihood {x.likelihood} × impact {x.impact}</span>}
        {x.kind === "issue" && x.impact && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-ink-2">Impact {x.impact}</span>}
        {x.status === "closed" && <span className="rounded-full bg-good-soft px-2 py-0.5 text-xs font-bold text-good">Closed</span>}
        <strong className={`text-[15px] ${x.status === "closed" ? "line-through decoration-1" : ""}`}>{x.title}</strong>
      </span>
      {x.detail && <p className="m-0 text-[15px] whitespace-pre-wrap text-ink-2">{x.detail}</p>}
      <span className="text-sm text-muted">{[x.owner && `Owner ${x.owner}`, x.due && `Due ${shortDate(x.due)}`, x.taskIds.length ? `About ${x.taskIds.map((t) => titles.get(t) ?? t).join(", ")}` : null, `Added by ${x.createdBy}`].filter(Boolean).join(" · ")}{late && <span className="ml-2 font-bold text-warn">Overdue</span>}</span>
      {canEdit && (confirm ? (
        <span className="flex flex-wrap items-center gap-2 text-sm">Delete this {K.word.toLowerCase()}? <Button variant="danger" onClick={() => void run(() => api.deleteRaid(planId, x.id))}>Delete</Button><Button variant="secondary" onClick={() => setConfirm(false)}>Keep it</Button></span>
      ) : (
        <span className="flex flex-wrap gap-3 text-sm">
          <button className="min-h-10 font-semibold text-primary-ink" onClick={() => void run(() => api.updateRaid(planId, x.id, { status: x.status === "open" ? "closed" : "open" }))}>{x.status === "open" ? (x.kind === "decision" ? "Mark as settled" : "Close") : "Reopen"}</button>
          <button className="min-h-10 font-semibold text-primary-ink" onClick={() => setEditing(true)}>Edit</button>
          <button className="min-h-10 font-semibold text-bad" onClick={() => setConfirm(true)}>Delete</button>
        </span>
      ))}
    </li>
  );
}

type FormValue = { kind: RaidKind; title: string; detail: string; owner: string | null; likelihood: number | null; impact: number | null; due: string | null; taskIds: string[] };

function RaidForm({ initial, titles, people, onSave, onCancel }: { initial?: RaidItem; titles: Map<string, string>; people: string[]; onSave: (v: FormValue) => void; onCancel: () => void }) {
  const [v, setV] = useState<FormValue>({ kind: initial?.kind ?? "risk", title: initial?.title ?? "", detail: initial?.detail ?? "", owner: initial?.owner ?? null, likelihood: initial?.likelihood ?? 3, impact: initial?.impact ?? 3, due: initial?.due ?? null, taskIds: initial?.taskIds ?? [] });
  const id = initial?.id ?? "new";
  const rated = v.kind === "risk" || v.kind === "issue";
  return (
    <form aria-label={initial ? "Edit item" : "Add to the log"} className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-3" onSubmit={(e) => { e.preventDefault(); if (v.title.trim()) onSave({ ...v, likelihood: v.kind === "risk" ? v.likelihood : null, impact: rated ? v.impact : null }); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Type<select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as RaidKind })} className={field}>{(Object.keys(KIND) as RaidKind[]).map((k) => <option key={k} value={k}>{KIND[k].word}</option>)}</select></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Owner<input list={`people-${id}`} value={v.owner ?? ""} onChange={(e) => setV({ ...v, owner: e.target.value || null })} className={field} /><datalist id={`people-${id}`}>{people.map((p) => <option key={p} value={p} />)}</datalist></label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Title<input required maxLength={200} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} className={field} /></label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">{v.kind === "risk" ? "What could happen, and what you'll do about it" : v.kind === "decision" ? "What was decided, and why" : "Details"}<textarea rows={2} maxLength={4000} value={v.detail} onChange={(e) => setV({ ...v, detail: e.target.value })} className="rounded-xl border border-line bg-surface p-3 text-base font-normal" /></label>
      <div className="grid gap-3 sm:grid-cols-3">
        {v.kind === "risk" && <label className="flex flex-col gap-1.5 text-sm font-semibold">Likelihood<select value={v.likelihood ?? 3} onChange={(e) => setV({ ...v, likelihood: Number(e.target.value) })} className={field}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}: {SCALE[n]}</option>)}</select></label>}
        {rated && <label className="flex flex-col gap-1.5 text-sm font-semibold">Impact<select value={v.impact ?? 3} onChange={(e) => setV({ ...v, impact: Number(e.target.value) })} className={field}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}: {IMPACT[n]}</option>)}</select></label>}
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Due<input type="date" value={v.due ?? ""} onChange={(e) => setV({ ...v, due: e.target.value || null })} className={field} /></label>
      </div>
      <details className="text-sm">
        <summary className="min-h-10 cursor-pointer content-center font-semibold">Linked tasks ({v.taskIds.length})</summary>
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto pt-1">
          {[...titles].map(([tid, title]) => (
            <label key={tid} className="flex min-h-10 items-center gap-2 text-[15px]"><input type="checkbox" className="h-5 w-5" checked={v.taskIds.includes(tid)} onChange={(e) => setV({ ...v, taskIds: e.target.checked ? [...v.taskIds, tid] : v.taskIds.filter((x) => x !== tid) })} /> {title}</label>
          ))}
        </div>
      </details>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!v.title.trim()}>{initial ? "Save" : "Add"}</Button><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}

/** Open risks by likelihood (across) and impact (up). Click a cell to see its risks. */
function HeatMap({ items, cell, onCell }: { items: RaidItem[]; cell: { l: number; i: number } | null; onCell: (c: { l: number; i: number } | null) => void }) {
  const open = items.filter((x) => x.kind === "risk" && x.status === "open" && x.likelihood && x.impact);
  const count = (l: number, i: number) => open.filter((x) => x.likelihood === l && x.impact === i).length;
  return (
    <Card aria-label="Risk heat map" className="flex flex-col gap-3 self-start">
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><Flag aria-hidden size={18} /> Open risks</h2>
      <p className="m-0 text-sm text-ink-2">Likelihood across, impact up. Each cell shows how many open risks sit there. Click one to see them.</p>
      <div className="flex gap-2">
        <span className="flex rotate-180 items-center text-xs font-semibold text-muted [writing-mode:vertical-rl]">Impact →</span>
        <div className="grid flex-1 grid-cols-5 gap-1">
          {[5, 4, 3, 2, 1].flatMap((i) => [1, 2, 3, 4, 5].map((l) => {
            const n = count(l, i);
            const lv = LEVEL[level(l, i)];
            const on = cell?.l === l && cell?.i === i;
            return (
              <button key={`${l}-${i}`} disabled={!n} onClick={() => onCell(on ? null : { l, i })} aria-pressed={on} aria-label={`Likelihood ${l}, impact ${i}: ${n} open risk${n === 1 ? "" : "s"}, ${lv.word.toLowerCase()}`}
                className={`flex aspect-square min-h-11 flex-col items-center justify-center rounded-lg text-sm font-bold ${lv.cls} ${n ? "ring-1 ring-current" : ""} ${on ? "ring-2 ring-ink" : ""}`}>
                <span className="text-base">{n || ""}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide">{lv.word[0]}</span>
              </button>
            );
          }))}
        </div>
      </div>
      <span className="pl-6 text-xs font-semibold text-muted">Likelihood →</span>
      <p className="m-0 text-xs text-muted">H high (likelihood × impact 15 or more), M medium (8 to 14), L low.</p>
    </Card>
  );
}
