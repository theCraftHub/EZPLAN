import { PageTitle, Card } from "../ui/kit";

/** Screens that arrive in the next build steps. */
export function Placeholder({ title }: { title: string }) {
  return (
    <>
      <PageTitle title={title} />
      <Card><p className="m-0 text-[15px] text-ink-2">This screen is being built.</p></Card>
    </>
  );
}

export function NotFound() {
  return (
    <>
      <PageTitle title="Page not found" />
      <Card><p className="m-0 text-[15px] text-ink-2">This page doesn't exist. Check the address, or go back to Home.</p></Card>
    </>
  );
}
