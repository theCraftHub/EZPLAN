import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Me } from "./lib/api";
import { match, RouterProvider, useRouter } from "./lib/router";
import { Home } from "./pages/Home";
import { NewPlan } from "./pages/NewPlan";
import { Invite } from "./pages/Invite";
import { PlanPage } from "./pages/plan/PlanPage";
import { NotFound } from "./pages/Placeholder";
import { SignIn } from "./pages/SignIn";
import { Settings } from "./pages/Settings";
import { AiAdminPage } from "./pages/AiAdmin";
import { SafetyPage } from "./pages/Safety";
import { NotificationsPage } from "./pages/Notifications";
import type { SpendType } from "./lib/api";
import { Shell } from "./ui/Shell";
import { Notice, Spinner } from "./ui/kit";

function Routes({ me, onSignOut, onMe }: { me: Me; onSignOut: () => void; onMe: (m: Me) => void }) {
  const { path } = useRouter();
  if (match("/", path)) return <Home me={me} />;
  if (match("/new", path)) return <NewPlan me={me} />;
  const invId = match("/invite/id/:id", path);
  if (invId) return <Invite key={invId.id} token={invId.id!} byId />;
  const inv = match("/invite/:token", path);
  if (inv) return <Invite token={inv.token!} />;
  if (match("/notifications", path)) return <NotificationsPage onUnread={(n) => onMe({ ...me, unread: n })} />;
  if (match("/settings", path)) return <Settings me={me} onSignOut={onSignOut} onMe={onMe} />;
  if (match("/admin/safety", path)) return <SafetyPage onCount={(n) => onMe({ ...me, safetyOpen: n })} />;
  const det = match("/admin/ai/:ws/spending/:type/:key", path);
  if (det && ["person", "project", "department"].includes(det.type!)) return <AiAdminPage me={me} ws={det.ws!} tab="spending" detail={{ type: det.type as SpendType, key: det.key! }} />;
  const adm = match("/admin/ai/:ws", path) ?? match("/admin/ai/:ws/:tab", path);
  if (adm && ["", "spending"].includes(adm.tab ?? "")) return <AiAdminPage key={adm.ws} me={me} ws={adm.ws!} tab={adm.tab ?? ""} />;
  const p = match("/p/:id", path) ?? match("/p/:id/:view", path);
  if (p && ["", "checklist", "timeline", "team", "update", "history", "print", "share", "report", "activity"].includes(p.view ?? "")) return <PlanPage key={p.id} me={me} id={p.id!} view={p.view ?? ""} />;
  return <NotFound />;
}

function Root() {
  const [me, setMe] = useState<Me | null | "signed-out">(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api.me().then(setMe).catch((e) => (e instanceof ApiError && e.status === 401 ? setMe("signed-out") : setError("Can't reach the server right now. Check your connection, then reload.")));
  }, []);
  useEffect(load, [load]);
  if (error) return <main className="p-6"><Notice tone="bad">{error}</Notice></main>;
  if (me === null) return <Spinner />;
  if (me === "signed-out") return <SignIn />;
  const signOut = () => void api.logout().finally(() => location.assign("/"));
  return (
    <Shell me={me} onSignOut={signOut} onUnread={(n) => setMe((m) => (m && m !== "signed-out" ? { ...m, unread: n } : m))}>
      <Routes me={me} onSignOut={signOut} onMe={setMe} />
    </Shell>
  );
}

export function App() {
  return (
    <RouterProvider>
      <Root />
    </RouterProvider>
  );
}
