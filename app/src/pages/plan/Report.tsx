/**
 * Status report: built from the plan's facts; AI (optional) only rewords them. Edit, then copy or
 * post it as a status update (red / amber / green), which goes into the plan's history (step J1).
 */
import { useEffect, useState } from "react";
import { Check, ClipboardCopy, FileText, History, Send } from "lucide-react";
import type { ReportText, StatusFacts } from "@ezplan/shared";
import { api, ApiError, type Rag, type StatusUpdate } from "../../lib/api";
import { Button, Card, Notice } from "../../ui/kit";
import { RAG_STYLE, RAG_WORD, RagChip, UpdateHistory, UpdateOverdue } from "../../ui/StatusUpdate";

export function Report({ planId, today, canEdit, onPosted }: { planId: string; today: string; canEdit: boolean; onPosted?: () => void }) {
  const [history, setHistory] = useState<{ items: StatusUpdate[]; overdue: boolean; dueEveryDays: number } | null>(null);
  const loadHistory = () => void api.statusUpdates(planId).then(setHistory).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadHistory, [planId]);
  return (
    <div className="flex flex-col gap-4">
      <Writer planId={planId} today={today} canEdit={canEdit} onPosted={() => { loadHistory(); onPosted?.(); }} />
      <Card aria-label="Status updates" className="flex flex-col gap-2">
        <h2 className="m-0 flex flex-wrap items-center gap-2 text-lg font-bold"><History aria-hidden size={20} /> Status updates <UpdateOverdue state={history ? { last: null, overdue: history.overdue } : undefined} /></h2>
        {history?.overdue && <p className="m-0 text-sm text-muted">It's been more than {history.dueEveryDays} days since the last update. Write the report above and post it.</p>}
        {history && <UpdateHistory items={history.items} />}
      </Card>
    </div>
  );
}

function Writer({ planId, today, canEdit, onPosted }: { planId: string; today: string; canEdit: boolean; onPosted: () => void }) {
  const [rag, setRag] = useState<Rag | null>(null);
  const [posted, setPosted] = useState(false);
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const [since, setSince] = useState(weekAgo);
  const [useAi, setUseAi] = useState(false);
  const [out, setOut] = useState<{ facts: StatusFacts; text: ReportText; source: "ai" | "template"; note?: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const make = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.report(planId, useAi, since);
      setOut(r);
      setRag(r.facts.rag);
      setPosted(false);
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make the report.");
    } finally {
      setBusy(false);
    }
  };
  const setSection = (i: number, text: string) => out && setOut({ ...out, text: { ...out.text, sections: out.text.sections.map((s, j) => (j === i ? { ...s, text } : s)) } });
  const post = async () => {
    if (!out || !rag) return;
    setBusy(true);
    setError("");
    try {
      await api.postStatusUpdate(planId, { rag, headline: out.text.headline, sections: out.text.sections.map((s) => ({ title: s.title, text: s.text })), source: out.source });
      setPosted(true);
      onPosted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't post the update.");
    } finally {
      setBusy(false);
    }
  };
  const plain = out ? [out.text.headline, "", ...out.text.sections.flatMap((s) => [s.title, s.text, ""])].join("\n").trim() : "";
  return (
    <Card aria-label="Status report" className="flex flex-col gap-4">
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><FileText aria-hidden size={20} /> Status report</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">What happened since<input type="date" value={since} max={today} onChange={(e) => setSince(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal" /></label>
        {canEdit && <label className="flex min-h-11 items-center gap-2 text-[15px]"><input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} className="h-5 w-5" /> Word it with AI (uses 1 AI report)</label>}
        <Button onClick={() => void make()} disabled={busy}>{busy ? "Writing…" : out ? "Write again" : "Write the report"}</Button>
      </div>
      <p className="m-0 text-sm text-muted">The facts always come from the plan. AI only rewords them, and if it adds a number that isn't in the plan, the plain version is used.</p>
      {error && <Notice tone="bad">{error}</Notice>}
      {out && (
        <>
          {out.note && <Notice tone="info">{out.note}</Notice>}
          <div className="flex flex-wrap items-center gap-2">
            <RagChip rag={out.facts.rag} />
            <span className="text-sm text-muted">Suggested from the plan · {out.source === "ai" ? "worded by AI from the plan's facts" : "written from the plan's facts"}</span>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Headline<input value={out.text.headline} onChange={(e) => setOut({ ...out, text: { ...out.text, headline: e.target.value } })} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal" /></label>
          {out.text.sections.map((s, i) => (
            <label key={`${s.title}-${i}`} className="flex flex-col gap-1.5 text-sm font-semibold">{s.title}<textarea rows={2} value={s.text} onChange={(e) => setSection(i, e.target.value)} className="rounded-xl border border-line bg-surface p-3 text-base font-normal" /></label>
          ))}
          {canEdit && (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1.5 text-sm font-semibold">Status for this update</legend>
              <div className="flex flex-wrap gap-2">
                {(["green", "amber", "red"] as const).map((r) => (
                  <label key={r} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-[15px] font-semibold ${rag === r ? `${RAG_STYLE[r]} ring-2 ring-current` : "bg-surface-2 text-ink-2"}`}>
                    <input type="radio" name="rag" value={r} checked={rag === r} onChange={() => setRag(r)} className="h-4 w-4" /> {RAG_WORD[r]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            {canEdit && <Button onClick={() => void post()} disabled={busy || posted || !out.text.headline.trim()}>{posted ? <><Check aria-hidden size={18} /> Posted</> : <><Send aria-hidden size={18} /> Post as a status update</>}</Button>}
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(plain).then(() => setCopied(true)).catch(() => {})}>{copied ? <><Check aria-hidden size={18} /> Copied</> : <><ClipboardCopy aria-hidden size={18} /> Copy the report</>}</Button>
          </div>
          {posted && <Notice tone="good">Posted. Everyone on the plan was told, and it's in the history below.</Notice>}
        </>
      )}
    </Card>
  );
}
