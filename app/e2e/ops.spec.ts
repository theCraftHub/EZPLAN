/** Step M5: the owner's Operations page; platform admins only. */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("Operations page: numbers and errors for a platform admin; nobody else can open it", async ({ page, browser }, info) => {
  await signIn(page, "Pat Lee");
  await page.goto("/admin/ops");
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  for (const label of ["People", "Companies", "Plans", "Email", "Queues", "Database"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Up to date")).toBeVisible();
  await expect(page.getByRole("region", { name: "Server errors" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Safety review queue" })).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-m5-ops.png`, fullPage: true });

  const small = page.viewportSize()!.width < 600;
  const kim = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: small, hasTouch: small })).newPage();
  await signIn(kim, "Kim Park");
  await kim.goto("/admin/ops");
  await expect(kim.getByRole("heading", { name: "Operations" })).toHaveCount(0);
  expect((await kim.request.get("/api/ops")).status()).toBe(404);
  await kim.context().close();
});
