/**
 * Who wrote a message in a conversation with our team. Our team: the brand mark, the team name and
 * an "Official" badge, on a branded card. Customers: name, then role, company and email domain.
 * Used by support requests and safety cases (owner, Nov 24).
 */
import type { ReactNode } from "react";
import { BadgeCheck, FolderKanban } from "lucide-react";
import type { Who } from "../lib/api";

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The accessible name of a message: "Message from <brand> safety team (official)" or "Message from Alex Rivera, Manager at Northfield". */
export function whoLabel(w: Who): string {
  return w.kind === "team" ? `${w.team} (official)` : [w.name, [w.role, w.company && `at ${w.company}`].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function Message({ who, at, extra, children }: { who: Who; at: number; extra?: ReactNode; children: ReactNode }) {
  const team = who.kind === "team";
  return (
    <li aria-label={`Message from ${whoLabel(who)}`} className={`flex flex-col gap-1.5 rounded-xl p-3 ${team ? "border-2 border-primary bg-primary-soft" : "border border-line bg-surface-2"}`}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        {team ? (
          <>
            <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-nav text-indigo-300"><FolderKanban size={14} /></span>
            <strong className="text-sm text-primary-ink">{who.team}</strong>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-white dark:text-ground"><BadgeCheck aria-hidden size={12} /> Official</span>
            {who.person && <span>({who.person})</span>}
          </>
        ) : (
          <>
            <strong className="text-sm text-ink">{who.name}</strong>
            <span className="rounded-full bg-surface px-2 py-0.5 font-semibold text-ink-2 ring-1 ring-line">{who.role}</span>
            {who.company && <span className="font-semibold text-ink-2">{who.company}</span>}
            {who.domain && <span>{who.domain}</span>}
          </>
        )}
        <span>· {when(at)}</span>
        {extra}
      </span>
      {children}
    </li>
  );
}
