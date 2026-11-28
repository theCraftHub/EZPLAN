/** Step N4: costs, hourly rates and time logging; the budget on the Overview, the task sheet and the Grid. */
import { expect, test, type Page } from "@playwright/test";
import { addPlan, signIn } from "./helpers";

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();
const row = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${title}`) }) });
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) < 1024;

test("budget: planned cost from costs and rates, time logged, actual cost, over budget, CSV", async ({ page }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-n4-${name}.png`, fullPage: true }); };
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page, "Kim Park");
  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Tiling ${tag}\nstart: 2027-01-04\ncurrency: USD\n---\n## P1: Work\n- [ ] T1: Buy tiles (1d) @Kim cost: 1000\n- [ ] T2: Lay tiles (1d) @Sam depends: T1`);

  // Sam's hourly rate, set in their sheet on the Team page.
  await page.goto(`/p/${id}/team`);
  await live(page);
  if (isPhone(page)) {
    await page.getByRole("radio", { name: "By person" }).click();
    await page.getByRole("radio", { name: "Sam" }).click();
    await page.getByRole("button", { name: "Edit Sam's availability" }).click();
  } else {
    await page.getByRole("region", { name: "Team schedule grid" }).getByRole("button", { name: /^Sam/ }).click();
  }
  const person = page.getByRole("dialog", { name: "Sam's availability" });
  await person.getByLabel("Hourly rate (optional)").fill("50");
  await person.getByRole("button", { name: "Save" }).click();
  await expect(person).toBeHidden();
  const saved = (await (await page.request.get(`/api/plans/${id}`)).json()) as { people: Record<string, { rate?: number }> };
  expect(saved.people.Sam?.rate).toBe(50);

  // Overview: 1,000 set on T1 plus 50/h times Sam's 8 hours.
  await page.goto(`/p/${id}`);
  await live(page);
  const budget = page.locator('[aria-label="Budget"]');
  await expect(budget.getByText("Planned", { exact: true })).toBeVisible();
  await expect(budget.locator("dd").first()).toHaveText("$1,400");

  // Log time and an actual cost on T1.
  await page.goto(`/p/${id}/checklist`);
  await live(page);
  await row(page, "Buy tiles").getByRole("button", { name: /^Buy tiles(?!:)/ }).click();
  const money = page.getByRole("dialog").getByRole("region", { name: "Time and cost" });
  await expect(money.getByRole("status")).toContainText("No time logged yet.");
  await money.getByLabel("Hours").fill("2.5");
  await money.getByLabel("Note").fill("=SUM(A1)");
  await money.getByRole("button", { name: "Log time" }).click();
  await expect(money.getByRole("status")).toContainText("2.5 h logged of 8 h estimated.");
  await expect(money.getByRole("list", { name: "Time logged" })).toContainText("Kim · 2.5 h · =SUM(A1)");
  await money.getByLabel(/^Actual cost/).fill("1200");
  await money.getByLabel(/^Planned cost/).click();
  await expect(money.getByRole("status")).toContainText("Spent $1,200.");
  await shot("1-sheet");
  await page.keyboard.press("Escape");

  // Spreadsheet download neutralizes formulas.
  const csv = await (await page.request.get(`/api/plans/${id}/time.csv`)).text();
  expect(csv).toContain(`"Buy tiles","2.5","'=SUM(A1)"`);

  await page.goto(`/p/${id}`);
  await live(page);
  await expect(budget.getByText("Heading $200 over the plan (14%).")).toBeVisible();
  await expect(budget.getByText("2.5 h logged.")).toBeVisible();
  await shot("2-overview");

  if (!isPhone(page)) {
    await page.goto(`/p/${id}/grid`);
    await live(page);
    await expect(page.getByRole("button", { name: "Cost of Buy tiles, planned/spent: 1000/1200. Change" })).toBeVisible();
    await page.getByRole("button", { name: "Cost of Lay tiles, planned/spent: empty. Change" }).click();
    await page.getByRole("textbox", { name: /Cost of Lay tiles/ }).fill("600");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Cost of Lay tiles, planned/spent: 600. Change" })).toBeVisible();
    await shot("3-grid");
  }

  // Remove the entry again.
  await page.goto(`/p/${id}/checklist`);
  await live(page);
  await row(page, "Buy tiles").getByRole("button", { name: /^Buy tiles(?!:)/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Remove 2.5 h on/ }).click();
  await expect(page.getByRole("dialog").getByRole("region", { name: "Time and cost" }).getByRole("status")).toContainText("No time logged yet.");
});
