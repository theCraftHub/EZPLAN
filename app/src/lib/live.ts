/**
 * One plan, live: loads it, opens the live connection, shows your edits at once, sends them in
 * order, and applies everyone else's. Edits made while offline queue up and are sent on reconnect.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientReplica, type Op, type PresencePerson, type ServerMessage } from "@ezplan/shared";
import { api, type Me, type PlanDetail } from "./api";

export type LiveStatus = "connecting" | "live" | "offline";

export function usePlanRoom(planId: string, me: Me) {
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [presence, setPresence] = useState<PresencePerson[]>([]);
  const [notice, setNotice] = useState("");
  const [tick, setTick] = useState(0);
  // Bumped when the server says our access changed: load the plan again (new role, or no access).
  const [reload, setReload] = useState(0);
  const replica = useRef<ClientReplica | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const rerender = () => setTick((n) => n + 1);

  // Load the plan, then keep a live connection open (reconnecting with a growing pause).
  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setDetail(null);
    setError("");
    const connect = () => {
      if (stopped || !replica.current) return;
      setStatus("connecting");
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/plans/${encodeURIComponent(planId)}/live`);
      socket.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ t: "hello", since: replica.current!.version }));
      ws.onmessage = (ev) => {
        const r = replica.current!;
        const m = JSON.parse(String(ev.data)) as ServerMessage;
        if (m.t === "welcome") {
          if ("plan" in m) r.reset(m.plan, m.version, m.restoredForReview);
          else for (const a of m.missed) r.receive(a, today());
          retry = 0;
          setStatus("live");
          // Anything typed while offline goes now, in order; the server ignores repeats.
          for (const env of r.outbox()) ws.send(JSON.stringify({ t: "edit", ...env }));
        } else if (m.t === "applied") {
          r.receive(m.applied, today());
        } else if (m.t === "ack" && m.status === "rejected") {
          r.drop(m.opId);
          setNotice(m.error ?? "That change wasn't saved.");
        } else if (m.t === "presence") {
          setPresence(m.people);
        } else if (m.t === "people") {
          // Someone changed availability: dates update here too.
          setDetail((d) => (d ? { ...d, people: m.people } : d));
        }
        rerender();
      };
      ws.onclose = (ev) => {
        if (socket.current === ws) socket.current = null;
        if (stopped) return;
        if (ev.code === 4003) {
          setReload((n) => n + 1);
          return;
        }
        setStatus("offline");
        timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** retry++));
      };
    };
    let todayIso = "";
    const today = () => todayIso;
    api
      .plan(planId)
      .then((d) => {
        if (stopped) return;
        todayIso = d.today;
        replica.current = new ClientReplica(crypto.randomUUID().slice(0, 12), { userId: me.user.id, name: me.user.name }, d.plan, d.version);
        setDetail(d);
        connect();
      })
      .catch((e: Error) => !stopped && setError(e.message));
    const online = () => {
      if (!socket.current && replica.current) {
        clearTimeout(timer);
        retry = 0;
        connect();
      }
    };
    // A dropped network can leave a dead socket open for minutes; close it so edits queue visibly.
    const offline = () => socket.current?.close();
    addEventListener("online", online);
    addEventListener("offline", offline);
    return () => {
      stopped = true;
      clearTimeout(timer);
      removeEventListener("online", online);
      removeEventListener("offline", offline);
      socket.current?.close();
      socket.current = null;
      replica.current = null;
    };
  }, [planId, me.user.id, me.user.name, reload]);

  const edit = useCallback((op: Op) => {
    const r = replica.current;
    if (!r) return;
    const env = r.edit(op);
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ t: "edit", ...env }));
    rerender();
  }, []);

  const plan = useMemo(() => (detail && replica.current ? replica.current.view(detail.today) : null), [detail, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = replica.current?.pendingCount ?? 0;
  return { detail, plan, error, status, presence, pending, edit, notice, clearNotice: () => setNotice(""), setDetail };
}
