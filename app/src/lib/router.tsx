/** A small router on the History API: the app has few screens, so no routing library. */
import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react";

const Ctx = createContext<{ path: string; go: (to: string, opts?: { replace?: boolean }) => void }>({ path: "/", go: () => {} });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => location.pathname + location.search);
  useEffect(() => {
    const on = () => setPath(location.pathname + location.search);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const go = (to: string, opts: { replace?: boolean } = {}) => {
    if (opts.replace) history.replaceState(null, "", to);
    else history.pushState(null, "", to);
    setPath(to);
    scrollTo(0, 0);
  };
  return <Ctx.Provider value={{ path, go }}>{children}</Ctx.Provider>;
}

export const useRouter = () => useContext(Ctx);

/** Matches "/p/:id/checklist" style patterns; returns the named parts or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const [pathname] = path.split("?");
  const a = pattern.split("/").filter(Boolean);
  const b = (pathname ?? "").split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(":")) out[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
    else if (a[i] !== b[i]) return null;
  }
  return out;
}

export function Link({ to, className, children, ...rest }: { to: string; className?: string; children: ReactNode; "aria-current"?: "page" | undefined }) {
  const { go } = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(to);
  };
  return (
    <a href={to} onClick={onClick} className={className} {...rest}>
      {children}
    </a>
  );
}
