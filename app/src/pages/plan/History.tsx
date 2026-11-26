/** Version history (restore any saved version) and Trash (bring deleted tasks back). */
import { useEffect, useState } from "react";
import { History as HistoryIcon, Trash2 } from "lucide-react";
import { diffPlans, type Op, type Plan } from "@rakuplan/shared";
import { api } from "../../lib/api";
import { longDate, plural } from "../../lib/format";
import { Button, Card, Notice, Spinner } from "../../ui/kit";

type Versions = Awaited<ReturnType<typeof api.versions>>["versions"];
type Trash = Awaited<ReturnType<typeof api.trash>>["items"];

const REASON: Record<string, string> = { import: "When the plan was first saved" };

export function History({ planId, plan, version, canEdit, edit }: { planId: string; plan: Plan; version: number; canEdit: boolean; edit: (op: Op) => void }) {
  const [versions, setVersions] = useState<Versions | null>(null);
  const [trash, setTrash] = useState<Trash | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const load = () => {
    api.versions(planId).then((r) => setVersions(r.versions)).catch((e: Error) => setError(e.message));
    api.trash(planId).then((r) => setTrash(r.items)).catch((e: Error) => setError(e.message));
  };
  useEffect(load, [planId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const restore = async (v: number) => {
    setConfirm(null);
    try {
      await api.restoreVersion(planId, v);
      setMsg(`Version ${v} is back. The plan as it was a moment ago is saved as a new version, so you can undo this.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't restore. Try again.");
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {msg && <div className="lg:col-span-2"><Notice tone="good">{msg}</Notice></div>}
      {error && <div className="lg:col-span-2"><Notice tone="bad">{error}</Notice></div>}
      <Card aria-label="Version history" className="flex flex-col gap-3">
        <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><HistoryIcon aria-hidden size={20} /> Version history</h2>
        <p className="m-0 text-sm text-ink-2">A version is saved automatically before every big change (an AI update, a restore).</p>
        {!versions && <Spinner />}
        <ul className="m-0 flex list-none flex-col p-0">
          {versions?.map((v) => {
            // Every difference counts here, progress included: restoring brings all of it back.
            const diff = diffPlans(plan, v.plan).length;
            return (
              <li key={v.version} className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[15px] font-semibold">{REASON[v.reason] ?? v.reason}</span>
                  <span className="text-sm text-muted">{longDate(new Date(v.createdAt).toISOString().slice(0, 10))} · {v.by}</span>
                </div>
                <span className="text-sm text-ink-2">{v.done} of {plural(v.tasks, "task")} done{diff ? ` · ${plural(diff, "difference")} from now` : " · same as now"}</span>
                {canEdit && diff > 0 && (confirm === v.version ? (
                  <span className="flex flex-wrap items-center gap-2"><span className="text-sm">Bring this version back?</span><Button onClick={() => void restore(v.version)}>Restore</Button><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button></span>
                ) : (
                  <Button variant="secondary" className="self-start" onClick={() => setConfirm(v.version)}>Restore this version</Button>
                ))}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card aria-label="Trash" className="flex flex-col gap-3">
        <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><Trash2 aria-hidden size={20} /> Trash</h2>
        <p className="m-0 text-sm text-ink-2">Deleted tasks wait here for 30 days.</p>
        {!trash && <Spinner />}
        {trash?.length === 0 && <p className="m-0 text-[15px] text-ink-2">Nothing in the Trash.</p>}
        <ul className="m-0 flex list-none flex-col p-0">
          {trash?.map((x) => (
            <li key={x.taskId} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 first:border-t-0">
              <span className="flex flex-col"><span className="text-[15px] font-semibold">{x.title}</span><span className="text-sm text-muted">Deleted {longDate(x.deletedAt)} by {x.by}</span></span>
              {canEdit && <Button variant="secondary" onClick={() => { edit({ kind: "restoreTask", taskId: x.taskId }); setTrash(trash.filter((y) => y.taskId !== x.taskId)); setMsg(`"${x.title}" is back in the plan.`); }}>Restore</Button>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
