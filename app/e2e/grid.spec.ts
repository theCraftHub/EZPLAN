/** Step J3: Grid + Gantt on desktop; edits in cells are ordinary live edits; phones get a pointer to the Checklist. */
import { expect, test } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

test("grid: edit cells in place, dates follow, bad input refused, sort; phones are pointed to the Checklist", async ({ page }, info) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN.replace("title: Kitchen Remodel", `title: Grid Kitchen ${info.project.name}`));
  await page.goto(`/p/${id}/grid`);
  await page.getByRole("status").filter({ hasText: /^Live/ }).waitFor();
  if (info.project.name === "phone") {
    await expect(page.getByText(/The grid works best on a larger screen/)).toBeVisible();
    await page.getByRole("link", { name: "Checklist" }).last().click();
    await expect(page.getByRole("region", { name: "Phase: Plan and order" })).toBeVisible();
    return;
  }
  const grid = page.getByRole("table", { name: "Tasks" });
  const row = (title: string) => grid.getByRole("row", { name: title });
  await expect(row("Order cabinets").getByRole("cell").nth(5)).toHaveText("Jan 7");

  // Owner: click, type, Enter.
  await row("Order cabinets").getByRole("button", { name: /^Owner of Order cabinets: Jordan/ }).click();
  await page.getByLabel("Owner of Order cabinets").fill("Priya");
  await page.getByLabel("Owner of Order cabinets").press("Enter");
  await expect(row("Order cabinets").getByRole("button", { name: /^Owner of Order cabinets: Priya/ })).toBeVisible();

  // Takes: 2d → 5d moves its finish and what waits on it.
  await row("Order cabinets").getByRole("button", { name: /^How long Order cabinets takes/ }).click();
  await page.getByLabel("How long Order cabinets takes").fill("5d");
  await page.getByLabel("How long Order cabinets takes").press("Enter");
  await expect(row("Order cabinets").getByRole("cell").nth(5)).toHaveText("Jan 12");

  // A task that doesn't exist can't be waited on; Escape leaves it as it was.
  await row("Order cabinets").getByRole("button", { name: /^What Order cabinets waits on: T2/ }).click();
  await page.getByLabel("What Order cabinets waits on").fill("T2, T99");
  await expect(page.getByLabel("What Order cabinets waits on")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("What Order cabinets waits on").press("Escape");
  await expect(row("Order cabinets").getByRole("button", { name: /^What Order cabinets waits on: T2\. Change$/ })).toBeVisible();

  // Status from the grid; the Checklist shows the same plan.
  await row("Order cabinets").getByLabel("Status of Order cabinets").selectOption("progress");
  if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-j3-grid.png`, fullPage: true });

  // Sort by finish, latest first.
  await grid.getByRole("button", { name: /^Finish/ }).click();
  await grid.getByRole("button", { name: /^Finish/ }).click();
  const last = await row("Kitchen ready").getByRole("cell").nth(5).textContent(); // the final milestone ends the plan
  await expect(grid.getByRole("row").nth(1).getByRole("cell").nth(5)).toHaveText(last!); // the latest finish comes first
  await expect(grid.getByRole("row").last().getByRole("cell").nth(5)).toHaveText("Jan 4");
  await page.getByRole("button", { name: "Group by phase again" }).click();

  await page.getByRole("link", { name: "Checklist", exact: true }).click();
  const cab = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Order cabinets(?!:)/ }) });
  await expect(cab.getByText("Priya")).toBeVisible();
  await expect(cab.getByText("5d")).toBeVisible();
  await expect(cab.getByRole("button", { name: /Order cabinets: Doing/ })).toBeVisible();
});
