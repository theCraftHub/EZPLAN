/** Opening a company invite link (step L1): who invited you, to which company, as what; then join. */
import { useEffect, useState } from "react";
import { BRAND } from "@rakuplan/shared";
import { api } from "../lib/api";
import { useRouter } from "../lib/router";
import { Button, Card, Notice, PageTitle, Spinner } from "../ui/kit";

export function Join({ token }: { token: string }) {
  const { go } = useRouter();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.joinInfo>> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.joinInfo(token).then((i) => (i.accepted ? go("/", { replace: true }) : setInfo(i))).catch((e: Error) => setError(e.message));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const accept = async () => {
    setBusy(true);
    try {
      await api.acceptJoin(token);
      go("/?joined=1", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle title="Join your company" />
      {error && <Notice tone="bad">{error}</Notice>}
      {!info && !error && <Spinner />}
      {info && (
        <Card className="flex flex-col gap-3">
          {info.problem ? <Notice tone="warn">{info.problem}</Notice> : (
            <>
              <p className="m-0 text-[17px]"><strong>{info.inviter}</strong> invited you to join <strong>{info.org}</strong> on {BRAND.name} as {info.role}.</p>
              <p className="m-0 text-[15px] text-ink-2">You'll see your company's plans alongside your own. Your personal plans stay private to you.</p>
              <Button className="self-start" onClick={() => void accept()} disabled={busy}>{busy ? "Joining…" : `Join ${info.org}`}</Button>
            </>
          )}
        </Card>
      )}
    </>
  );
}
