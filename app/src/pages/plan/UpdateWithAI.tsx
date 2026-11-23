/**
 * "Update with my AI": hand the current plan to your assistant, paste its reply, review every
 * change (progress is never taken from the reply), apply the ones you accept.
 */
import { useMemo, useState } from "react";
import { ArrowLeft, Check, ClipboardCopy, Sparkles } from "lucide-react";
import { changesToOps, diffPlans, updatePrompt, whatChanged, type Plan, type UpdateChange } from "@ezplan/shared";
import { api } from "../../lib/api";
import { plural } from "../../lib/format";
import { useRouter } from "../../lib/router";
import { Button, Card, Notice } from "../../ui/kit";

const GROUPS: { title: string; kinds: UpdateChange["kind"][] }[] = [
  { title: "Plan", kinds: ["plan"] },
  { title: "New", kinds: ["addPhase", "addTask"] },
  { title: "Changed", kinds: ["renamePhase", "edit", "move"] },
  { title: "Removed", kinds: ["remove"] },
  { title: "For your information", kinds: ["status"] },
];

export function UpdateWithAI({ planId, plan, version }: { planId: string; plan: Plan; version: number }) {
  const { go } = useRouter();
  const [hide, setHide] = useState(false);
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState<"prompt" | "paste" | "review">("prompt");
  const [reply, setReply] = useState("");
  const [changes, setChanges] = useState<UpdateChange[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The prompt (and its name map) is fixed once copied, so the reply can be matched back.
  const made = useMemo(() => updatePrompt(plan, { hideNames: hide, versionTag: `v${version}` }), [hide]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    try { await navigator.clipboard.writeText(made.prompt); } catch { /* the box can be copied by hand */ }
    setCopied(true);
  };
  const review = async () => {
    setError("");
    setBusy(true);
    try {
      // The reply goes through the same checks as any import (format, safety) before comparing.
      const p = await api.preview(reply);
      const c = diffPlans(plan, p.plan, { nameMap: made.nameMap });
      setChanges(c);
      setNotes(whatChanged(reply));
      setOn(new Set(c.filter((x) => x.defaultOn && x.applicable).map((x) => x.key)));
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That reply couldn't be read.");
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    const ops = changesToOps(changes, on);
    if (!ops.length) return go(`/p/${planId}`);
    setBusy(true);
    try {
      await api.update(planId, ops);
      go(`/p/${planId}?updated=${ops.length}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't apply the changes. Try again.");
      setBusy(false);
    }
  };
  const toggle = (k: string) => { const n = new Set(on); if (n.has(k)) n.delete(k); else n.add(k); setOn(n); };
  const applicable = changes.filter((c) => c.applicable);

  return (
    <Card aria-label="Update with my AI" className="flex flex-col gap-4">
      <div className="flex items-center gap-2"><Sparkles aria-hidden className="text-primary" /><h2 className="m-0 text-lg font-bold">Update with my AI</h2></div>
      {error && <Notice tone="bad">{error}</Notice>}
      {step === "prompt" && (
        <>
          <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-[15px] leading-relaxed text-ink-2">
            <li>Copy this prompt. It contains your plan as it is now.</li>
            <li>Paste it into the chat where the new ideas came up, with any AI assistant.</li>
            <li>Bring the whole reply back here. You'll see every change before anything happens.</li>
          </ol>
          <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="checkbox" checked={hide} onChange={(e) => { setHide(e.target.checked); setCopied(false); }} className="h-5 w-5" /> Hide names and emails (they become "Owner A", "Owner B" and come back when you paste the reply)</label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">The prompt<textarea readOnly rows={8} value={made.prompt} className="rounded-xl border border-line bg-surface-2 p-3 font-mono text-[13px] font-normal" /></label>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => go(`/p/${planId}`)}><ArrowLeft aria-hidden size={18} /> Back to the plan</Button>
            <Button onClick={() => void copy()}>{copied ? <><Check aria-hidden size={18} /> Copied</> : <><ClipboardCopy aria-hidden size={18} /> Copy prompt</>}</Button>
            <Button variant="secondary" onClick={() => setStep("paste")}>I have the reply</Button>
          </div>
        </>
      )}
      {step === "paste" && (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Paste the assistant's whole reply<textarea rows={12} value={reply} onChange={(e) => setReply(e.target.value)} className="rounded-xl border border-line bg-surface p-3 font-mono text-[13px] font-normal" /></label>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setStep("prompt")}><ArrowLeft aria-hidden size={18} /> Back</Button>
            <Button onClick={() => void review()} disabled={!reply.trim() || busy}>{busy ? "Reading…" : "Show the changes"}</Button>
          </div>
        </>
      )}
      {step === "review" && (
        <>
          <p className="m-0 text-[15px]">{applicable.length ? `${plural(applicable.length, "change")} found. Untick anything you don't want.` : "The reply doesn't change anything in the plan."} Progress and "Done by" always stay as they are.</p>
          {notes.length > 0 && (
            <div className="rounded-xl bg-surface-2 p-3"><span className="text-sm font-bold">What your assistant says changed</span><ul className="m-0 mt-1 flex flex-col gap-1 pl-5 text-sm text-ink-2">{notes.map((n) => <li key={n}>{n}</li>)}</ul></div>
          )}
          {applicable.length > 1 && (
            <div className="flex gap-2"><Button variant="ghost" onClick={() => setOn(new Set(applicable.map((c) => c.key)))}>Tick all</Button><Button variant="ghost" onClick={() => setOn(new Set())}>Untick all</Button></div>
          )}
          {GROUPS.map((g) => {
            const items = changes.filter((c) => g.kinds.includes(c.kind));
            if (!items.length) return null;
            return (
              <fieldset key={g.title} className="m-0 flex flex-col gap-1 border-0 p-0">
                <legend className="mb-1 p-0 text-sm font-bold">{g.title}</legend>
                {items.map((c) => c.applicable ? (
                  <label key={c.key} className="flex min-h-11 items-start gap-3 rounded-xl px-2 py-2 text-[15px] hover:bg-surface-2"><input type="checkbox" checked={on.has(c.key)} onChange={() => toggle(c.key)} className="mt-0.5 h-5 w-5 shrink-0" /><span>{c.text}</span></label>
                ) : (
                  <p key={c.key} className="m-0 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">{c.text}</p>
                ))}
              </fieldset>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setStep("paste")}><ArrowLeft aria-hidden size={18} /> Back</Button>
            <Button onClick={() => void apply()} disabled={busy}>{busy ? "Applying…" : on.size ? `Apply ${plural(on.size, "change")}` : "Done, change nothing"}</Button>
          </div>
          <p className="m-0 text-sm text-muted">The plan as it is now is saved in Version history first, so you can go back.</p>
        </>
      )}
    </Card>
  );
}
