/**
 * Plan Check: the free checks plus the AI check. Every suggestion can be accepted or dismissed;
 * "Don't suggest this on this project again" remembers a dismissal for the project (the server
 * enforces it, even when the AI rewords the same idea).
 */
import { useEffect, useState } from "react";
import { EyeOff, ShieldAlert, Sparkles } from "lucide-react";
import { isSuppressed, nextTaskId, type Op, type Plan, type SuggestionKind, type Task } from "@ezplan/shared";
import { api, type AiState } from "../../lib/api";
import { plural } from "../../lib/format";
import { Button, Card, Notice } from "../../ui/kit";
import { AskForMore } from "../AskCredits";
import type { usePlanMath } from "./math";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;

interface Item {
  key: string;
  kind: SuggestionKind;
  text: string;
  why?: string;
  taskIds: string[];
  tone: "bad" | "warn" | "info";
  accept?: { label: string; run: () => void };
}

export function PlanCheck({ planId, plan, math, canEdit, edit }: { planId: string; plan: Plan; math: Math; canEdit: boolean; edit: (op: Op) => void }) {
  const [ai, setAi] = useState<AiState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [allTips, setAllTips] = useState(false);
  const load = () => void api.ai(planId).then(setAi).catch(() => {});
  useEffect(load, [planId]); // eslint-disable-line react-hooks/exhaustive-deps
  const suppressed = ai?.suppressions ?? [];

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      await api.aiCheck(planId);
      setGone(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "The AI check didn't work. Try again.");
    } finally {
      setBusy(false);
      load();
    }
  };
  const dismiss = async (it: Item, remember: boolean) => {
    setGone(new Set([...gone, it.key]));
    if (remember) {
      try {
        await api.suppress(planId, it.kind, it.text, it.taskIds);
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't remember that.");
      }
    }
  };
  const addStep = (title: string, afterTaskId: string | null, phaseId: string | null) => {
    const task: Task = { id: nextTaskId(plan), title, status: "todo", milestone: false, depends: [], notes: [], tags: [], subtasks: [], extra: {} };
    const phase = (afterTaskId && plan.phases.find((p) => p.tasks.some((t) => t.id === afterTaskId))) || plan.phases.find((p) => p.id === phaseId) || plan.phases.at(-1);
    if (!phase) return;
    edit({ kind: "addTask", phaseId: phase.id, task, ...(afterTaskId && phase.tasks.some((t) => t.id === afterTaskId) ? { afterId: afterTaskId } : {}) });
  };

  const free: Item[] = math.check.findings
    .map((f, i) => ({ key: `tip:${i}:${f.message}`, kind: "tip" as const, text: f.message, taskIds: f.taskIds, tone: f.severity === "problem" ? ("bad" as const) : f.severity === "warning" ? ("warn" as const) : ("info" as const) }))
    .filter((it) => !isSuppressed(it, suppressed));
  const r = ai?.review?.result;
  const aiItems: Item[] = r
    ? [
        ...r.missingSteps.map((m, i) => ({ key: `ms:${i}:${m.title}`, kind: "missingStep" as const, text: m.title, why: m.why, taskIds: m.afterTaskId ? [m.afterTaskId] : [], tone: "warn" as const, accept: { label: "Add this step", run: () => addStep(m.title, m.afterTaskId, m.phaseId) } })),
        ...r.risks.map((x, i) => ({ key: `rk:${i}:${x.title}`, kind: "risk" as const, text: x.title, why: x.mitigation, taskIds: x.taskIds, tone: "bad" as const })),
        ...r.suggestions.map((s, i) => ({ key: `sg:${i}:${s.change}`, kind: "suggestion" as const, text: `${s.taskId ? `${math.byId.get(s.taskId)?.title ?? s.taskId}: ` : ""}${s.change}`, why: s.why, taskIds: s.taskId ? [s.taskId] : [], tone: "info" as const })),
      ].filter((it) => !gone.has(it.key))
    : [];
  const left = ai ? ai.usage.checks.limit - ai.usage.checks.used : 0;

  return (
    <Card aria-label="Plan Check" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between"><h2 className="m-0 text-lg font-bold">Plan Check</h2><span className="text-sm font-bold text-good">{math.check.score} / 100</span></div>
      {free.filter((it) => !gone.has(it.key)).length === 0 && <p className="m-0 text-[15px] text-ink-2">No problems found.</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {free.filter((it) => !gone.has(it.key)).slice(0, allTips ? undefined : 3).map((it) => <Suggestion key={it.key} it={it} canEdit={canEdit} onDismiss={(rem) => void dismiss(it, rem)} />)}
      </ul>
      {!allTips && free.filter((it) => !gone.has(it.key)).length > 3 && (
        <button onClick={() => setAllTips(true)} className="min-h-10 self-start text-sm font-semibold text-primary-ink underline underline-offset-4">Show all {free.filter((it) => !gone.has(it.key)).length} checks</button>
      )}

      <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 flex items-center gap-1.5 text-base font-bold"><Sparkles aria-hidden size={18} className="text-primary" /> AI check</h3>
          {ai?.enabled && !ai.held && canEdit && (
            <Button variant="secondary" onClick={() => void run()} disabled={busy || left <= 0}>{busy ? "Checking…" : r ? "Run again" : "Run AI check"}</Button>
          )}
        </div>
        {ai && !ai.enabled && <p className="m-0 text-sm text-muted">AI checks are off on this server. The free checks above still run.</p>}
        {ai?.held && <Notice tone="warn"><span className="flex items-start gap-2"><ShieldAlert aria-hidden size={18} className="mt-0.5 shrink-0" />This plan is waiting for a safety review. AI features, sharing and exports are paused until then; everything else works.</span></Notice>}
        {error && <Notice tone="bad">{error}</Notice>}
        {ai?.enabled && <span className="text-xs text-muted">{left > 0 ? `${left} of ${ai.usage.checks.limit} AI checks left this month${left <= Math.ceil(ai.usage.checks.limit * 0.2) ? " (running low)" : ""}` : `No AI checks left this month (resets ${ai.usage.resets}).`}</span>}
        {ai?.enabled && canEdit && <AskForMore workspaceId={ai.workspaceId} offer={left <= Math.ceil(ai.usage.checks.limit * 0.2)} />}
        {ai?.review?.changedSince && <span className="text-xs font-semibold text-warn">The plan changed since this AI check.</span>}
        {r && (
          <>
            <p className="m-0 text-[15px]"><strong>{r.verdict === "ready" ? "Ready" : r.verdict === "risky" ? "Risky as planned" : "Needs some work"}.</strong> {r.summary} <span className="text-ink-2">Fit with the goal: {ai!.review!.result.goalFit.score}/100. {r.goalFit.comment}</span></p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="AI suggestions">
              {aiItems.map((it) => <Suggestion key={it.key} it={it} canEdit={canEdit} onAccept={it.accept ? () => { it.accept!.run(); setGone(new Set([...gone, it.key])); } : undefined} onDismiss={(rem) => void dismiss(it, rem)} />)}
            </ul>
            {aiItems.length === 0 && <p className="m-0 text-sm text-ink-2">Nothing left to look at.</p>}
            <span className="text-xs text-muted">Suggestions only: check permits, safety and legal requirements for your project.</span>
          </>
        )}
      </div>

      {suppressed.length > 0 && (
        <details className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
          <summary className="flex min-h-10 cursor-pointer items-center gap-1.5 font-semibold"><EyeOff aria-hidden size={16} /> Hidden suggestions ({suppressed.length})</summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-2 p-0">
            {suppressed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{s.text} <span className="text-muted">· hidden by {s.by}</span></span>
                {canEdit && <Button variant="ghost" onClick={() => void api.unsuppress(planId, s.id).then(load)}>Show again</Button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function Suggestion({ it, canEdit, onAccept, onDismiss }: { it: Item; canEdit: boolean; onAccept?: () => void; onDismiss: (remember: boolean) => void }) {
  const [remember, setRemember] = useState(false);
  const cls = { bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn", info: "bg-surface-2 text-ink-2" }[it.tone];
  return (
    <li className={`flex flex-col gap-2 rounded-xl px-3 py-2 text-sm leading-relaxed ${cls}`} aria-label={it.text}>
      <span><span className="font-semibold">{it.text}</span>{it.why ? <span> {it.why}</span> : null}</span>
      {canEdit && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {onAccept && <button onClick={onAccept} className="min-h-10 rounded-lg bg-surface px-3 font-semibold text-ink ring-1 ring-line">Add this step</button>}
          <button onClick={() => onDismiss(remember)} className="min-h-10 rounded-lg px-1 font-semibold underline underline-offset-4">Dismiss</button>
          <label className="flex min-h-10 items-center gap-1.5 text-xs"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" /> Don't suggest this on this project again</label>
        </span>
      )}
    </li>
  );
}
