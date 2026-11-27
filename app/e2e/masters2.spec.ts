/** Step M6: paste a whole master plan; take a plan out and add it back; the roll-up report; departments on phones. */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("master plan from one pasted text, manage its plans, roll-up report, departments", async ({ page }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-m6-${name}.png`, fullPage: true }); };
  const tag = `${info.project.name}${Date.now() % 100000}`;
  const text = `---\nrakuplan: 1\ntitle: Clinic ${tag}\nstart: 2027-01-04\n---\n## P1: Whole building\n- [ ] M1: Permit approved (milestone)\n\n# Plan: Lobby ${tag}\n## P1: Front\n- [ ] T1: Strip floors (2d) @Kai dept: Facilities depends: master/M1\n- [ ] T2: New desk (3d) @Ivan dept: IT depends: T1\n\n# Plan: Lab ${tag}\n## P1: Rooms\n- [ ] T1: Benches (3d) @Kai dept: Facilities\n`;
  await signIn(page, "Kim Park");
  await page.goto("/new");
  await page.getByRole("button", { name: /I already have a reply or a plan file/ }).click();
  await page.getByLabel(/Paste your assistant's whole reply/).fill(text);
  await page.getByRole("button", { name: "Check my plan" }).click();
  const preview = page.getByRole("region", { name: "Master plan preview" });
  await expect(preview).toContainText(`Clinic ${tag}: a master plan with 2 plans`);
  await expect(preview.getByRole("list", { name: "Plans in it" }).getByRole("listitem")).toHaveCount(3);
  await shot("1-preview");
  await preview.getByRole("button", { name: "Save the master plan" }).click();
  await expect(page.getByRole("heading", { name: `Clinic ${tag}` })).toBeVisible();

  // Take a plan out, then add it back.
  const manage = page.getByRole("region", { name: "Plans in this master" });
  await manage.getByRole("button", { name: `Take Lab ${tag} out` }).click();
  await manage.getByRole("button", { name: "Take out", exact: true }).click();
  await expect(manage.getByRole("link", { name: `Lab ${tag}` })).toHaveCount(0);
  await manage.getByLabel("Add a plan").selectOption({ label: `Lab ${tag}` });
  await manage.getByRole("button", { name: "Add to the master" }).click();
  await expect(manage.getByRole("link", { name: `Lab ${tag}` })).toBeVisible();
  await shot("2-manage");

  // Roll-up report.
  await page.getByRole("navigation", { name: "Master plan views" }).getByRole("link", { name: "Report" }).click();
  const report = page.getByRole("region", { name: "Roll-up report" });
  await expect(report).toContainText(`Clinic ${tag}: status`);
  await expect(report).toContainText(`- Lobby ${tag}:`);
  await expect(report).toContainText("Permit approved:");
  await shot("3-report");

  // Departments: each person's 8 weeks fit the screen.
  await page.getByRole("navigation", { name: "Master plan views" }).getByRole("link", { name: "Departments" }).click();
  const facilities = page.getByRole("region", { name: "Department Facilities" });
  await expect(facilities).toBeVisible();
  const box = await facilities.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await shot("4-departments");
});
