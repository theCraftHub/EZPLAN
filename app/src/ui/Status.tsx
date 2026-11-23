/** Task status: icon + word + color (never color alone). Tapping moves it to the next step. */
import { Check, Circle, CircleDashed, CircleSlash, Clock3 } from "lucide-react";
import type { TaskStatus } from "@ezplan/shared";

export const STATUS: Record<TaskStatus, { label: string; cls: string; Icon: typeof Check }> = {
  todo: { label: "To do", cls: "bg-surface-2 text-ink-2 ring-line", Icon: Circle },
  progress: { label: "Doing", cls: "bg-primary-soft text-primary-ink ring-primary/30", Icon: Clock3 },
  done: { label: "Done", cls: "bg-good-soft text-good ring-good/30", Icon: Check },
  skipped: { label: "Skipped", cls: "bg-surface-2 text-muted ring-line", Icon: CircleSlash },
};

const NEXT: Record<TaskStatus, TaskStatus> = { todo: "progress", progress: "done", done: "todo", skipped: "todo" };

export function StatusButton({ status, title, disabled, onChange }: { status: TaskStatus; title: string; disabled?: boolean; onChange: (s: TaskStatus) => void }) {
  const s = STATUS[status];
  const next = STATUS[NEXT[status]].label;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(NEXT[status])}
      aria-label={`${title}: ${s.label}. Mark as ${next}`}
      className={`inline-flex min-h-11 min-w-[5.5rem] shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-bold ring-1 transition-colors disabled:cursor-default ${s.cls}`}
    >
      <s.Icon aria-hidden size={16} strokeWidth={2.5} />
      {s.label}
    </button>
  );
}

export function MilestoneMark() {
  return <CircleDashed aria-hidden size={16} className="text-primary" />;
}
