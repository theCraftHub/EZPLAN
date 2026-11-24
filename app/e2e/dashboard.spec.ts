/** Step J2: the desktop Overview dashboard; each person hides and reorders widgets, saved to their account. */
import { expect, test } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

test("desktop dashboard: widgets with real numbers; hide and reorder, kept after reload; phones keep the compact Overview", async ({ page }, info) => {
  const shot = (name: string) => `e2e/.results/shots/${info.project.name}-j2-${name}.png`;
  await signIn(page);
  const id = await addPlan(page, KITCHEN.replace("title: Kitchen Remodel", `title: Dashboard Kitchen ${info.project.name}`));
  await page.goto(`/p/${id}`);
  await page.getByRole("status").filter({ hasText: /^Live/ }).waitFor();

  if (info.project.name === "phone") {
    await expect(page.getByRole("button", { name: "Customize" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Up next" })).toBeVisible();
    return;
  }

  // Real numbers from the engine.
  await expect(page.getByRole("region", { name: "Key numbers" }).getByText("No baseline")).toBeVisible();
  await expect(page.getByRole("region", { name: "Milestones" }).getByText("Order placed")).toBeVisible();
  const critical = page.getByRole("region", { name: "Critical path" });
  await expect(critical.getByText("Order cabinets")).toBeVisible();
  await expect(page.getByRole("region", { name: "Next two weeks" }).getByText("Get three contractor quotes")).toBeVisible();
  await expect(page.getByRole("region", { name: "Workload" }).getByText("Jordan")).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: shot("dashboard"), fullPage: true });

  // Customize: hide Workload, move Critical path to the top.
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Hide Workload" }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Move Critical path up" }).click();
  await expect(page.getByRole("button", { name: "Move Critical path up" })).toBeDisabled(); // it's first
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: shot("customize") });
  await page.setViewportSize({ width: 1440, height: 2400 }); // resizing the window keeps customize mode
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible(); // still customizing
  await page.setViewportSize(info.project.use.viewport!);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("region", { name: "Workload" })).toHaveCount(0);

  // Kept after a reload (saved to the account, not the browser).
  await page.reload();
  await expect(page.getByRole("region", { name: "Critical path" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Workload" })).toHaveCount(0);
  const first = await page.locator("main [aria-label]").filter({ has: page.getByRole("heading") }).first().getAttribute("aria-label");
  expect(first).toBe("Critical path");

  // Reset brings everything back.
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Reset layout" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("region", { name: "Workload" })).toBeVisible();
});
