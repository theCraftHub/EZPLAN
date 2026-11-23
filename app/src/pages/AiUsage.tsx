/** Your AI allowance this month, per workspace. */
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { AskForMore } from "./AskCredits";
import { Link } from "../lib/router";
import type { Me } from "../lib/api";
import { api } from "../lib/api";
import { Card } from "../ui/kit";

type Usage = Awaited<ReturnType<typeof api.myAi>>;

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const low = pct >= 80;
  return (
    <div className="flex flex-col gap-1">
      <span className="flex justify-between text-sm"><span>{label}</span><span className={`font-semibold ${low ? "text-warn" : ""}`}>{used} of {limit} used{low && used < limit ? " · running low" : used >= limit ? " · none left" : ""}</span></span>
      <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} className="h-2.5 overflow-hidden rounded-full bg-line"><span className={`block h-full ${low ? "bg-warn" : "bg-primary"}`} style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

export function AiUsageCard({ me }: { me: Me }) {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => void api.myAi().then(setU).catch(() => {}), []);
  if (!u) return null;
  return (
    <Card aria-label="AI usage" className="flex flex-col gap-4">
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><Sparkles aria-hidden size={20} className="text-primary" /> AI usage</h2>
      {!u.enabled && <p className="m-0 text-sm text-muted">AI features are off on this server. Free checks and plain reports still work.</p>}
      {u.enabled && u.workspaces.map((w) => (
        <div key={w.workspaceId} className="flex flex-col gap-3">
          {u.workspaces.length > 1 && <span className="text-sm font-bold">{w.name}</span>}
          <Meter label="AI checks this month" used={w.checks.used} limit={w.checks.limit} />
          <Meter label="AI reports this month" used={w.reports.used} limit={w.reports.limit} />
          {me.workspaces.find((x) => x.id === w.workspaceId)?.role === "manager" ? (
            <Link to={`/admin/ai/${w.workspaceId}`} className="self-start text-sm font-semibold text-primary underline">Manage AI credits and see spending</Link>
          ) : (
            <AskForMore workspaceId={w.workspaceId} defaultOpen={false} />
          )}
          <span className="text-sm text-muted">Resets on {new Date(`${w.resets}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" })}.</span>
        </div>
      ))}
    </Card>
  );
}
