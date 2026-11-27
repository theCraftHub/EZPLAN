/** Step M3: a repeating task: set it to repeat, finish it, the next one appears a week later. */
import { expect, test, type Page } from "@playwright/test";
import { addPlan, signIn } from "./helpers";

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();
const rows = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${title}`) }) });

test("recurring: make a task repeat weekly, finish it, the next one is added a week later", async ({ page }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-m3-${name}.png`, fullPage: true }); };
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page, "Kim Park");
  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Routine ${tag}\nstart: 2027-01-04\n---\n## P1: Every week\n- [ ] T1: Team check-in (1h) @Kim due: 2027-01-08`);
  await page.goto(`/p/${id}/checklist`);
  await live(page);
  await rows(page, "Team check-in").getByRole("button", { name: /^Team check-in(?!:)/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Repeats").selectOption("weekly");
  await expect(sheet.getByText("When it's done, the next one is added right after it, due a week later.")).toBeVisible();
  await shot("1-sheet");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(rows(page, "Team check-in").getByLabel("Repeats: Every week")).toBeVisible();

  await rows(page, "Team check-in").getByRole("button", { name: /Team check-in: To do/ }).click();
  await rows(page, "Team check-in").getByRole("button", { name: /Team check-in: Doing/ }).click();
  await expect(rows(page, "Team check-in")).toHaveCount(2);
  await expect(rows(page, "Team check-in").nth(1).getByLabel("Repeats: Every week")).toBeVisible();
  await expect(rows(page, "Team check-in").nth(0).getByLabel("Repeats: Every week")).toHaveCount(0);
  await shot("2-next");
  await rows(page, "Team check-in").nth(1).getByRole("button", { name: /^Team check-in(?!:)/ }).click();
  await expect(page.getByRole("dialog").getByLabel("Due by")).toHaveValue("2027-01-15");
});
