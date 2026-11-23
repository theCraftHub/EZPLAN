import { useState } from "react";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { ApiError, type Me } from "../lib/api";
import { Button, Card, Notice, PageTitle } from "../ui/kit";
import { WorkWeekCard } from "./WorkWeek";
import { AiUsageCard } from "./AiUsage";
import { AdminLinks } from "./Safety";

/** Settings: the workspace's standard week, your account and sign-out. */
export function Settings({ me, onSignOut, onMe }: { me: Me; onSignOut: () => void; onMe: (m: Me) => void }) {
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const everywhere = async () => {
    const res = await fetch("/api/logout-everywhere", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!res.ok) return setMsg({ tone: "bad", text: new ApiError(res.status, "", null).status === 401 ? "You're already signed out." : "That didn't work. Try again." });
    location.assign("/");
  };
  return (
    <>
      <PageTitle title="Settings" />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <AiUsageCard me={me} />
      <AdminLinks manages={me.workspaces.filter((w) => w.role === "manager")} platformAdmin={!!me.platformAdmin} safetyOpen={me.safetyOpen ?? 0} />
      <WorkWeekCard me={me} onSaved={(w) => onMe({ ...me, workspaces: me.workspaces.map((x, i) => (i === 0 ? { ...x, work_week: w } : x)) })} />
      <Card aria-label="Your account" className="flex flex-col gap-4">
        <h2 className="m-0 text-lg font-bold">Your account</h2>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
          <dt className="text-muted">Name</dt><dd className="m-0 font-semibold">{me.user.name}</dd>
          <dt className="text-muted">Email</dt><dd className="m-0 font-semibold break-all">{me.user.email}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onSignOut}><LogOut aria-hidden size={18} /> Sign out</Button>
          <Button variant="secondary" onClick={() => void everywhere()}><MonitorSmartphone aria-hidden size={18} /> Sign out on every device</Button>
        </div>
      </Card>
    </>
  );
}
