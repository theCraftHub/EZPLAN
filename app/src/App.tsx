import { Join } from "./pages/Join";
import { BusinessStart } from "./pages/BusinessStart";
import { OrgConsole } from "./pages/admin/OrgConsole";
import { MasterPage } from "./pages/MasterPage";
import { SafetyCasePage } from "./pages/SafetyCases";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Me } from "./lib/api";
import { isNetworkError, offline } from "./lib/offline";
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
import { HelpPage, RequestPage, SupportInbox } from "./pages/Help";
import type { SpendType } from "./lib/api";
import { Shell } from "./ui/Shell";
import { Notice, Spinner } from "./ui/kit";

function Routes({ me, onSignOut, onMe }: { me: Me; onSignOut: () => void; onMe: (m: Me) => void }) {
  const { path } = useRouter();
  if (match("/", path)) return <Home me={me} />;
  if (match("/new", path)) return <NewPlan me={me} />;
  const invId = match("/invite/id/:id", path);
  if (invId) return <Invite key={invId.id} token={invId.id!} byId />;
  if (match("/business/start", path)) return <BusinessStart key="start" me={me} />;
  const biz = match("/business/:org", path) ?? match("/business/:org/:step", path);
  if (biz) return <BusinessStart key={biz.org} me={me} orgId={biz.org!} {...(biz.step ? { step: biz.step } : {})} />;
  const joinTo = match("/join/:token", path);
  if (joinTo) return <Join token={joinTo.token!} />;
  const inv = match("/invite/:token", path);
  if (inv) return <Invite token={inv.token!} />;
  if (match("/help", path)) return <HelpPage me={me} />;
  const mp = match("/m/:id", path) ?? match("/m/:id/:view", path);
  if (mp && ["", "timeline", "departments", "discussion", "activity"].includes(mp.view ?? "")) return <MasterPage key={mp.id} id={mp.id!} view={mp.view ?? ""} />;
  const casePage = match("/help/cases/:id", path);
  if (casePage) return <SafetyCasePage key={casePage.id} id={casePage.id!} />;
  const reqPage = match("/help/requests/:id", path);
  if (reqPage) return <RequestPage key={reqPage.id} id={reqPage.id!} />;
  const oc = match("/admin/org/:id", path) ?? match("/admin/org/:id/:section", path);
  if (oc) return <OrgConsole key={oc.id} me={me} orgId={oc.id!} section={oc.section ?? "overview"} />;
  if (match("/admin/support", path)) return <SupportInbox onCount={(n) => onMe({ ...me, supportOpen: n })} />;
  if (match("/notifications", path)) return <NotificationsPage onUnread={(n) => onMe({ ...me, unread: n })} />;
  if (match("/settings", path)) return <Settings me={me} onSignOut={onSignOut} onMe={onMe} />;
  if (match("/admin/safety", path)) return <SafetyPage onCount={(n) => onMe({ ...me, safetyOpen: n })} />;
  const det = match("/admin/ai/:ws/spending/:type/:key", path);
  if (det && ["person", "project", "department"].includes(det.type!)) return <AiAdminPage me={me} ws={det.ws!} tab="spending" detail={{ type: det.type as SpendType, key: det.key! }} />;
  const adm = match("/admin/ai/:ws", path) ?? match("/admin/ai/:ws/:tab", path);
  if (adm && ["", "spending"].includes(adm.tab ?? "")) return <AiAdminPage key={adm.ws} me={me} ws={adm.ws!} tab={adm.tab ?? ""} />;
  const p = match("/p/:id", path) ?? match("/p/:id/:view", path);
  if (p && ["", "checklist", "timeline", "team", "update", "history", "print", "share", "report", "activity", "risks", "grid"].includes(p.view ?? "")) return <PlanPage key={p.id} me={me} id={p.id!} view={p.view ?? ""} />;
  return <NotFound />;
}

function Root() {
  const [me, setMe] = useState<Me | null | "signed-out">(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api.me()
      .then((m) => { setMe(m); void offline.me(m); })
      .catch(async (e) => {
        if (e instanceof ApiError && e.status === 401) return setMe("signed-out");
        // Offline: carry on as the person last signed in on this device (their plans are kept here).
        const last = isNetworkError(e) ? await offline.lastMe() : undefined;
        if (last) setMe(last);
        else setError("Can't reach the server right now. Check your connection, then reload.");
      });
  }, []);
  useEffect(load, [load]);
  if (error) return <main className="p-6"><Notice tone="bad">{error}</Notice></main>;
  if (me === null) return <Spinner />;
  if (me === "signed-out") return <SignIn />;
  // Signing out also removes this device's offline copies (a shared computer shouldn't keep them).
  const signOut = () => void offline.clear().then(() => api.logout()).finally(() => location.assign("/"));
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
