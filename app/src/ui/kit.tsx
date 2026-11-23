/** Small building blocks shared by every screen. */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, PauseCircle, XCircle } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover dark:text-ground",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2",
  ghost: "bg-transparent text-ink-2 hover:bg-surface-2",
  danger: "bg-bad-soft text-bad border border-bad/30 hover:brightness-95",
};

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Card({ className = "", children, ...rest }: { className?: string; children: ReactNode; "aria-label"?: string }) {
  return (
    <section className={`rounded-2xl bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-line/60 ${className}`} {...rest}>
      {children}
    </section>
  );
}

const health: Record<string, { cls: string; Icon: typeof CheckCircle2 }> = {
  "On track": { cls: "bg-good-soft text-good", Icon: CheckCircle2 },
  "At risk": { cls: "bg-warn-soft text-warn", Icon: AlertTriangle },
  "Off track": { cls: "bg-bad-soft text-bad", Icon: XCircle },
  "On hold": { cls: "bg-surface-2 text-ink-2", Icon: PauseCircle },
  Complete: { cls: "bg-primary-soft text-primary-ink", Icon: CheckCircle2 },
};

/** Health always shows an icon and the word, never color alone. */
export function HealthChip({ value }: { value: string }) {
  const h = health[value] ?? { cls: "bg-surface-2 text-ink-2", Icon: CircleDot };
  return (
    <span className={`inline-flex items-center gap-1 self-start rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${h.cls}`}>
      <h.Icon aria-hidden size={14} strokeWidth={2.5} />
      {value}
    </span>
  );
}

export function ProgressRing({ percent, size = 56, label }: { percent: number; size?: number; label?: string }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={label ?? `${percent}% done`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} />
      </svg>
      <span className="absolute text-[13px] font-bold tabular-nums">{percent}%</span>
    </span>
  );
}

export function PageTitle({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="m-0 text-[26px] leading-tight font-bold tracking-tight">{title}</h1>
        {sub && <p className="m-0 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "good" | "warn" | "bad"; children: ReactNode }) {
  const cls = { info: "bg-primary-soft text-primary-ink", good: "bg-good-soft text-good", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad" }[tone];
  return <div role={tone === "bad" ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${cls}`}>{children}</div>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 p-6 text-sm text-muted">
      <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-primary" />
      {label}…
    </div>
  );
}
