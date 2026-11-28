/** Step N5c: named baselines. Save two, switch which one the plan compares to, remove one, the limit. */
import { expect, test, type Page } from "@playwright/test";
import { addPlan, signIn } from "./helpers";

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();
const row = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${title}(?!:)`) }) });

test("named baselines: save, compare to another, remove, keep up to five", async ({ page }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-n5c-${name}.png`, fullPage: true }); };
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page, "Kim Park");
  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Fit-out ${tag}\nstart: 2027-03-01\n---\n## P1: Work\n- [ ] T1: Design (2d) @Kim\n- [ ] T2: Build (3d) @Kim depends: T1`);
  await page.goto(`/p/${id}`);
  await live(page);
  const baseline = page.getByRole("region", { name: "Baseline" });
  await baseline.getByRole("button", { name: "Set baseline" }).click();
  await baseline.getByLabel("Name for this baseline").fill("Signed contract");
  await baseline.getByRole("button", { name: "Save baseline" }).click();
  await expect(baseline.getByText(/vs "Signed contract" set/)).toBeVisible();

  // Build grows by 2 days; then a second baseline is saved from the new dates.
  await page.goto(`/p/${id}/checklist`);
  await live(page);
  await row(page, "Build").getByRole("button", { name: /^Build(?!:)/ }).click();
  await page.getByRole("dialog").getByLabel("Takes").fill("5d");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(row(page, "Build").getByText("+2d vs baseline")).toBeVisible();
  await page.goto(`/p/${id}`);
  await live(page);
  await expect(baseline.getByText("2 working days late")).toBeVisible();
  await baseline.getByRole("button", { name: "Save a new baseline" }).click();
  await baseline.getByRole("button", { name: "Save baseline" }).click(); // no name: "Baseline 2"
  await expect(baseline.getByText("On the baseline")).toBeVisible();
  await expect(baseline.getByText(/vs "Baseline 2" set/)).toBeVisible();

  // Compare to the first one again: the slip is back, with no edits to the work.
  const compare = baseline.getByLabel("Compare to");
  await expect(compare.locator("option")).toHaveText([/^Signed contract \(.*finish Mar 5\)$/, /^Baseline 2 \(.*finish Mar 9\)$/]);
  await compare.selectOption({ label: (await compare.locator("option").first().textContent())! });
  await expect(baseline.getByText("2 working days late")).toBeVisible();
  await expect(baseline.getByText(/vs "Signed contract" set/)).toBeVisible();
  await shot("1-compare");
  // The file says which one.
  const file = await (await page.request.get(`/api/plans/${id}/export`)).text();
  expect(file).toContain('baseline_name: Signed contract');

  // The one in use can't be removed; the other can.
  await baseline.getByText(/All baselines \(2 of 5\)/).click();
  await expect(baseline.getByRole("button", { name: "Remove the baseline Signed contract" })).toHaveCount(0);
  await baseline.getByRole("button", { name: "Remove the baseline Baseline 2" }).click();
  await expect(baseline.getByLabel("Compare to")).toHaveCount(0);

  // Up to five.
  for (let i = 0; i < 4; i++) expect((await page.request.post(`/api/plans/${id}/baseline`, { data: { name: `Extra ${i}` } })).status()).toBe(200);
  const sixth = await page.request.post(`/api/plans/${id}/baseline`, { data: { name: "One too many" } });
  expect(sixth.status()).toBe(400);
  expect(((await sixth.json()) as { error: string }).error).toContain("up to 5 baselines");
  await page.reload();
  await live(page);
  await expect(baseline.getByRole("button", { name: "Save a new baseline" })).toBeDisabled();
  await expect(baseline.getByText("A plan keeps up to 5 baselines. Remove one below to save another.")).toBeVisible();
});
