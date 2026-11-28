/** The plan page header: title row, view picker, the top actions and "More". */
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowLeft, CalendarPlus, Check, ChevronDown, Download, FileText, History as HistoryIcon, MonitorPlay, MoreHorizontal, Printer, Sparkles, Users, Wifi, WifiOff, type LucideIcon } from "lucide-react";
import type { PlanDetail, UpdateState } from "../../lib/api";
import { Link, useRouter } from "../../lib/router";
import { HealthChip } from "../../ui/kit";
import { UpdateOverdue } from "../../ui/StatusUpdate";
import { PLAN_VIEWS, viewName } from "./planNav";

const OTHER_ICONS: Record<string, LucideIcon> = { update: Sparkles, report: FileText, history: HistoryIcon, share: Users, print: Printer };
const viewIcon = (view: string): LucideIcon => PLAN_VIEWS.find((v) => v.view === view)?.Icon ?? OTHER_ICONS[view] ?? PLAN_VIEWS[0]!.Icon;
const planPath = (id: string, view: string) => `/p/${id}${view ? `/${view}` : ""}`;

const base = "inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface text-sm font-semibold text-ink hover:bg-surface-2";
const btn = `${base} shrink-0`;
const menuBox = "z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-60 overflow-y-auto rounded-xl border border-line bg-surface p-1 text-ink shadow-lg print:hidden";
const item = "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-[15px] outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2";
const groupLabel = "px-3 pt-2 pb-1 text-xs font-bold text-muted";

/**
 * A menu item that navigates inside the app like `Link` (click and Enter both work).
 * Stopping the browser's own navigation also stops Radix from closing the menu, so `close` does it.
 */
function MenuLink({ to, close, children, ...rest }: { to: string; close: () => void; children: ReactNode; className?: string; "aria-label"?: string; "aria-describedby"?: string; "aria-current"?: "page"; textValue?: string }) {
  const { go } = useRouter();
  const { textValue, className = item, ...aria } = rest;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    close();
    go(to);
  };
  return (
    <Menu.Item asChild textValue={textValue}>
      <a href={to} onClick={onClick} className={className} {...aria}>{children}</a>
    </Menu.Item>
  );
}

