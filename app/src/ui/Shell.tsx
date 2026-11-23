/** Page frame: a side panel on desktop, a top bar and bottom tabs on phones. Same destinations on both. */
import type { ReactNode } from "react";
import { FolderKanban, Home, LogOut, Plus, Settings } from "lucide-react";
import { BRAND } from "@ezplan/shared";
import { Link, useRouter } from "../lib/router";
import type { Me } from "../lib/api";

const NAV = [
  { to: "/", label: "Home", Icon: Home },
  { to: "/new", label: "New plan", Icon: Plus },
  { to: "/settings", label: "Settings", Icon: Settings },
];

export function Shell({ me, onSignOut, children }: { me: Me; onSignOut: () => void; children: ReactNode }) {
  const { path } = useRouter();
  const current = (to: string) => (to === "/" ? path === "/" || path.startsWith("/p/") : path.startsWith(to));
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden w-60 shrink-0 flex-col gap-1 bg-nav px-3 py-5 text-nav-ink lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="flex items-center gap-2 px-3 pb-5">
          <FolderKanban aria-hidden className="text-indigo-300" />
          <span className="text-[17px] font-bold text-white">{BRAND.name}</span>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} aria-current={current(n.to) ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium ${current(n.to) ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`}>
              <n.Icon aria-hidden size={18} /> {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-white/10 px-3 pt-4">
          <span className="truncate text-sm text-slate-300">{me.user.name}</span>
          <button onClick={onSignOut} className="flex min-h-11 items-center gap-2 rounded-lg text-left text-sm font-medium text-slate-300 hover:text-white">
            <LogOut aria-hidden size={16} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(72px+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="sticky top-0 z-10 flex items-center gap-2 bg-nav px-4 py-3 text-white lg:hidden">
          <FolderKanban aria-hidden size={20} className="text-indigo-300" />
          <span className="font-bold">{BRAND.name}</span>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-8 lg:py-7">{children}</main>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} aria-current={current(n.to) ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold ${current(n.to) ? "text-primary" : "text-muted"}`}>
            <n.Icon aria-hidden size={22} /> {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
