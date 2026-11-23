/** The last few errors on this page, kept in memory only, so a support request can include them. */
const recent: string[] = [];

export function watchErrors() {
  const keep = (s: string) => {
    recent.push(s.slice(0, 300));
    if (recent.length > 10) recent.shift();
  };
  addEventListener("error", (e) => keep(String(e.message || e.error)));
  addEventListener("unhandledrejection", (e) => keep(`Unhandled: ${String((e.reason as Error)?.message ?? e.reason)}`));
}

export const recentErrors = () => [...recent];
