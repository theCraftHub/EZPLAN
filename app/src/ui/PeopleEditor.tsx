/**
 * A list of people to invite, pasted or uploaded as a spreadsheet, checked row by row against the
 * company (the server's dry run) and fixable in place. Used by business onboarding and by the admin
 * console's Add people.
 */
import { useEffect, useRef, useState } from "react";
import { FileUp, Trash2 } from "lucide-react";
import { parsePeople, type ParsedPeople } from "@rakuplan/shared";
import { api, ApiError, type OrgDetail, type OrgInviteCheck, type OrgInviteRequest, type OrgRole } from "../lib/api";
import { plural } from "../lib/format";
import { Button, Notice } from "./kit";

export const ROLE_WORD: Record<OrgRole, string> = { owner: "Owner", admin: "Admin", dept_admin: "Department admin", helpdesk: "Helpdesk", auditor: "Auditor", member: "Member", guest: "Guest" };
const GRANTABLE: OrgRole[] = ["member", "admin", "dept_admin", "helpdesk", "auditor", "guest"];
const COLUMN_WORD: Record<string, string> = { email: "Email", name: "Name", first: "First name", last: "Last name", department: "Department", role: "Role", workspace: "Workspace" };
const input = "min-h-11 rounded-xl border border-line bg-surface px-3 text-base font-normal";

type Row = OrgInviteRequest & { key: number };
export interface PeopleList {
  rows: Row[];
  /** The rows as the server takes them. */
  requests: OrgInviteRequest[];
  checks: OrgInviteCheck[] | null;
  ready: number;
  dirty: boolean;
  busy: boolean;
  clear: () => void;
}

export function usePeopleList(org: OrgDetail, initial: OrgInviteRequest[] = []) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((p, i) => ({ ...p, key: i })));
  const [checks, setChecks] = useState<OrgInviteCheck[] | null>(null);
  const [seatsLeft, setSeatsLeft] = useState<number | null>(null);
  const [parsed, setParsed] = useState<ParsedPeople | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nextKey = useRef(1000);
  const strip = (list: Row[]) => list.map(({ key: _k, ...p }) => p);

  const check = async (list: Row[]) => {
    setError("");
    if (!list.length) { setChecks(null); setDirty(false); return; }
    setBusy(true);
    try {
      const r = await api.checkPeople(org.id, strip(list));
      setChecks(r.rows);
      setSeatsLeft(r.seatsLeft);
      setDirty(false);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't check the list. Try again."); } finally { setBusy(false); }
  };
  useEffect(() => { if (rows.length) void check(rows); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const read = (source: string) => {
    const p = parsePeople(source);
    setParsed(p);
    const byName = new Map(org.workspaces.map((w) => [w.name.toLowerCase(), w.id]));
    const added: Row[] = p.rows.map((r) => ({
      key: nextKey.current++, email: r.email,
      ...(r.name ? { name: r.name } : {}), ...(r.department ? { department: r.department } : {}),
      ...(r.role && r.role !== "owner" ? { role: r.role as OrgRole } : {}),
      ...(r.workspace && byName.get(r.workspace.toLowerCase()) ? { workspaceId: byName.get(r.workspace.toLowerCase())! } : {}),
    }));
    const all = [...rows, ...added];
    setRows(all);
    void check(all);
  };
  const edit = (key: number, patch: Partial<Row>) => { setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r))); setDirty(true); };
  const remove = (key: number) => { const next = rows.filter((r) => r.key !== key); setRows(next); void check(next); };
  const ready = checks?.filter((c) => c.ok).length ?? 0;
  const list: PeopleList = { rows, requests: strip(rows), checks, ready, dirty, busy, clear: () => { setRows([]); setChecks(null); setParsed(null); setDirty(false); } };
  return { list, view: { org, rows, checks, seatsLeft, parsed, dirty, busy, error, ready, read, edit, remove, recheck: () => void check(rows) } };
}

export function PeopleEditor({ view }: { view: ReturnType<typeof usePeopleList>["view"] }) {
  const { org, rows, checks, seatsLeft, parsed, dirty, busy, error, ready, read, edit, remove, recheck } = view;
  const [text, setText] = useState("");
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Paste names and emails, one person per line
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={"Ivan Petrov <ivan@northfield.com>\nmei@northfield.com"} className="rounded-xl border border-line bg-surface p-3 font-mono text-[14px] leading-relaxed font-normal" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!text.trim() || busy} onClick={() => { read(text); setText(""); }}>Check the list</Button>
        <Button variant="secondary" onClick={() => file.current?.click()}><FileUp aria-hidden size={18} /> Upload a spreadsheet (CSV)</Button>
        <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" aria-label="Spreadsheet file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(read); e.target.value = ""; }} />
      </div>
      {parsed?.columns && <p className="m-0 text-sm text-ink-2">Columns matched: {Object.entries(parsed.columns).map(([k, v]) => `${COLUMN_WORD[k] ?? k} from “${v}”`).join(", ")}.</p>}
      {parsed && parsed.skipped.length > 0 && <Notice tone="warn">{parsed.skipped.map((s) => `Line ${s.line} has no email address (“${s.text.slice(0, 60)}”)`).join(". ")}. Those lines were left out.</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[15px] font-semibold" role="status">{busy ? "Checking…" : checks ? `${plural(ready, "person", "people")} ready${checks.length - ready ? `, ${checks.length - ready} to fix` : ""}${seatsLeft !== null ? ` · ${plural(Math.max(0, seatsLeft), "seat")} left after these` : ""}` : ""}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="People to invite">
            {rows.map((r, i) => {
              const c = !dirty ? checks?.[i] : undefined;
              return (
                <li key={r.key} className={`flex flex-col gap-2 rounded-xl p-3 ring-1 ${c && !c.ok ? "bg-warn-soft/40 ring-warn/40" : "bg-surface ring-line"}`} aria-label={r.name || r.email}>
                  <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr_auto_auto]">
                    <input aria-label="Name" value={r.name ?? ""} onChange={(e) => edit(r.key, { name: e.target.value })} placeholder="Name" className={`${input} min-w-0`} />
                    <input aria-label="Email" value={r.email} onChange={(e) => edit(r.key, { email: e.target.value })} className={`${input} min-w-0`} />
                    <select aria-label="Role" value={r.role ?? "member"} onChange={(e) => edit(r.key, { role: e.target.value as OrgRole })} className={input}>{GRANTABLE.map((g) => <option key={g} value={g}>{ROLE_WORD[g]}</option>)}</select>
                    <Button variant="ghost" onClick={() => remove(r.key)} aria-label={`Remove ${r.name || r.email}`}><Trash2 aria-hidden size={18} /></Button>
                  </div>
                  {org.workspaces.length > 1 && (
                    <select aria-label="Workspace" value={r.workspaceId ?? org.workspaces[0]!.id} onChange={(e) => edit(r.key, { workspaceId: e.target.value })} className={`${input} sm:max-w-xs`}>{org.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
                  )}
                  <span className={`text-sm font-semibold ${c ? (c.ok ? "text-good" : "text-warn") : "text-muted"}`}>
                    {c ? (c.ok ? `✓ Ready${r.department ? ` · ${r.department}` : ""}` : c.problem) : dirty ? "Changed: check again" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          {dirty && <Button variant="secondary" className="self-start" onClick={recheck} disabled={busy}>Check again</Button>}
        </div>
      )}
    </div>
  );
}
