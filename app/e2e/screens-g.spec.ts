import { test } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

test.skip(!process.env.SHOTS, "screenshots only when SHOTS=1");

test("step G screens", async ({ page, browser }, info) => {
  const out = (n: string) => `e2e/.results/shots/${info.project.name}-${n}.png`;
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  const r = await page.request.post(`/api/plans/${id}/invites`, { data: { email: "sam@example.com", role: "editor", personName: "Priya" } });
  const { link } = (await r.json()) as { link: string };
  await page.goto(`/p/${id}/share`);
  await page.getByRole("region", { name: "Invite someone" }).getByLabel("Their email").fill("lee@example.com");
  await page.getByRole("button", { name: "Make invite link" }).click();
  await page.getByLabel("Invite link").waitFor();
  await page.screenshot({ path: out("g-share"), fullPage: true });
  const ctx = await browser.newContext({ viewport: page.viewportSize()! });
  const sam = await ctx.newPage();
  await sam.goto(new URL(link).pathname);
  await sam.getByRole("link", { name: "Sign in with Test ID" }).click();
  await sam.getByRole("link", { name: "Continue as Sam Okoye" }).click();
  await sam.getByRole("button", { name: "Accept and open the plan" }).waitFor();
  await sam.screenshot({ path: out("g-invite") });
  await ctx.close();
});
