import { useEffect, useState } from "react";
import { FolderKanban } from "lucide-react";
import { BRAND } from "@rakuplan/shared";
import { api } from "../lib/api";
import { Notice, Spinner } from "../ui/kit";

/** Sign-in: one button per sign-in service the server is set up with. No passwords here. */
export function SignIn() {
  const [providers, setProviders] = useState<{ id: string; label: string }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.providers().then((r) => setProviders(r.providers)).catch(() => setError("Can't reach the server right now. Check your connection and try again."));
  }, []);
  const returnTo = new URLSearchParams(location.search).get("returnTo") ?? (location.pathname === "/signin" ? "/" : location.pathname + location.search);
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-3xl bg-surface p-7 shadow-sm ring-1 ring-line">
        <div className="flex items-center gap-2">
          <FolderKanban aria-hidden className="text-primary" />
          <span className="text-lg font-bold">{BRAND.name}</span>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="m-0 text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="m-0 text-[15px] leading-relaxed text-muted">Use your usual account. No new password.</p>
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        {!providers && !error && <Spinner />}
        {providers && providers.length === 0 && <Notice tone="warn">Sign-in isn't set up on this server yet. Ask whoever runs it to add a sign-in service.</Notice>}
        <div className="flex flex-col gap-3">
          {providers?.map((p) => (
            <a key={p.id} href={`/auth/login?provider=${encodeURIComponent(p.id)}&returnTo=${encodeURIComponent(returnTo)}`} className="flex min-h-12 items-center justify-center rounded-xl bg-ink px-4 text-[15px] font-semibold text-ground hover:opacity-90">
              Sign in with {p.label}
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
