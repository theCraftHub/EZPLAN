/** The owner's Operations page (step M5): the service's health at a glance; platform admins only. */
import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { api } from "../lib/api";
import { plural } from "../lib/format";
import { Card, Notice, PageTitle, Spinner } from "../ui/kit";

type Ops = Awaited<ReturnType<typeof api.ops>>;
const when = (at: number) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

function Tile({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: "warn" | "good" }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className={`text-[22px] font-bold tabular-nums ${tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : ""}`}>{value}</span>
      {note && <span className="text-sm text-ink-2">{note}</span>}
    </Card>
  );
}

export function OpsPage() {
  const [o, setO] = useState<Ops | null>(null);
  const [error, setError] = useState("");
  const load = () => api.ops().then(setO).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!o) return <Spinner label="Loading operations" />;
  const alerts = [
    ...(o.errors.last24h ? [`${plural(o.errors.last24h, "server error")} in the last 24 hours`] : []),
    ...(o.email.failed ? [`${plural(o.email.failed, "email")} failed to send this week`] : []),
    ...(o.companies.auditBroken.length ? [`Audit log changed for ${o.companies.auditBroken.map((b) => `${b.name} (entry ${b.at})`).join(", ")}`] : []),
    ...(!o.database.upToDate ? [`Database has ${o.database.migrations} of ${o.database.expected} updates`] : []),
    ...(o.queues.safety ? [`${plural(o.queues.safety, "plan")} waiting for safety review`] : []),
  ];
  return (
    <>
      <PageTitle title="Operations" sub={`As of ${when(o.at)}`} actions={<button onClick={() => void load()} className="min-h-11 rounded-xl border border-line bg-surface px-4 text-[15px] font-semibold">Refresh</button>} />
      {alerts.length ? <Notice tone="warn"><strong>Needs a look:</strong> {alerts.join(" · ")}</Notice> : <Notice tone="good">✓ Nothing needs a look right now.</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="People" value={o.people.total} note={`${o.people.active7} active this week · ${o.people.active30} this month${o.people.suspended ? ` · ${o.people.suspended} suspended` : ""}`} />
        <Tile label="Companies" value={o.companies.total} note={`${o.companies.live} live`} />
        <Tile label="Plans" value={o.plans.active} note={`active · ${o.plans.archived} archived · ${o.plans.changedToday} changed today`} />
        <Tile label={`AI this month (${o.ai.month})`} value={`$${o.ai.costUsd.toFixed(2)}`} note={`${plural(o.ai.calls, "request")} · ${(o.ai.inputTokens + o.ai.outputTokens).toLocaleString()} tokens`} />
        <Tile label="Email" value={o.email.sending ? "Sending" : "Not set up"} tone={o.email.sending ? "good" : undefined} note={`${o.email.waiting} waiting in the outbox · ${o.email.sent} sent and ${o.email.failed} failed this week`} />
        <Tile label="Queues" value={o.queues.safety + o.queues.support} note={`${o.queues.safety} safety review · ${o.queues.support} support`} tone={o.queues.safety ? "warn" : undefined} />
        <Tile label="Too many tries (today)" value={o.limits.refusedToday} note={Object.entries(o.limits.byRule).map(([k, v]) => `${k} ${v}`).join(" · ") || "No refusals"} />
        <Tile label="Database" value={o.database.upToDate ? "Up to date" : "Behind"} tone={o.database.upToDate ? "good" : "warn"} note={`${o.database.migrations} updates applied (latest ${o.database.latest})`} />
      </div>
      <div className="flex flex-wrap gap-3 text-[15px]">
        <Link to="/admin/safety" className="font-semibold text-primary-ink underline">Safety review queue</Link>
        <Link to="/admin/support" className="font-semibold text-primary-ink underline">Support inbox</Link>
      </div>
      <Card aria-label="Server errors" className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-bold">Server errors</h2>
        <p className="m-0 text-sm text-ink-2">Kept for 90 days, without request contents or personal data: the time, the route and a cleaned-up message.</p>
        {o.errors.byRoute.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" aria-label="Errors by route this week">
            {o.errors.byRoute.map((r) => <li key={r.method + r.route} className="flex justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2"><code>{r.method} {r.route}</code><span>{plural(r.n, "time")} · last {when(r.last)}</span></li>)}
          </ul>
        )}
        {o.errors.recent.length === 0 ? <p className="m-0 text-[15px] text-good">✓ No server errors.</p> : (
          <ol className="m-0 flex list-none flex-col gap-1 p-0 text-sm" aria-label="Latest errors">
            {o.errors.recent.map((e, i) => <li key={i} className="border-t border-line py-1.5 first:border-t-0"><span className="text-ink-2">{when(e.at)}</span> · <code>{e.method} {e.route}</code> · {e.name}: {e.message}</li>)}
          </ol>
        )}
      </Card>
    </>
  );
}
