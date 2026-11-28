/** Step N5a: the Board. Drag (desktop), arrow keys (desktop), "Move to" (phone), approvals, filters. */
import { expect, test, type Page } from "@playwright/test";
import { addPlan, signIn } from "./helpers";

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) < 1024;
const col = (page: Page, name: string) => page.getByRole("region", { name: `${name} column` });

test("board: move cards between columns, approval waits, filters", async ({ page }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-n5a-${name}.png`, fullPage: true }); };
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page, "Kim Park");
  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Board ${tag}\nstart: 2027-01-04\n---\n## P1: Design\n- [ ] T1: Sketch the logo (1d) @Kim\n- [ ] T2: Pick colors (1d) @Ana approver: Kim\n## P2: Build\n- [ ] T3: Build the site (2d) @Ana dept: IT\n- [ ] M1: Launch (milestone) depends: T3`);
  await page.goto(`/p/${id}/board`);
  await live(page);
  await expect(page.getByRole("navigation", { name: "Plan views" }).getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");

  if (isPhone(page)) {
    // One column at a time, with counts; milestones aren't cards.
    await expect(page.getByRole("radio", { name: "To do · 3" })).toBeChecked();
    await col(page, "To do").getByRole("region", { name: "Sketch the logo" }).getByLabel("Move to").selectOption("Doing");
    await expect(page.getByRole("status").filter({ hasText: "Sketch the logo moved to Doing." })).toBeVisible();
    await page.getByRole("radio", { name: "Doing · 1" }).click();
    await expect(col(page, "Doing").getByRole("button", { name: "Sketch the logo" })).toBeVisible();
    await page.getByRole("radio", { name: "To do · 2" }).click();
    await col(page, "To do").getByRole("region", { name: "Pick colors" }).getByLabel("Move to").selectOption("Done");
    await expect(page.getByRole("status").filter({ hasText: "Pick colors moved to Waiting for approval." })).toBeVisible();
    await page.getByRole("radio", { name: "Waiting for approval · 1" }).click();
    await shot("1-phone");
    // Kim is the approver: moving it on approves it.
    await col(page, "Waiting for approval").getByRole("region", { name: "Pick colors" }).getByLabel("Move to").selectOption("Done");
    await page.getByRole("radio", { name: "Done · 1" }).click();
    await expect(col(page, "Done").getByRole("button", { name: "Pick colors" })).toBeVisible();
  } else {
    await expect(page.getByRole("radiogroup", { name: "Column" })).toHaveCount(0);
    await expect(col(page, "To do").getByRole("listitem")).toHaveCount(3);
    // Drag to Doing.
    await col(page, "To do").getByRole("button", { name: "Sketch the logo" }).dragTo(col(page, "Doing"));
    await expect(col(page, "Doing").getByRole("button", { name: "Sketch the logo" })).toBeVisible();
    // Keyboard: right arrow twice from To do goes to Doing, then Waiting (it needs Kim's approval).
    await col(page, "To do").getByRole("button", { name: "Pick colors" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(col(page, "Doing").getByRole("button", { name: "Pick colors" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(col(page, "Waiting for approval").getByRole("button", { name: "Pick colors" })).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "Pick colors moved to Waiting for approval." })).toBeVisible();
    // A task with no approver can't go to Waiting.
    await col(page, "To do").getByRole("button", { name: "Build the site" }).dragTo(col(page, "Waiting for approval"));
    await expect(page.getByRole("status").filter({ hasText: "Build the site doesn't need anyone's approval." })).toBeVisible();
    await expect(col(page, "To do").getByRole("button", { name: "Build the site" })).toBeVisible();
    await shot("1-desktop");
    // Approve by moving it on.
    await col(page, "Waiting for approval").getByRole("button", { name: "Pick colors" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(col(page, "Done").getByRole("button", { name: "Pick colors" })).toBeVisible();
  }
  // The edits are real: the Checklist agrees after a reload.
  await page.reload();
  await live(page);
  const plan = (await (await page.request.get(`/api/plans/${id}`)).json()) as { plan: { phases: { tasks: { id: string; status: string; approved?: { by?: string } }[] }[] } };
  const tasks = plan.plan.phases.flatMap((p) => p.tasks);
  expect(tasks.find((t) => t.id === "T1")!.status).toBe("progress");
  expect(tasks.find((t) => t.id === "T2")).toMatchObject({ status: "done", approved: { by: "Kim Park" } });

  // Filters: person and department.
  await page.getByLabel("Person").selectOption("Ana");
  await page.getByLabel("Department").selectOption("IT");
  if (isPhone(page)) await expect(page.getByRole("radio", { name: "To do · 1" })).toBeVisible();
  await expect(col(page, "To do").getByRole("button", { name: "Build the site" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sketch the logo" })).toHaveCount(0);

  // Opening a card shows the task.
  await col(page, "To do").getByRole("button", { name: "Build the site" }).click();
  await expect(page.getByRole("dialog").getByLabel("Task", { exact: true })).toHaveValue("Build the site");
});
