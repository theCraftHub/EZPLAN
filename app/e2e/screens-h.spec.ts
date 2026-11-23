import { test } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

test.skip(!process.env.SHOTS, "screenshots only when SHOTS=1");

test("step H screens", async ({ page }, info) => {
  const out = (n: string) => `e2e/.results/shots/${info.project.name}-${n}.png`;
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.goto(`/p/${id}`);
  await page.getByRole("status").filter({ hasText: /^Live/ }).waitFor();
  await page.getByRole("region", { name: "Plan Check" }).getByRole("button", { name: "Run AI check" }).click();
  await page.getByRole("list", { name: "AI suggestions" }).waitFor();
  await page.getByRole("region", { name: "Plan Check" }).screenshot({ path: out("h-check") });
  await page.goto(`/p/${id}/report`);
  await page.getByRole("checkbox", { name: /Word it with AI/ }).check();
  await page.getByRole("button", { name: "Write the report" }).click();
  await page.getByText("Worded by AI from the plan's facts").waitFor();
  await page.getByRole("region", { name: "Status report" }).screenshot({ path: out("h-report") });
});
