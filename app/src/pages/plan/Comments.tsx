/** A task's comments: read by everyone on the plan; written by editors and commenters. */
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { api, ApiError, type TaskComments } from "../../lib/api";
import { Button, Notice } from "../../ui/kit";
import { usePlanCtx } from "./PlanContext";

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The "@na" being typed at the end of the text, if any. */
function typingMention(text: string): string | null {
  const m = /(?:^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/.exec(text);
  return m ? m[1]! : null;
}

export function Comments({ taskId, title }: { taskId: string; title: string }) {
  const { planId, tick } = usePlanCtx();
  const [data, setData] = useState<TaskComments | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const load = () => void api.comments(planId, taskId).then(setData).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [planId, taskId, tick]);

  const run = async (f: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try { await f(); load(); return true; } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't save. Try again."); return false; } finally { setBusy(false); }
  };
  const partial = typingMention(text);
  const suggestions = partial === null || !data ? [] : data.people.filter((p) => p.toLowerCase().startsWith(partial.toLowerCase()) && p.toLowerCase() !== partial.toLowerCase()).slice(0, 5);
  const pick = (name: string) => {
    setText((t) => t.replace(/@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/, `@${name} `));
    box.current?.focus();
  };

  if (!data) return null;
  return (
    <section aria-label="Comments" className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="m-0 text-base font-bold">Comments{data.comments.length ? ` (${data.comments.filter((c) => !c.deleted).length})` : ""}</h3>
      {data.comments.length === 0 && <p className="m-0 text-sm text-muted">No comments yet.</p>}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {data.comments.map((c) => (
          <li key={c.id} aria-label={`Comment by ${c.author}`} className="flex flex-col gap-1 rounded-xl bg-surface-2 p-3">
            <span className="text-xs text-muted"><strong className="text-ink-2">{c.author}</strong> · {when(c.createdAt)}{c.editedAt ? " · edited" : ""}</span>
            {c.deleted ? <span className="text-sm text-muted italic">Comment deleted</span> : editing?.id === c.id ? (
              <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => api.editComment(planId, taskId, c.id, editing.text)).then((ok) => ok && setEditing(null)); }}>
                <label className="sr-only" htmlFor={`edit-${c.id}`}>Edit your comment</label>
                <textarea id={`edit-${c.id}`} rows={3} value={editing.text} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} className="rounded-xl border border-line bg-surface p-2 text-[15px]" />
                <span className="flex gap-2"><Button type="submit" disabled={busy}>Save</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></span>
              </form>
            ) : (
              <p className="m-0 text-[15px] break-words whitespace-pre-wrap">{c.body}</p>
            )}
            {!c.deleted && editing?.id !== c.id && (c.canEdit || c.canDelete) && (
              <span className="flex gap-3 text-sm">
                {c.canEdit && <button className="min-h-9 font-semibold text-primary-ink" onClick={() => setEditing({ id: c.id, text: c.body ?? "" })}>Edit</button>}
                {c.canDelete && <button className="min-h-9 font-semibold text-bad" onClick={() => void run(() => api.deleteComment(planId, taskId, c.id))}>Delete</button>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && <Notice tone="bad">{error}</Notice>}
      {data.canComment ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void run(() => api.addComment(planId, taskId, text)).then((ok) => ok && setText("")); }}>
          <label className="text-sm font-semibold" htmlFor={`new-comment-${taskId}`}>Add a comment</label>
          <textarea ref={box} id={`new-comment-${taskId}`} rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Ask or note something about ${title}. Type @ to mention someone.`} className="rounded-xl border border-line bg-surface p-2 text-[15px]" />
          {suggestions.length > 0 && (
            <div role="listbox" aria-label="People to mention" className="flex flex-wrap gap-2">
              {suggestions.map((p) => <button key={p} type="button" role="option" aria-selected={false} onClick={() => pick(p)} className="min-h-9 rounded-full bg-primary-soft px-3 text-sm font-semibold text-primary-ink">@{p}</button>)}
            </div>
          )}
          <Button type="submit" className="self-start" disabled={busy || !text.trim()}><Send aria-hidden size={16} /> Post comment</Button>
        </form>
      ) : (
        <p className="m-0 text-sm text-muted">You can read comments on this plan but not add them.</p>
      )}
    </section>
  );
}
