/** "Ask for more credits": a request to the people who manage AI credits for a workspace. */
import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { api, ApiError, type CreditRequest } from "../lib/api";
import { Button, Notice } from "../ui/kit";

export const numberInput = "h-11 w-20 rounded-xl border border-line bg-surface px-2 text-center font-semibold";

/** `offer` shows the button (when running low); answers to earlier requests show either way. */
export function AskForMore({ workspaceId, defaultOpen = false, offer = true }: { workspaceId: string; defaultOpen?: boolean; offer?: boolean }) {
  const [info, setInfo] = useState<{ approvers: string[]; requests: CreditRequest[] } | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [checks, setChecks] = useState("20");
  const [reports, setReports] = useState("0");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const load = () => void api.creditRequests(workspaceId).then(setInfo).catch(() => {});
  useEffect(load, [workspaceId]);
  const pending = info?.requests.find((r) => r.status === "pending");
  const last = info?.requests.find((r) => r.status !== "pending");
  const c = Number(checks);
  const r = Number(reports);
  const valid = Number.isInteger(c) && Number.isInteger(r) && c >= 0 && r >= 0 && c <= 500 && r <= 500 && c + r > 0;
  const who = info?.approvers.length ? info.approvers.join(" or ") : "a manager";

  const send = async () => {
    setError("");
    try {
      await api.askCredits(workspaceId, c, r, note);
      setOpen(false);
      setNote("");
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't send. Try again.");
    }
  };

  if (!info) return null;
  return (
    <div className="flex flex-col gap-2">
      {pending && <Notice>Asked for {describe(pending)}. Waiting for {who}.</Notice>}
      {!pending && last && last.decidedAt && Date.now() - last.decidedAt < 14 * 86_400_000 && (
        <Notice tone={last.status === "approved" ? "good" : "warn"}>
          {last.status === "approved" ? `${last.decidedBy} gave you ${describe(last)} more this month.` : `${last.decidedBy} declined your request for ${describe(last)}.`}
        </Notice>
      )}
      {!pending && !open && offer && <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>Ask for more credits</Button>}
      {!pending && open && (
        <form className="flex flex-col gap-3 rounded-xl border border-line p-3" onSubmit={(e) => { e.preventDefault(); if (valid) void send(); }} aria-label="Ask for more AI credits">
          <span className="text-sm">Your request goes to {who}.</span>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">AI checks <input inputMode="numeric" className={numberInput} value={checks} onChange={(e) => setChecks(e.target.value)} aria-invalid={!valid} /></label>
            <label className="flex items-center gap-2 text-sm">AI reports <input inputMode="numeric" className={numberInput} value={reports} onChange={(e) => setReports(e.target.value)} aria-invalid={!valid} /></label>
          </div>
          {!valid && <span className="text-sm text-bad">Ask for 1 to 500 checks or reports, in whole numbers.</span>}
          <label className="flex flex-col gap-1 text-sm">Why (optional)
            <textarea maxLength={500} rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="rounded-xl border border-line bg-surface p-2" placeholder="For example: planning the spring launch this week" />
          </label>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex gap-2">
            <Button type="submit" disabled={!valid}><Send aria-hidden size={16} /> Send request</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function describe(r: { checks: number; reports: number }) {
  const parts = [r.checks ? `${r.checks} AI check${r.checks === 1 ? "" : "s"}` : "", r.reports ? `${r.reports} AI report${r.reports === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.join(" and ");
}
