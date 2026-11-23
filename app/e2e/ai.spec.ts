/** AI features against the scripted engine in the test server (no network). */
import { expect, test, type Page } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();

test("AI check: add a suggested step, dismiss one for good, and bring it back", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.goto(`/p/${id}`);
  await live(page);
  const check = page.getByRole("region", { name: "Plan Check" });
  await check.getByRole("button", { name: "Run AI check" }).click();
  const list = check.getByRole("list", { name: "AI suggestions" });
  await expect(list.getByRole("listitem", { name: "Apply for the building permit" })).toBeVisible();
  await expect(check.getByText(/of 100 AI checks left this month/)).toBeVisible();

  // Accept: the step becomes a task right after the task the AI pointed at.
  await list.getByRole("listitem", { name: "Apply for the building permit" }).getByRole("button", { name: "Add this step" }).click();
  await expect(list.getByRole("listitem", { name: "Apply for the building permit" })).toHaveCount(0);
  const saved = async () => ((await (await page.request.get(`/api/plans/${id}`)).json()) as { plan: { phases: { tasks: { title: string }[] }[] } }).plan.phases.flatMap((p) => p.tasks.map((t) => t.title));
  await expect.poll(saved).toContain("Apply for the building permit");

  // Dismiss with "don't suggest again": hidden now and on the next run.
  const risk = list.getByRole("listitem", { name: "Bad weather could delay outdoor work" });
  await risk.getByRole("checkbox", { name: "Don't suggest this on this project again" }).check();
  await risk.getByRole("button", { name: "Dismiss" }).click();
  await expect(check.getByText("Hidden suggestions (1)")).toBeVisible();
  await check.getByRole("button", { name: "Run again" }).click();
  await expect(list.getByRole("listitem", { name: "Book the final inspection" })).toBeVisible();
  await expect(list.getByRole("listitem", { name: "Bad weather could delay outdoor work" })).toHaveCount(0);

  // Dismiss without the box: only gone until the next run.
  await list.getByRole("listitem", { name: "Book the final inspection" }).getByRole("button", { name: "Dismiss" }).click();
  await expect(list.getByRole("listitem", { name: "Book the final inspection" })).toHaveCount(0);

  // Show again, run again: it's back.
  await check.getByText("Hidden suggestions (1)").click();
  await check.getByRole("button", { name: "Show again" }).click();
  await check.getByRole("button", { name: "Run again" }).click();
  await expect(list.getByRole("listitem", { name: "Bad weather could delay outdoor work" })).toBeVisible();
});

test("free Plan Check tips can be turned off for the project too", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.goto(`/p/${id}`);
  await live(page);
  const check = page.getByRole("region", { name: "Plan Check" });
  const tip = check.getByRole("listitem", { name: /No availability is set for Jordan/ });
  await tip.getByRole("checkbox", { name: "Don't suggest this on this project again" }).check();
  await tip.getByRole("button", { name: "Dismiss" }).click();
  await page.reload();
  await live(page);
  await expect(check.getByRole("listitem", { name: /No availability is set for Jordan/ })).toHaveCount(0);
  await expect(check.getByText("Hidden suggestions (1)")).toBeVisible();
});

test("status report: plain from the facts, or worded by AI, then edited and copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.goto(`/p/${id}/report`);
  await live(page);
  const report = page.getByRole("region", { name: "Status report" });
  await report.getByRole("button", { name: "Write the report" }).click();
  await expect(report.getByText("Written from the plan's facts")).toBeVisible();
  await expect(report.getByLabel(/^Done since/)).toHaveValue(/Measure the kitchen \(Jordan\)/);
  await report.getByRole("checkbox", { name: /Word it with AI/ }).check();
  await report.getByRole("button", { name: "Write again" }).click();
  await expect(report.getByText("Worded by AI from the plan's facts")).toBeVisible();
  await expect(report.getByLabel("Headline")).toHaveValue(/^A steady week: \d+% done\.$/);
  await report.getByLabel("Headline").fill("A good week for the kitchen");
  await report.getByRole("button", { name: "Copy the report" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^A good week for the kitchen/);
});

test("a plan the AI declines twice is held for review: the banner shows and AI stops", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN.replace("Kitchen Remodel", "Kitchen [refuse]"));
  await page.goto(`/p/${id}`);
  await live(page);
  await page.getByRole("region", { name: "Plan Check" }).getByRole("button", { name: "Run AI check" }).click();
  await expect(page.getByText(/waiting for a safety review/).first()).toBeVisible();
  await page.reload();
  await live(page);
  await expect(page.getByText(/This plan is waiting for a safety review/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Plan Check" }).getByRole("button", { name: /Run AI check|Run again/ })).toHaveCount(0);
  // The plan itself keeps working.
  await page.getByRole("navigation", { name: "Plan views" }).getByRole("link", { name: "Checklist" }).click();
  await expect(page.getByRole("button", { name: /Mark as Doing/ }).first()).toBeEnabled();
});

test("Settings shows how much AI is left this month", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.request.post(`/api/plans/${id}/ai/check`, { data: {} });
  await page.goto("/settings");
  const card = page.getByRole("region", { name: "AI usage" });
  await expect(card.getByRole("meter", { name: "AI checks this month" })).toBeVisible();
  await expect(card.getByText(/\d+ of 100 used/).first()).toBeVisible();
  await expect(card.getByText(/Resets on /)).toBeVisible();
});
