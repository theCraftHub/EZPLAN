/** Screenshots of the AI credits, spending and safety screens (run with SHOTS=1). */
import { test } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

test.skip(!process.env.SHOTS, "screenshots only when SHOTS=1");
const out = (name: string, project: string) => `e2e/.results/shots/${project}-${name}.png`;

test("step H2 screens", async ({ page, browser }, info) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN.replace("title: Kitchen Remodel", "title: Shots Kitchen"));
  const ws = ((await (await page.request.get("/api/me")).json()) as { workspaces: { id: string }[] }).workspaces[0]!.id;
  await page.request.put(`/api/workspaces/${ws}/members/${((await (await page.request.get("/api/me")).json()) as { user: { id: string } }).user.id}/department`, { data: { department: "Operations" } });
  for (let i = 0; i < 3; i++) await page.request.post(`/api/plans/${id}/ai/check`, { data: {} });
  await page.request.post(`/api/plans/${id}/report`, { data: { ai: true } });
  const link = ((await (await page.request.post(`/api/plans/${id}/invites`, { data: { email: "kim@example.com", role: "editor" } })).json()) as { link: string }).link;
  const ctx = await browser.newContext({ viewport: page.viewportSize()! });
  const kim = await ctx.newPage();
  await signIn(kim, "Kim Park");
  await kim.request.post(`/api/invites/${link.split("/invite/")[1]}/accept`, { data: {} });
  await kim.request.post(`/api/plans/${id}/ai/check`, { data: {} });
  await kim.request.post(`/api/workspaces/${ws}/ai/requests`, { data: { checks: 25, note: "Supplier review this week" } });

  await page.goto(`/admin/ai/${ws}`);
  await page.getByRole("heading", { name: "AI credits" }).waitFor();
  await page.screenshot({ path: out("h2-credits", info.project.name), fullPage: true });
  await page.goto(`/admin/ai/${ws}/spending`);
  await page.getByRole("img", { name: /AI cost per day/ }).waitFor();
  await page.screenshot({ path: out("h2-spending", info.project.name), fullPage: true });
  await page.getByRole("radio", { name: "people" }).click();
  await page.getByLabel("AI spending by people").getByRole("link", { name: /Alex Rivera/ }).click();
  await page.getByRole("region", { name: "Cost detail" }).waitFor();
  await page.screenshot({ path: out("h2-spending-detail", info.project.name), fullPage: true });

  await kim.goto(`/p/${id}`);
  await kim.getByRole("status").filter({ hasText: /^Live/ }).waitFor();
  await kim.getByText(/Asked for 25 AI checks/).waitFor();
  await kim.getByRole("region", { name: "Plan Check" }).screenshot({ path: out("h2-asked", info.project.name) });
  await ctx.close();

  const held = await addPlan(page, KITCHEN.replace("title: Kitchen Remodel", "title: Shots hold [refuse]"));
  await page.request.post(`/api/plans/${held}/ai/check`, { data: {} });
  const pctx = await browser.newContext({ viewport: page.viewportSize()! });
  const pat = await pctx.newPage();
  await signIn(pat, "Pat Lee", "/admin/safety");
  await pat.getByRole("heading", { name: "Safety review" }).waitFor();
  await pat.screenshot({ path: out("h2-safety", info.project.name), fullPage: true });
  await pctx.close();
});
