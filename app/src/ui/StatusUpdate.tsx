/**
 * Status update pieces: the red / amber / green chip (icon + word + color, never color alone), the
 * gray "update overdue" marker, and the history list (step J1).
 */
import { CircleAlert, CircleCheck, CircleX, Clock } from "lucide-react";
import type { Rag, StatusUpdate, UpdateState } from "../lib/api";

export const RAG_STYLE: Record<Rag, string> = { green: "bg-good-soft text-good", amber: "bg-warn-soft text-warn", red: "bg-bad-soft text-bad" };
export const RAG_WORD: Record<Rag, string> = { green: "Green: on track", amber: "Amber: at risk", red: "Red: off track" };
const RAG_ICON = { green: CircleCheck, amber: CircleAlert, red: CircleX };
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function RagChip({ rag, short = false }: { rag: Rag; short?: boolean }) {
  const Icon = RAG_ICON[rag];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-bold ${RAG_STYLE[rag]}`}><Icon aria-hidden size={14} /> {short ? RAG_WORD[rag].split(":")[0] : RAG_WORD[rag]}</span>;
}

/** Gray marker when a status update is due (none in 7 days). */
export function UpdateOverdue({ state }: { state: UpdateState | undefined }) {
  if (!state?.overdue) return null;
  return <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-sm font-semibold text-muted ring-1 ring-line"><Clock aria-hidden size={14} /> Status update overdue</span>;
}

export function UpdateHistory({ items }: { items: StatusUpdate[] }) {
  if (items.length === 0) return <p className="m-0 text-[15px] text-ink-2">No status updates yet.</p>;
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {items.map((u) => (
        <li key={u.id} aria-label={`Status update from ${when(u.createdAt)}`} className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0">
          <span className="flex flex-wrap items-center gap-2"><RagChip rag={u.rag} short /><strong className="text-[15px]">{u.headline}</strong></span>
          <span className="text-sm text-muted">{u.author} · {when(u.createdAt)}{u.source === "ai" ? " · worded by AI from the plan's facts" : ""}</span>
          {u.sections.length > 0 && (
            <details className="text-[15px]">
              <summary className="min-h-10 cursor-pointer content-center text-sm font-semibold text-primary-ink">Show the full update</summary>
              <dl className="m-0 flex flex-col gap-2 pt-1">
                {u.sections.map((s, i) => <div key={i}><dt className="text-sm font-semibold text-ink-2">{s.title}</dt><dd className="m-0 whitespace-pre-wrap">{s.text}</dd></div>)}
              </dl>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
