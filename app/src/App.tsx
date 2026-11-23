import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Me } from "./lib/api";
import { match, RouterProvider, useRouter } from "./lib/router";
import { Home } from "./pages/Home";
import { NewPlan } from "./pages/NewPlan";
import { PlanPage } from "./pages/plan/PlanPage";
import { NotFound } from "./pages/Placeholder";
import { SignIn } from "./pages/SignIn";
import { Settings } from "./pages/Settings";
import { Shell } from "./ui/Shell";
import { Notice, Spinner } from "./ui/kit";

function Routes({ me, onSignOut, onMe }: { me: Me; onSignOut: () => void; onMe: (m: Me) => void }) {
  const { path } = useRouter();
  if (match("/", path)) return <Home me={me} />;
  if (match("/new", path)) return <NewPlan me={me} />;
  if (match("/settings", path)) return <Settings me={me} onSignOut={onSignOut} onMe={onMe} />;
  const p = match("/p/:id", path) ?? match("/p/:id/:view", path);
  if (p && ["", "checklist", "timeline", "team"].includes(p.view ?? "")) return <PlanPage key={p.id} me={me} id={p.id!} view={p.view ?? ""} />;
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
    <Shell me={me} onSignOut={signOut}>
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
