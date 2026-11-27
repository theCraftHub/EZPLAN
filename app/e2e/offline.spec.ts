/** Step M4: full offline editing. Edit with no connection, reload, the edit is still there; back online, it reaches the server. */
import { expect, test, type Page } from "@playwright/test";
import { addPlan, signIn } from "./helpers";

const rows = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${title}`) }) });

test("offline: edit, reload, still there; back online, saved for everyone", async ({ page, context, browser }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-m4-${name}.png`, fullPage: true }); };
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page, "Kim Park");
  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Shed ${tag}\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: Pour the base (1d)\n- [ ] T2: Raise the walls (2d)`);
  // Home once online, so this device has its list.
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Your plans" }).getByText(`Shed ${tag}`)).toBeVisible();
  await page.goto(`/p/${id}/checklist`);
  await expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();
  // The app's offline shell is installed in the background on the first visit.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });

  await context.setOffline(true);
  await expect(page.getByText(/^Offline: changes are saved on this device/)).toBeVisible();
  await rows(page, "Pour the base").getByRole("button", { name: /Pour the base: To do/ }).click();
  await expect(rows(page, "Pour the base").getByRole("button", { name: /Pour the base: Doing/ })).toBeVisible();
  await expect(page.getByText(/\(1 waiting\)/)).toBeVisible();

  await page.reload();
  await expect(page.getByText(/This is the copy from/)).toBeVisible();
  await expect(rows(page, "Pour the base").getByRole("button", { name: /Pour the base: Doing/ })).toBeVisible();
  await rows(page, "Raise the walls").getByRole("button", { name: /Raise the walls: To do/ }).click();
  await expect(page.getByText(/\(2 waiting\)/)).toBeVisible();
  await shot("1-offline");

  await page.goto("/");
  await expect(page.getByText(/^You're offline\. These are your plans as of/)).toBeVisible();
  await page.goto(`/p/${id}/checklist`);

  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Offline:/)).toHaveCount(0);

  // A second browser sees both edits.
  const small = page.viewportSize()!.width < 600;
  const other = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: small, hasTouch: small })).newPage();
  await signIn(other, "Kim Park");
  const statuses = async () => ((await (await other.request.get(`/api/plans/${id}`)).json()) as { plan: { phases: { tasks: { status: string }[] }[] } }).plan.phases[0]!.tasks.map((t) => t.status);
  await expect.poll(statuses, { timeout: 10_000 }).toEqual(["progress", "progress"]);
  await other.context().close();
});
