/** Your notifications, newest unread first, plus your tasks that are overdue or due soon. */
import { useEffect, useState } from "react";
import { AtSign, Bell, CalendarClock, LifeBuoy, MessageCircle, ShieldAlert, Sparkles, UserPlus, UserRoundCheck } from "lucide-react";
import { api, type Notifications as Data } from "../lib/api";
import { shortDate } from "../lib/format";
import { Link, useRouter } from "../lib/router";
import { Button, Card, Notice, PageTitle, Spinner } from "../ui/kit";

const ICON: Record<string, typeof Bell> = { mention: AtSign, comment: MessageCircle, assigned: UserRoundCheck, invited: UserPlus, "ai-low": Sparkles, "credit-request": Sparkles, "credit-answer": Sparkles, safety: ShieldAlert, support: LifeBuoy };
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function NotificationsPage({ onUnread }: { onUnread: (n: number) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const { go } = useRouter();
  const load = () => api.notifications().then((d) => { setData(d); onUnread(d.unread); }).catch(() => setError("Can't load notifications right now."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), []);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Spinner />;
  const open = async (n: Data["items"][number]) => {
    if (!n.read) onUnread((await api.markRead([n.id])).unread);
    go(n.link);
  };
  return (
    <>
      <PageTitle title="Notifications" actions={data.unread > 0 ? <Button variant="secondary" onClick={() => void api.markRead("all").then(load)}>Mark all read</Button> : undefined} />
      {data.due.length > 0 && (
        <Card aria-label="Your tasks due soon" className="flex flex-col gap-2">
          <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><CalendarClock aria-hidden size={20} /> Your tasks</h2>
          <ul className="m-0 flex list-none flex-col p-0">
            {data.due.map((d) => (
              <li key={`${d.planId}:${d.taskId}`} className="border-t border-line first:border-t-0">
                <Link to={`/p/${d.planId}/checklist?task=${encodeURIComponent(d.taskId)}`} className="flex min-h-11 flex-wrap items-center gap-x-2 py-2">
                  <span className="font-semibold">{d.title}</span>
                  <span className="text-sm text-muted">{d.planTitle}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${d.overdue ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2"}`}>{d.overdue ? `Overdue · was due ${shortDate(d.due)}` : `Due ${shortDate(d.due)}`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card aria-label="Notifications" className="flex flex-col gap-1">
        {data.items.length === 0 && <p className="m-0 text-sm text-muted">Nothing yet. Mentions, tasks given to you, invites and answers to your requests show up here.</p>}
        <ul className="m-0 flex list-none flex-col p-0">
          {data.items.map((n) => {
            const Icon = ICON[n.kind] ?? Bell;
            return (
              <li key={n.id} className="border-t border-line first:border-t-0">
                <button onClick={() => void open(n)} aria-label={`${n.read ? "" : "Unread: "}${n.text}`} className="flex min-h-11 w-full items-start gap-3 py-3 text-left">
                  <Icon aria-hidden size={18} className={`mt-0.5 shrink-0 ${n.read ? "text-muted" : "text-primary"}`} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={`text-[15px] ${n.read ? "text-ink-2" : "font-semibold"}`}>{n.text}</span>
                    <span className="text-xs text-muted">{when(n.createdAt)}</span>
                  </span>
                  {!n.read && <span aria-hidden className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
