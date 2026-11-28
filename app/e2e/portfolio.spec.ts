/** Step M1: Home as a portfolio (Active / Completed / Archived, search), archive and restore, reuse as template. */
import { expect, test } from "@playwright/test";
import { addPlan, openView, signIn } from "./helpers";

test("portfolio: tabs, search, archive and restore, archived plans are read-only, reuse a finished plan", async ({ page }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-m1-${name}.png`, fullPage: true }); };
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page, "Kim Park");
  await addPlan(page, `---\nrakuplan: 1\ntitle: Porch ${tag}\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: Frame (2d)\n- [ ] T2: Deck (2d) depends: T1`);
  await addPlan(page, `---\nrakuplan: 1\ntitle: Fence ${tag}\nstart: 2027-01-04\n---\n## P1: Work\n- [x] T1: Posts (2d) done: 2027-01-05 by Kim\n- [x] T2: Rails (1d) due: 2027-01-08 done: 2027-01-07 by Kim`);
  await page.goto("/");
  await page.getByLabel("Search plans").fill(tag);
  const plans = page.getByRole("list", { name: "Your plans" });
  await expect(plans.getByRole("listitem")).toHaveCount(1);
  await expect(plans).toContainText(`Porch ${tag}`);
  await expect(plans).toContainText(/Plan Check \d+/);
  await shot("1-active");

  await page.getByRole("tab", { name: /^Completed/ }).click();
  await expect(plans).toContainText(`Fence ${tag}`);
  await expect(plans).toContainText("Took 4 days");
  await expect(plans).toContainText("100% of tasks on time");
  await shot("2-completed");

  await page.getByRole("tab", { name: /^Active/ }).click();
  await page.getByRole("button", { name: `Archive Porch ${tag}` }).click();
  await expect(page.getByText("No plans match.")).toBeVisible();
  await page.getByRole("tab", { name: /^Archived/ }).click();
  await expect(plans).toContainText(`Porch ${tag}`);
  await expect(plans).toContainText(/Archived \w+ \d+/);
  await shot("3-archived");
  await plans.getByRole("link", { name: new RegExp(`Porch ${tag}`) }).click();
  await expect(page.getByText("This plan is archived. It's read-only for everyone until it's restored.")).toBeVisible();
  await openView(page, "Checklist");
  await expect(page.getByRole("button", { name: /Frame: To do/ })).toBeDisabled();
  await shot("4-read-only");
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("This plan is archived.")).toHaveCount(0);

  await page.goto("/");
  await page.getByRole("tab", { name: /^Completed/ }).click();
  await page.getByLabel("Search plans").fill(tag);
  await page.getByRole("button", { name: `Reuse Fence ${tag} as a template` }).click();
  await expect(page.getByLabel("Plan name")).toHaveValue(`Fence ${tag} (copy)`);
});
