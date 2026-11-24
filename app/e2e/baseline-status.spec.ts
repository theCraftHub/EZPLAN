/** Step J1: set a baseline, see slips against it, post a status update and see it in the history. */
import { expect, test } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

test("set baseline, slip a task and see it; post an amber status update and see it on the plan", async ({ page }, info) => {
  const shot = (name: string) => `e2e/.results/shots/${info.project.name}-j1-${name}.png`;
  await signIn(page);
  const id = await addPlan(page, KITCHEN.replace("title: Kitchen Remodel", `title: Baseline Kitchen ${info.project.name}`));
  await page.goto(`/p/${id}`);
  await page.getByRole("status").filter({ hasText: /^Live/ }).waitFor();

  // No baseline yet; set one.
  const baseline = page.getByRole("region", { name: "Baseline" });
  await expect(baseline.getByText(/No baseline yet/)).toBeVisible();
  await baseline.getByRole("button", { name: "Set baseline" }).click();
  await expect(baseline.getByText("On the baseline")).toBeVisible();

  // Ordering cabinets takes 3 more days: the checklist shows the slip, and so does the Overview.
  await page.getByRole("link", { name: "Checklist", exact: true }).click();
  const row = (title: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${title}(?!:)`) }) });
  await row("Order cabinets").getByRole("button", { name: /^Order cabinets(?!:)/ }).click();
  await page.getByRole("dialog").getByLabel("Takes").fill("5d");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(row("Order cabinets").getByText("+3d vs baseline")).toBeVisible();
  await expect(row("Remove old cabinets").getByText("+3d vs baseline")).toBeVisible(); // what waits on it slips too
  await expect(row("Get three contractor quotes").getByText(/vs baseline/)).toHaveCount(0); // earlier work is unchanged
  if (process.env.SHOTS) await page.screenshot({ path: shot("checklist"), fullPage: true });
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(baseline.getByText("3 working days late")).toBeVisible();
  await expect(baseline.getByText(/· 3 tasks slipped/)).toBeVisible(); // milestones and finished work aren't counted

  // Replacing the baseline asks first.
  await baseline.getByRole("button", { name: "Set a new baseline" }).click();
  await expect(baseline.getByText(/The current plan is saved in History first/)).toBeVisible();
  await baseline.getByRole("button", { name: "Keep it" }).click();

  // Post a status update from the report, choosing amber.
  const latest = page.getByRole("region", { name: "Latest status update" });
  await expect(latest.getByText("No status update yet.")).toBeVisible();
  await latest.getByRole("link", { name: "Write and post an update" }).click();
  await page.getByRole("button", { name: "Write the report" }).click();
  await page.getByLabel("Amber: at risk").check();
  await page.getByLabel("Headline").fill("Quotes slipped 3 days");
  await page.getByRole("button", { name: "Post as a status update" }).click();
  await expect(page.getByText(/Posted\. Everyone on the plan was told/)).toBeVisible();
  const history = page.getByRole("region", { name: "Status updates" });
  await expect(history.getByText("Quotes slipped 3 days")).toBeVisible();
  await expect(history.getByText("Amber", { exact: true })).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: shot("report"), fullPage: true });

  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(latest.getByText("Quotes slipped 3 days")).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: shot("overview"), fullPage: true });
});
