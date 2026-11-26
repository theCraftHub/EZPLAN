/** Who has this plan, with which role; invite someone by a single-use link. */
import { useEffect, useState } from "react";
import { Check, ClipboardCopy, UserPlus } from "lucide-react";
import { planPeople, type Plan } from "@rakuplan/shared";
import { api, ROLE_NAME, type Me, type PlanRole, type Sharing } from "../../lib/api";
import { longDate } from "../../lib/format";
import { Button, Card, Notice, Spinner } from "../../ui/kit";

const ROLE_HELP = { editor: "Editor: updates tasks and the plan", commenter: "Commenter: sees everything and comments, changes nothing", viewer: "Viewer: sees everything, changes nothing" };

export function Share({ planId, plan, me }: { planId: string; plan: Plan; me: Me }) {
  const [data, setData] = useState<Sharing | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PlanRole>("editor");
  const [person, setPerson] = useState("");
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => void api.sharing(planId).then(setData).catch((e: Error) => setError(e.message));
  useEffect(load, [planId]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await api.invite(planId, email.trim(), role, person || undefined);
      setLink({ url: r.link, email: email.trim() });
      setCopied(false);
      setEmail("");
      setPerson("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make the invite.");
    } finally {
      setBusy(false);
    }
  };
  const act = async (fn: () => Promise<unknown>) => {
    setError("");
    try { await fn(); load(); } catch (e) { setError(e instanceof Error ? e.message : "That didn't work."); }
  };
  const names = planPeople(plan);
  if (!data) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <Card aria-label="People with access" className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-bold">People with access</h2>
        {error && <Notice tone="bad">{error}</Notice>}
        <ul className="m-0 flex list-none flex-col p-0">
          {data.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 first:border-t-0">
              <span className="flex min-w-0 flex-col"><span className="text-[15px] font-semibold">{m.name}{m.userId === me.user.id ? " (you)" : ""}</span><span className="truncate text-sm text-muted">{m.email}</span></span>
              {m.via === "workspace" ? (
                <span className="text-sm text-ink-2">{ROLE_NAME[m.role]} · workspace</span>
              ) : data.canShare ? (
                <span className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`role-${m.userId}`}>Role for {m.name}</label>
                  <select id={`role-${m.userId}`} value={m.role} onChange={(e) => void act(() => api.setRole(planId, m.userId, e.target.value as PlanRole))} className="min-h-11 rounded-xl border border-line bg-surface px-2 text-sm">
                    <option value="editor">Editor</option>
                    <option value="commenter">Commenter</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <Button variant="ghost" onClick={() => void act(() => api.removeMember(planId, m.userId))}>Remove {m.name}</Button>
                </span>
              ) : (
                <span className="text-sm text-ink-2">{ROLE_NAME[m.role]}</span>
              )}
            </li>
          ))}
        </ul>
        {data.invites.length > 0 && (
          <>
            <h3 className="m-0 mt-2 text-base font-bold">Waiting to accept</h3>
            <ul className="m-0 flex list-none flex-col p-0">
              {data.invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 first:border-t-0">
                  <span className="flex flex-col"><span className="text-[15px] font-semibold">{i.email}{i.personName ? ` (${i.personName})` : ""}</span><span className="text-sm text-muted">{ROLE_NAME[i.role]} · link works until {longDate(new Date(i.expiresAt).toISOString().slice(0, 10))}</span></span>
                  {data.canShare && <Button variant="ghost" onClick={() => void act(() => api.cancelInvite(planId, i.id))}>Cancel invite</Button>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {data.canShare ? (
        <Card aria-label="Invite someone" className="flex flex-col gap-3">
          <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><UserPlus aria-hidden size={20} /> Invite someone</h2>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Their email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal" /></label>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 p-0 text-sm font-semibold">Role</legend>
            {(["editor", "commenter", "viewer"] as const).map((r) => (
              <label key={r} className="flex min-h-11 items-center gap-3 text-[15px]"><input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} className="h-5 w-5" /> {ROLE_HELP[r]}</label>
            ))}
          </fieldset>
          {names.length > 0 && (
            <label className="flex flex-col gap-1.5 text-sm font-semibold">They are this person on the plan (optional)
              <select value={person} onChange={(e) => setPerson(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-2 text-base font-normal">
                <option value="">Not on the plan yet</option>
                {names.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          <Button onClick={() => void send()} disabled={!email.trim() || busy}>{busy ? "Making the link…" : "Make invite link"}</Button>
          {link && (
            <div className="flex flex-col gap-2 rounded-xl bg-good-soft p-3 text-good" role="status">
              <span className="text-sm font-bold">Invite link for {link.email}</span>
              <input readOnly value={link.url} aria-label="Invite link" className="min-h-11 rounded-lg border border-good/30 bg-surface px-2 font-mono text-xs text-ink" />
              <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(link.url).then(() => setCopied(true)).catch(() => {})}>{copied ? <><Check aria-hidden size={18} /> Copied</> : <><ClipboardCopy aria-hidden size={18} /> Copy link</>}</Button>
              <span className="text-sm">Send it to them yourself (email or chat). It works once, only for {link.email}, for 7 days. You'll only see it now.</span>
            </div>
          )}
        </Card>
      ) : (
        <Card><p className="m-0 text-[15px] text-ink-2">You were invited to this plan, so you can't invite others. Ask the plan's owner.</p></Card>
      )}
    </div>
  );
}
