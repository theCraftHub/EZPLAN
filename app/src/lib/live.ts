/**
 * One plan, live: loads it, opens the live connection, shows your edits at once, sends them in
 * order, and applies everyone else's. Edits made while offline queue up and are sent on reconnect.
 * Offline (step M4): the plan and unsent edits are also kept on the device (lib/offline.ts), so
 * a plan opened before opens without a connection and edits survive a reload or a closed tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientReplica, type Op, type PresencePerson, type ServerMessage } from "@rakuplan/shared";
import { api, type Me, type PlanDetail } from "./api";
import { isNetworkError, offline } from "./offline";

export type LiveStatus = "connecting" | "live" | "offline";

export function usePlanRoom(planId: string, me: Me) {
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [presence, setPresence] = useState<PresencePerson[]>([]);
  const [comments, setComments] = useState<{ counts: Record<string, number>; tick: number }>({ counts: {}, tick: 0 });
  const [notice, setNotice] = useState("");
  const [tick, setTick] = useState(0);
  // Bumped when the server says our access changed: load the plan again (new role, or no access).
  const [reload, setReload] = useState(0);
  const [fromCopy, setFromCopy] = useState<number | null>(null);
  const replica = useRef<ClientReplica | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const detailRef = useRef<PlanDetail | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Writes this device's copy now. Edits are saved at once, so closing the tab right after typing loses nothing. */
  const saveNow = useCallback(() => {
    clearTimeout(saveTimer.current);
    const r = replica.current;
    const d = detailRef.current;
    if (r && d) void offline.savePlan(me.user.id, planId, { detail: d, ...r.snapshot(), clientId: r.clientId, savedAt: Date.now() });
  }, [me.user.id, planId]);
  /** Other changes (everyone else's edits arriving) are saved shortly after, so a burst is one write. */
  const persist = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveNow, 250);
  }, [saveNow]);
  // Leaving or hiding the page saves too (a closed tab doesn't run React's cleanup).
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") saveNow(); };
    addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", hide);
    return () => { removeEventListener("pagehide", saveNow); document.removeEventListener("visibilitychange", hide); };
  }, [saveNow]);
  const rerender = () => { setTick((n) => n + 1); persist(); };

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
          setFromCopy(null);
          // Anything typed while offline goes now, in order; the server ignores repeats.
          for (const env of r.outbox()) ws.send(JSON.stringify({ t: "edit", ...env }));
        } else if (m.t === "applied") {
          r.receive(m.applied, today());
        } else if (m.t === "ack" && m.status === "rejected") {
          r.drop(m.opId);
          setNotice(m.error ?? "That change wasn't saved.");
        } else if (m.t === "ack" && m.status === "duplicate") {
          // Already saved earlier (sent again after a reconnect): nothing more to send.
          r.drop(m.opId);
        } else if (m.t === "presence") {
          setPresence(m.people);
        } else if (m.t === "comments") {
          setComments((c) => ({ counts: { ...c.counts, [m.taskId]: m.count }, tick: c.tick + 1 }));
        } else if (m.t === "people") {
          // Someone changed availability: dates update here too.
          setDetail((d) => (d ? (detailRef.current = { ...d, people: m.people }) : d));
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
    const actor = { userId: me.user.id, name: me.user.name };
    const start = (d: PlanDetail) => {
      todayIso = d.today;
      detailRef.current = d;
      setDetail(d);
      connect();
    };
    void (async () => {
      const copy = await offline.plan(me.user.id, planId);
      // Edits made on this device earlier and never confirmed go out with the same IDs (the server ignores repeats).
      const restore = copy?.pending.length ? { pending: copy.pending, sent: copy.sent } : undefined;
      try {
        const d = await api.plan(planId);
        if (stopped) return;
        replica.current = new ClientReplica(restore ? copy!.clientId : crypto.randomUUID().slice(0, 12), actor, d.plan, d.version, restore);
        start(d);
        persist();
        api.commentCounts(planId).then((r) => !stopped && setComments((c) => ({ counts: r.counts, tick: c.tick + 1 }))).catch(() => {});
      } catch (e) {
        if (stopped) return;
        if (isNetworkError(e) && copy) {
          // No connection: open this device's copy, with unsent edits on top; keep trying to connect.
          replica.current = new ClientReplica(copy.clientId, actor, copy.confirmed, copy.version, { pending: copy.pending, sent: copy.sent });
          setFromCopy(copy.savedAt);
          start(copy.detail);
        } else if (isNetworkError(e)) setError("You're offline, and this plan hasn't been opened on this device yet, so there's no copy here. Open it once with a connection to use it offline.");
        else setError((e as Error).message);
      }
    })();
    const online = () => {
      if (!socket.current && replica.current) {
        clearTimeout(timer);
        retry = 0;
        connect();
      }
    };
    // A dropped network can leave a dead socket open for minutes; close it so edits queue visibly.
    const goneOffline = () => socket.current?.close();
    addEventListener("online", online);
    addEventListener("offline", goneOffline);
    return () => {
      stopped = true;
      clearTimeout(timer);
      removeEventListener("online", online);
      removeEventListener("offline", goneOffline);
      socket.current?.close();
      socket.current = null;
      // Save what's on screen before leaving (the timed save may not have run yet).
      clearTimeout(saveTimer.current);
      const r = replica.current;
      if (r && detailRef.current) void offline.savePlan(me.user.id, planId, { detail: detailRef.current, ...r.snapshot(), clientId: r.clientId, savedAt: Date.now() });
      replica.current = null;
    };
  }, [planId, me.user.id, me.user.name, reload]);

  const edit = useCallback((op: Op) => {
    const r = replica.current;
    if (!r) return;
    const env = r.edit(op);
    saveNow();
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ t: "edit", ...env }));
    rerender();
  }, [saveNow]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => (detail && replica.current ? replica.current.view(detail.today) : null), [detail, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = replica.current?.pendingCount ?? 0;
  const version = replica.current?.version ?? 0;
  const setDetailKept = useCallback((d: PlanDetail) => { detailRef.current = d; setDetail(d); persist(); }, [persist]);
  return { detail, plan, error, status, presence, pending, edit, notice, clearNotice: () => setNotice(""), setDetail: setDetailKept, comments, version, fromCopy };
}
