/** Not a test of behavior: saves screenshots of each screen for a visual check (run with SHOTS=1). */
import { test } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

test.skip(!process.env.SHOTS, "screenshots only when SHOTS=1");
const out = (name: string, project: string) => `e2e/.results/shots/${project}-${name}.png`;

test("screens", async ({ page }, info) => {
  await page.goto("/");
  await page.screenshot({ path: out("signin", info.project.name) });
  await signIn(page);
  await addPlan(page, KITCHEN);
  await addPlan(page, KITCHEN.replace("Kitchen Remodel", "Office Move").replace("[x] T1", "[ ] T1").replace(" done: 2027-01-04 by Jordan", ""));
  await page.reload();
  await page.getByText("Office Move").first().waitFor();
  await page.screenshot({ path: out("home", info.project.name), fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: out("home-dark", info.project.name), fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  await page.screenshot({ path: out("settings", info.project.name), fullPage: true });

  await page.goto("/new");
  await page.screenshot({ path: out("new-start", info.project.name), fullPage: true });
  await page.getByRole("button", { name: /I've been talking it through/ }).click();
  await page.screenshot({ path: out("new-prompt", info.project.name), fullPage: true });
  await page.getByRole("button", { name: "I have the reply" }).click();
  await page.getByLabel(/Paste your assistant's whole reply/).fill(KITCHEN);
  await page.getByRole("button", { name: "Check my plan" }).click();
  await page.getByRole("radiogroup", { name: "Hours a week for Priya" }).getByRole("radio", { name: "Custom" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: out("new-preview", info.project.name), fullPage: true });
  await page.goto("/new");
  await page.getByRole("button", { name: /I'm starting fresh/ }).click();
  await page.screenshot({ path: out("new-wizard", info.project.name), fullPage: true });
});
