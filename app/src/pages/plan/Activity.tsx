/** Everything that happened on the plan, newest first, grouped by day. Written by the server. */
import { useEffect, useMemo, useState } from "react";
import { api, type ActivityItem } from "../../lib/api";
import { Button, Card, Notice, Spinner } from "../../ui/kit";
import { usePlanCtx } from "./PlanContext";

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function useActivity(planId: string, tick = 0) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");
  const loaded = items !== null;
  useEffect(() => {
    // First load at once; later reloads wait a moment so a burst of edits makes one request.
    const timer = setTimeout(() => {
      api.activity(planId).then((r) => { setItems(r.items); setMore(r.items.length === 50); }).catch(() => setError("Can't load activity right now."));
    }, loaded ? 800 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, tick]);
  const older = async () => {
    const last = items?.at(-1);
    if (!last) return;
    const r = await api.activity(planId, last.at);
    setItems([...(items ?? []), ...r.items]);
    setMore(r.items.length === 50);
  };
  return { items, more, older, error };
}

export function Activity({ version }: { version: number }) {
  const { planId, tick } = usePlanCtx();
  // Reload when the plan or its comments change (debounced by React's batching; cheap query).
  const { items, more, older, error } = useActivity(planId, version + tick);
  const [who, setWho] = useState("");
  const people = useMemo(() => [...new Set((items ?? []).map((i) => i.actor))].sort(), [items]);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!items) return <Spinner label="Loading activity" />;
  const shown = who ? items.filter((i) => i.actor === who) : items;
  const groups: [string, ActivityItem[]][] = [];
  for (const i of shown) {
    const d = day(i.at);
    if (groups.at(-1)?.[0] !== d) groups.push([d, []]);
    groups.at(-1)![1].push(i);
  }
  return (
    <Card aria-label="Activity" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-bold">Activity</h2>
        {people.length > 1 && (
          <label className="flex items-center gap-2 text-sm">Show
            <select value={who} onChange={(e) => setWho(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-2">
              <option value="">Everyone</option>
              {people.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
      </div>
      {shown.length === 0 && <p className="m-0 text-sm text-muted">Nothing yet. Changes and comments show up here.</p>}
      {groups.map(([d, list]) => (
        <section key={d} aria-label={d} className="flex flex-col gap-1">
          <h3 className="m-0 text-sm font-bold text-muted">{d}</h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {list.map((i) => <li key={i.id} className="flex gap-3 border-t border-line py-2 text-[15px] first:border-t-0"><span className="w-16 shrink-0 text-sm text-muted tabular-nums">{time(i.at)}</span><span>{i.summary}</span></li>)}
          </ul>
        </section>
      ))}
      {more && <Button variant="secondary" className="self-start" onClick={() => void older()}>Show older</Button>}
    </Card>
  );
}

/** The last few lines, for the Overview. */
export function RecentActivity({ version }: { version: number }) {
  const { planId, tick } = usePlanCtx();
  const { items } = useActivity(planId, version + tick);
  if (!items || items.length === 0) return null;
  return (
    <Card aria-label="Recent activity" className="flex flex-col gap-2">
      <h2 className="m-0 text-lg font-bold">Recent activity</h2>
      <ul className="m-0 flex list-none flex-col p-0 text-[15px]">
        {items.slice(0, 5).map((i) => <li key={i.id} className="border-t border-line py-2 first:border-t-0">{i.summary} <span className="text-sm text-muted">· {time(i.at)}</span></li>)}
      </ul>
    </Card>
  );
}
