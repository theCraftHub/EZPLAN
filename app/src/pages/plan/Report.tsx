/** Status report: built from the plan's facts; AI (optional) only rewords them. Edit, then copy. */
import { useState } from "react";
import { Check, ClipboardCopy, FileText } from "lucide-react";
import type { ReportText, StatusFacts } from "@rakuplan/shared";
import { api } from "../../lib/api";
import { Button, Card, Notice } from "../../ui/kit";

const RAG = { green: "bg-good-soft text-good", amber: "bg-warn-soft text-warn", red: "bg-bad-soft text-bad" };
const RAG_WORD = { green: "Green: on track", amber: "Amber: at risk", red: "Red: off track" };

export function Report({ planId, today, canEdit }: { planId: string; today: string; canEdit: boolean }) {
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
      setOut(await api.report(planId, useAi, since));
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make the report.");
    } finally {
      setBusy(false);
    }
  };
  const setSection = (i: number, text: string) => out && setOut({ ...out, text: { ...out.text, sections: out.text.sections.map((s, j) => (j === i ? { ...s, text } : s)) } });
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
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${RAG[out.facts.rag]}`}>{RAG_WORD[out.facts.rag]}</span>
            <span className="text-sm text-muted">{out.source === "ai" ? "Worded by AI from the plan's facts" : "Written from the plan's facts"}</span>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Headline<input value={out.text.headline} onChange={(e) => setOut({ ...out, text: { ...out.text, headline: e.target.value } })} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal" /></label>
          {out.text.sections.map((s, i) => (
            <label key={`${s.title}-${i}`} className="flex flex-col gap-1.5 text-sm font-semibold">{s.title}<textarea rows={2} value={s.text} onChange={(e) => setSection(i, e.target.value)} className="rounded-xl border border-line bg-surface p-3 text-base font-normal" /></label>
          ))}
          <Button variant="secondary" className="self-start" onClick={() => void navigator.clipboard.writeText(plain).then(() => setCopied(true)).catch(() => {})}>{copied ? <><Check aria-hidden size={18} /> Copied</> : <><ClipboardCopy aria-hidden size={18} /> Copy the report</>}</Button>
        </>
      )}
    </Card>
  );
}
