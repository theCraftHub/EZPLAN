import { expect, test, type Page } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

async function openPlan(page: Page, view = "") {
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.goto(`/p/${id}${view ? `/${view}` : ""}`);
  await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible();
  return id;
}

test("Overview shows progress, finish, next milestone and what's ready to start", async ({ page }) => {
  await openPlan(page);
  await expect(page.getByRole("heading", { name: "Kitchen Remodel" })).toBeVisible();
  await expect(page.getByText("1 of 5 tasks done")).toBeVisible();
  await expect(page.getByText("Order placed").first()).toBeVisible(); // the next milestone (on desktop it also shows in other widgets)
  const upNext = page.getByRole("region", { name: "Up next" });
  await expect(upNext.getByText("Get three contractor quotes")).toBeVisible();
  await expect(upNext.getByText("Order cabinets")).toHaveCount(0); // still waiting on the quotes
  await upNext.getByRole("button", { name: /Get three contractor quotes: Doing\. Mark as Done/ }).click();
  await expect(page.getByText("2 of 5 tasks done")).toBeVisible();
  await expect(upNext.getByText("Order cabinets")).toBeVisible();
});

test("Checklist: marking done records who did it, and it is saved", async ({ page }) => {
  const id = await openPlan(page, "checklist");
  const row = page.getByRole("region", { name: "Phase: Plan and order" }).getByRole("listitem").filter({ hasText: "Get three contractor quotes" });
  await row.getByRole("button", { name: /Mark as Done/ }).click();
  await expect(row.getByText(/Done by Alex Rivera · Jan 4/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Phase: Plan and order" }).getByText("2 of 3")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "Get three contractor quotes" }).getByText(/Done by Alex Rivera/)).toBeVisible();
  const saved = (await (await page.request.get(`/api/plans/${id}`)).json()) as { plan: { phases: { tasks: { id: string; done?: { by: string } }[] }[] } };
  expect(saved.plan.phases[0]!.tasks.find((t) => t.id === "T2")!.done!.by).toBe("Alex Rivera");
});

test("quick-add reads the shortcuts and adds the task", async ({ page }) => {
  await openPlan(page, "checklist");
  const phase = page.getByRole("region", { name: "Phase: Build" });
  const box = phase.getByLabel("Add a task to this phase");
  await box.fill("Paint walls 2d @Priya after T5 #finish");
  await expect(phase.getByText("We read: takes 2d · owner Priya · after T5 · #finish")).toBeVisible();
  await box.press("Enter");
  const row = phase.getByRole("listitem").filter({ hasText: "Paint walls" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Priya")).toBeVisible();
  await expect(row.getByText("2d")).toBeVisible();
  await expect(box).toHaveValue("");
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "Paint walls" })).toBeVisible();
});

test("the task sheet edits fields, explains bad estimates, explains the start date, and deletes to Trash", async ({ page }) => {
  await openPlan(page, "checklist");
  await page.getByRole("listitem").filter({ hasText: "Order cabinets" }).getByRole("button").nth(1).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Order cabinets" })).toBeVisible();
  await expect(sheet.getByText(/Starts|starts|after|waits|because/i).first()).toBeVisible();
  await sheet.getByLabel("Takes").fill("three days");
  await expect(sheet.getByText("Use hours, days or weeks, like 6h, 3d or 1w.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Save" })).toBeDisabled();
  await sheet.getByLabel("Takes").fill("4d");
  await sheet.getByLabel("Task").fill("Order cabinets and counters");
  await sheet.getByLabel("Owner").fill("Priya");
  await sheet.getByRole("button", { name: "Save" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Order cabinets and counters" });
  await expect(row.getByText("Priya")).toBeVisible();
  await expect(row.getByText("4d")).toBeVisible();

  await page.getByRole("listitem").filter({ hasText: "Remove old cabinets" }).getByRole("button").nth(1).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog").getByText("can be brought back for 30 days")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Remove old cabinets" })).toHaveCount(0);
});

test("live: an edit on one device appears on another without reloading", async ({ page, browser }) => {
  const id = await openPlan(page, "checklist");
  const other = await browser.newContext();
  const second = await other.newPage();
  await signIn(second);
  await second.goto(`/p/${id}/checklist`);
  await expect(second.getByRole("status").filter({ hasText: "Live" })).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "Order cabinets" }).getByRole("button", { name: /Mark as Doing/ }).click();
  await expect(second.getByRole("listitem").filter({ hasText: "Order cabinets" }).getByRole("button", { name: /Order cabinets: Doing/ })).toBeVisible();
  await other.close();
});

test("offline: changes wait, then sync when the connection is back", async ({ page, context, browser }) => {
  const id = await openPlan(page, "checklist");
  await context.setOffline(true);
  await page.evaluate(() => dispatchEvent(new Event("offline")));
  // The browser may keep the old socket briefly; closing it is what a real network drop does.
  await expect(page.getByRole("status").filter({ hasText: /^Offline ·/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("region", { name: "Phase: Build" }).getByLabel("Add a task to this phase").fill("Order handles 1d");
  await page.getByRole("region", { name: "Phase: Build" }).getByLabel("Add a task to this phase").press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "1 change will sync" })).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible({ timeout: 15_000 });
  const fresh = await browser.newContext();
  const check = await fresh.newPage();
  await signIn(check);
  await check.goto(`/p/${id}/checklist`);
  await expect(check.getByRole("listitem").filter({ hasText: "Order handles" })).toBeVisible();
  await fresh.close();
});