/** Button showing the current view; opens the list of the plan's 8 views. */
export function ViewPicker({ id, view, compact = false }: { id: string; view: string; compact?: boolean }) {
  const name = viewName(view);
  const Icon = viewIcon(view);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Menu.Root modal={false} open={open} onOpenChange={setOpen}>
      <Menu.Trigger aria-label={`Plan view: ${name}`} title={`Plan view: ${name}`} className={`${base} min-w-0 px-3 text-[15px] data-[state=open]:bg-surface-2`}>
        <Icon aria-hidden size={16} className="shrink-0 text-primary-ink" />
        <span className="min-w-0 truncate">{name}</span>
        <ChevronDown aria-hidden size={16} className="shrink-0 text-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content aria-label="Plan views" align="start" sideOffset={6} collisionPadding={16} className={menuBox}>
          {PLAN_VIEWS.map((v) => {
            const on = v.view === view;
            const hint = `view-hint-${v.view || "overview"}`;
            return (
              <MenuLink key={v.label} to={planPath(id, v.view)} close={close} aria-label={v.label} aria-describedby={hint} aria-current={on ? "page" : undefined} textValue={v.label}>
                <v.Icon aria-hidden size={18} className="shrink-0 text-primary-ink" />
                <span className="flex min-w-0 flex-1 flex-col py-1.5 leading-tight">
                  <span className={on ? "font-bold" : "font-semibold"}>{v.label}</span>
                  <span id={hint} className="text-[13px] text-muted">{v.hint}</span>
                </span>
                {on && <Check aria-hidden size={16} className="shrink-0 text-primary-ink" />}
              </MenuLink>
            );
          })}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * The plan's actions: Update (editors), Share, Status report (desktop) and "More".
 * `compact` shows icons only (names stay as accessible names and tooltips), for a slim bar.
 */
export function ActionsRow({ id, canEdit, compact, onPresent, presentDisabled }: { id: string; canEdit: boolean; compact: boolean; onPresent: () => void; presentDisabled: boolean }) {
  const presented = useRef(false);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const pad = compact ? "justify-center w-11 px-0" : "px-2.5 lg:px-3";
  const label = (short: string, full = short) => (compact ? null : <><span className="lg:hidden">{short}</span><span className="hidden lg:inline">{full}</span></>);
  const tip = (name: string) => (compact ? name : undefined);
  return (
    <div role="group" aria-label="Plan actions" className="ml-auto flex shrink-0 items-center gap-1.5 lg:gap-2">
      {canEdit && <Link to={`/p/${id}/update`} aria-label="Update with my AI" title={tip("Update with my AI")} className={`${btn} ${pad} border-primary/40 text-primary-ink`}><Sparkles aria-hidden size={16} />{label("Update", "Update with my AI")}</Link>}
      <Link to={`/p/${id}/share`} aria-label="Share" title={tip("Share")} className={`${btn} ${pad}`}><Users aria-hidden size={16} />{label("Share")}</Link>
      {!compact && <Link to={`/p/${id}/report`} aria-label="Status report" className={`${btn} ${pad} max-lg:hidden`}><FileText aria-hidden size={16} />Report</Link>}
      <Menu.Root modal={false} open={open} onOpenChange={setOpen}>
        <Menu.Trigger aria-label="More plan actions" title="More plan actions" className={`${btn} w-11 justify-center px-0 data-[state=open]:bg-surface-2`}>
          <MoreHorizontal aria-hidden size={18} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" sideOffset={6} collisionPadding={16} className={menuBox}
            onCloseAutoFocus={(e) => { if (presented.current) { presented.current = false; e.preventDefault(); } }}>
            <Menu.Group>
              <Menu.Label className={groupLabel}>Share and report</Menu.Label>
              <MenuLink to={`/p/${id}/report`} close={close} className={`${item} ${compact ? "" : "lg:hidden"}`}><FileText aria-hidden size={18} className="shrink-0" />Status report</MenuLink>
              <Menu.Item className={item} disabled={presentDisabled} onSelect={() => { presented.current = true; onPresent(); }}><MonitorPlay aria-hidden size={18} className="shrink-0" />Present</Menu.Item>
              <MenuLink to={`/p/${id}/print`} close={close}><Printer aria-hidden size={18} className="shrink-0" />Print summary</MenuLink>
            </Menu.Group>
            <Menu.Separator className="my-1 h-px bg-line" />
            <Menu.Group>
              <Menu.Label className={groupLabel}>File</Menu.Label>
              <Menu.Item asChild className={item}><a href={`/api/plans/${id}/export`} download><Download aria-hidden size={18} className="shrink-0" />Download plan file</a></Menu.Item>
              <Menu.Item asChild className={item}><a href={`/api/plans/${id}/calendar.ics`} download><CalendarPlus aria-hidden size={18} className="shrink-0" />Add to calendar</a></Menu.Item>
            </Menu.Group>
            <Menu.Separator className="my-1 h-px bg-line" />
            <MenuLink to={`/p/${id}/history`} close={close}><HistoryIcon aria-hidden size={18} className="shrink-0" />History and Trash</MenuLink>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

function Connection({ status, pending }: { status: "live" | "offline" | "connecting"; pending: number }) {
  return (
    <span role="status" className={`inline-flex items-center gap-1.5 text-sm font-semibold ${status === "live" ? "text-good" : status === "offline" ? "text-warn" : "text-muted"}`}>
      {status === "offline" ? <WifiOff aria-hidden size={16} /> : <Wifi aria-hidden size={16} />}
      {status === "live" ? "Live" : status === "offline" ? (pending ? `Offline · ${pending} change${pending === 1 ? "" : "s"} will sync` : "Offline · changes will sync") : "Connecting…"}
    </span>
  );
}

function Presence({ others }: { others: { userId: string; name: string }[] }) {
  if (!others.length) return null;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-2" aria-label={`Also here: ${others.map((o) => o.name).join(", ")}`}>
      <span className="flex -space-x-2" aria-hidden>
        {others.slice(0, 4).map((o) => <span key={o.userId} title={o.name} className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-ink ring-2 ring-ground">{o.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>)}
      </span>
      <span>{others.length === 1 ? `${others[0]!.name} is here` : `${others.length} others here`}</span>
    </span>
  );
}

export function PlanHeader(p: { id: string; view: string; title: string; health: string; statusUpdate: UpdateState; master: PlanDetail["master"]; status: "live" | "offline" | "connecting"; pending: number; others: { userId: string; name: string }[]; canEdit: boolean; role: string; onPresent: () => void; presentDisabled: boolean }) {
  const m = p.master;
  const back = m?.canOpenMaster ? { to: `/m/${m.id}`, name: `${m.title}${m.isMaster ? "" : ` › ${p.title}`}` } : { to: "/", name: "All plans" };
  return (
    <header className="flex flex-col gap-3 print:hidden">
      <div className="flex items-start gap-1.5">
        <Link to={back.to} aria-label={back.name} title={back.name} className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink"><ArrowLeft aria-hidden size={20} /></Link>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
          <h1 className="m-0 min-w-0 text-[22px] leading-tight font-bold tracking-tight [overflow-wrap:anywhere] lg:text-[26px]">{p.title}</h1>
          <HealthChip value={p.health} />
          <UpdateOverdue state={p.statusUpdate} />
          <Connection status={p.status} pending={p.pending} />
          <Presence others={p.others} />
          {!p.canEdit && <span className="text-sm font-semibold text-ink-2">{p.role === "commenter" ? "Can comment" : "View only"}</span>}
        </div>
      </div>
      {m && <span className="self-start rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary-ink">{m.isMaster ? `Whole-building tasks of the master plan ${m.title}` : `Part of the master plan ${m.title}`}</span>}
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <ViewPicker id={p.id} view={p.view} />
        <ActionsRow id={p.id} canEdit={p.canEdit} compact={false} onPresent={p.onPresent} presentDisabled={p.presentDisabled} />
      </div>
    </header>
  );
}
