/** Page frame: a side panel on desktop, a top bar and bottom tabs on phones. Same destinations on both. */
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Activity, Bell, CircleHelp, Inbox, FolderKanban, Home, LogOut, Plus, Settings, ShieldAlert, Sparkles, ChartLine } from "lucide-react";
import { api } from "../lib/api";
import { BRAND } from "@rakuplan/shared";
import { Link, useRouter } from "../lib/router";
import type { Me } from "../lib/api";
import { ConsoleIcon, consoles } from "../pages/admin/OrgConsole";

const NAV = [
  { to: "/", label: "Home", Icon: Home },
  { to: "/new", label: "New plan", Icon: Plus },
  { to: "/settings", label: "Settings", Icon: Settings },
];

export function Shell({ me, onSignOut, onUnread, children }: { me: Me; onSignOut: () => void; onUnread: (n: number) => void; children: ReactNode }) {
  const { path } = useRouter();
  // The unread count: on every screen change, and every minute while the tab is visible.
  useEffect(() => {
    const check = () => { if (document.visibilityState === "visible") api.unreadCount().then((r) => onUnread(r.unread)).catch(() => {}); };
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  const unread = me.unread ?? 0;
  const bellLabel = unread ? `Notifications, ${unread} unread` : "Notifications";
  const badge = unread > 0 && <span className="ml-auto min-w-6 rounded-full bg-amber-300 px-1.5 text-center text-xs font-bold text-slate-900">{unread > 99 ? "99+" : unread}</span>;
  // Company workspaces are managed from their company's admin console; personal ones stay here.
  const manages = me.workspaces.filter((w) => w.role === "manager" && !w.org_id);
  const orgConsoles = consoles(me);
  const current = (to: string) => (to === "/" ? path === "/" || path.startsWith("/p/") : path.startsWith(to));
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden print:!hidden w-60 shrink-0 flex-col gap-1 bg-nav px-3 py-5 text-nav-ink lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="flex items-center gap-2 px-3 pb-5">
          <FolderKanban aria-hidden className="text-indigo-300" />
          <span className="text-[17px] font-bold text-white">{BRAND.name}</span>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          <Link to="/notifications" aria-label={bellLabel} aria-current={path.startsWith("/notifications") ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium ${path.startsWith("/notifications") ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`}>
            <Bell aria-hidden size={18} /> Notifications {badge}
          </Link>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} aria-current={current(n.to) ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium ${current(n.to) ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`}>
              <n.Icon aria-hidden size={18} /> {n.label}
            </Link>
          ))}
        </nav>
        {(manages.length > 0 || orgConsoles.length > 0 || me.platformAdmin) && (
          <nav aria-label="Admin" className="mt-5 flex flex-col gap-1">
            <span className="px-3 pb-1 text-xs font-bold tracking-wide text-slate-400 uppercase">Admin</span>
            {orgConsoles.map((o) => {
              const on = path.startsWith(`/admin/org/${o.id}`);
              return (
                <Link key={o.id} to={`/admin/org/${o.id}`} aria-current={on ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium ${on ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`}>
                  <ConsoleIcon aria-hidden size={18} /> <span className="truncate">{orgConsoles.length > 1 ? o.name : "Admin console"}</span>
                </Link>
              );
            })}
            {manages.flatMap((w) => {
              const on = path.startsWith(`/admin/ai/${w.id}`);
              const spend = on && path.startsWith(`/admin/ai/${w.id}/spending`);
              const suffix = manages.length > 1 ? ` · ${w.name}` : "";
              return [
                { to: `/admin/ai/${w.id}`, label: `AI credits${suffix}`, Icon: Sparkles, cur: on && !spend },
                { to: `/admin/ai/${w.id}/spending`, label: `AI spending${suffix}`, Icon: ChartLine, cur: spend },
              ].map((n) => (
                <Link key={n.to} to={n.to} aria-current={n.cur ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium ${n.cur ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`}>
                  <n.Icon aria-hidden size={18} /> <span className="truncate">{n.label}</span>
                </Link>
              ));
            })}
            {me.platformAdmin && (
              <Link to="/admin/ops" aria-current={path.startsWith("/admin/ops") ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium ${path.startsWith("/admin/ops") ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`}>
                <Activity aria-hidden size={18} /> Operations
              </Link>
            )}
            {me.platformAdmin && (
              <Link to="/admin/support" aria-current={path.startsWith("/admin/support") ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium ${path.startsWith("/admin/support") ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`}>
                <Inbox aria-hidden size={18} /> Support inbox
                {(me.supportOpen ?? 0) > 0 && <span className="ml-auto rounded-full bg-amber-300 px-2 text-xs font-bold text-slate-900" aria-label={`${me.supportOpen} open`}>{me.supportOpen}</span>}
              </Link>
            )}
            {me.platformAdmin && (
              <Link to="/admin/safety" aria-current={path.startsWith("/admin/safety") ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium ${path.startsWith("/admin/safety") ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`}>
                <ShieldAlert aria-hidden size={18} /> Safety review
                {(me.safetyOpen ?? 0) > 0 && <span className="ml-auto rounded-full bg-amber-300 px-2 text-xs font-bold text-slate-900" aria-label={`${me.safetyOpen} waiting`}>{me.safetyOpen}</span>}
              </Link>
            )}
          </nav>
        )}
        <div className="mt-auto flex flex-col gap-2 border-t border-white/10 px-3 pt-4">
          <Link to="/help" aria-current={path.startsWith("/help") ? "page" : undefined} className="flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white"><CircleHelp aria-hidden size={16} /> Help</Link>
          <span className="truncate text-sm text-slate-300">{me.user.name}</span>
          <button onClick={onSignOut} className="flex min-h-11 items-center gap-2 rounded-lg text-left text-sm font-medium text-slate-300 hover:text-white">
            <LogOut aria-hidden size={16} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(72px+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="sticky top-0 z-10 flex items-center gap-2 bg-nav px-4 py-3 text-white lg:hidden print:hidden">
          <FolderKanban aria-hidden size={20} className="text-indigo-300" />
          <span className="font-bold">{BRAND.name}</span>
          <Link to="/help" aria-label="Help" className="ml-auto flex h-11 w-11 items-center justify-center rounded-xl"><CircleHelp aria-hidden size={22} /></Link>
          <Link to="/notifications" aria-label={bellLabel} className="relative flex h-11 w-11 items-center justify-center rounded-xl">
            <Bell aria-hidden size={22} />
            {unread > 0 && <span aria-hidden className="absolute top-1 right-0.5 min-w-5 rounded-full bg-amber-300 px-1 text-center text-[11px] font-bold text-slate-900">{unread > 99 ? "99+" : unread}</span>}
          </Link>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-8 lg:py-7">{children}</main>
      </div>

      <nav aria-label="Main" className="fixed print:hidden inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} aria-current={current(n.to) ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold ${current(n.to) ? "text-primary" : "text-muted"}`}>
            <n.Icon aria-hidden size={22} /> {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
