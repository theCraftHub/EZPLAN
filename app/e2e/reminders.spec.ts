/** Step N2: reminders and digests. Choose them in Settings, follow a plan; the scheduled jobs deliver them. */
import { expect, test } from "@playwright/test";
import { addPlan, signIn } from "./helpers";

test("digests and weekly summaries: settings, follow a plan, delivered as notifications", async ({ page }, info) => {
  const tag = `${info.project.name}${Date.now() % 100000}`;
  // Each project uses its own days, since both sign in as the same person.
  const day = info.project.name === "phone" ? { daily: "2027-01-06", monday: "2027-01-11" } : { daily: "2027-01-07", monday: "2027-01-18" };
  await signIn(page, "Kim Park");
  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Garage ${tag}\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: Clear out (2d) @Kim\n- [ ] M1: Garage done (milestone) depends: T1`);

  await page.goto("/settings");
  const card = page.getByRole("region", { name: "Reminders and digests" });
  await card.getByLabel("How often", { exact: true }).selectOption("daily");
  await card.getByLabel("At", { exact: true }).selectOption("8");
  await card.getByLabel("Time zone", { exact: true }).selectOption("UTC");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("Saved.")).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-n2-settings.png`, fullPage: true });

  await page.goto(`/p/${id}/report`);
  await page.getByLabel("Send me a summary of this plan every Monday").check();
  await expect(page.getByLabel("Send me a summary of this plan every Monday")).toBeChecked();

  const run = async (iso: string) => (await (await page.request.post("/e2e/run-jobs", { data: { at: Date.parse(iso), jobs: ["digests", "weeklySummaries"], emails: ["kim@example.com"] } })).json()) as Record<string, number>;
  expect((await run(`${day.daily}T07:30:00Z`)).digests).toBe(0); // before 8:00
  expect((await run(`${day.daily}T08:05:00Z`)).digests).toBeGreaterThanOrEqual(1);
  expect((await run(`${day.monday}T08:05:00Z`)).weeklySummaries).toBeGreaterThanOrEqual(1);

  await page.goto("/notifications");
  await expect(page.getByText(`Weekly summary of Garage ${tag}`)).toBeVisible();
  await expect(page.getByText(/^Today: /).first()).toBeVisible();
});
