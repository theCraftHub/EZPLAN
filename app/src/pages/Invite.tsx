/** Opening an invite link: who invited you, to what, as what; then accept. */
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useRouter } from "../lib/router";
import { Button, Card, Notice, PageTitle, Spinner } from "../ui/kit";

export function Invite({ token }: { token: string }) {
  const { go } = useRouter();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.inviteInfo>> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.inviteInfo(token).then((i) => (i.accepted && i.planId ? go(`/p/${i.planId}`, { replace: true }) : setInfo(i))).catch((e: Error) => setError(e.message));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const accept = async () => {
    setBusy(true);
    try {
      const r = await api.acceptInvite(token);
      go(`/p/${r.planId}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle title="You're invited" />
      {error && <Notice tone="bad">{error}</Notice>}
      {!info && !error && <Spinner />}
      {info && (
        <Card className="flex flex-col gap-3">
          {info.problem ? (
            <Notice tone="warn">{info.problem}</Notice>
          ) : (
            <>
              <p className="m-0 text-[17px]"><strong>{info.inviter}</strong> invited you to <strong>{info.planTitle}</strong> as {info.role === "editor" ? "an Editor (you can update tasks)" : info.role === "commenter" ? "a Commenter (you can see everything and comment)" : "a Viewer (you can see everything)"}.</p>
              <Button className="self-start" onClick={() => void accept()} disabled={busy}>{busy ? "Joining…" : "Accept and open the plan"}</Button>
            </>
          )}
        </Card>
      )}
    </>
  );
}
