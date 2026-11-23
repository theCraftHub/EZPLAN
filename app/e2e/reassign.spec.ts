import { expect, test, type Page } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

const TEAM_PLAN = KITCHEN.replace("- [ ] M2: Kitchen ready (milestone) depends: T5", "- [ ] T6: Paint the pantry (3d) @Jordan depends: M1\n- [ ] M2: Kitchen ready (milestone) depends: T5, T6");
const finishOf = async (page: Page, id: string) => ((await (await page.request.get(`/api/plans/${id}`)).json()) as { schedule: { finish: string } }).schedule.finish;
const ownerOf = async (page: Page, id: string, task: string) => ((await (await page.request.get(`/api/plans/${id}`)).json()) as { plan: { phases: { tasks: { id: string; owner?: string }[] }[] } }).plan.phases.flatMap((p) => p.tasks).find((t) => t.id === task)!.owner;

async function setup(page: Page) {
  await signIn(page);
  const id = await addPlan(page, TEAM_PLAN);
  await page.request.put(`/api/plans/${id}/people/Priya`, { data: { hoursPerWeek: 40 } });
  await page.goto(`/p/${id}/team`);
  await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible();
  return id;
}

test.describe("desktop", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, "the grid is the desktop layout");

  test("drag a task to another person: rows say who has room, the preview matches the result", async ({ page }) => {
    const id = await setup(page);
    const before = await finishOf(page, id);
    const grid = page.getByRole("region", { name: "Team schedule grid" });
    const block = grid.getByRole("button", { name: /^Paint the pantry, / }).first();
    const priyaRow = grid.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /Priya/ }) });
    await block.dragTo(priyaRow.getByRole("cell").nth(10));
    const preview = page.getByRole("dialog", { name: "Preview the change" });
    await expect(preview).toContainText('Give "Paint the pantry" to Priya?');
    await expect(preview).toContainText(/earlier/);
    const promised = /→ (\w+ \d+)/.exec((await preview.textContent())!)![1]!;
    await preview.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => ownerOf(page, id, "T6")).toBe("Priya");
    const after = await finishOf(page, id);
    expect(after < before).toBe(true);
    expect(new Date(`${after}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })).toBe(promised);
  });

  test("keyboard: arrow keys pick a person, Enter previews, Escape cancels", async ({ page }) => {
    const id = await setup(page);
    const grid = page.getByRole("region", { name: "Team schedule grid" });
    const block = grid.getByRole("button", { name: /^Paint the pantry, / }).first();
    await block.focus();
    await page.keyboard.press("ArrowDown");
    await expect(grid.getByRole("rowheader", { name: /Priya/ })).toContainText(/Fits|Less free time then/);
    await page.keyboard.press("Escape");
    await expect(grid.getByText("Fits")).toHaveCount(0);
    await block.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "Preview the change" }).getByRole("button", { name: "Cancel" }).click();
    expect(await ownerOf(page, id, "T6")).toBe("Jordan");
  });
});

test("the task sheet lists the best people for a task, with who has room", async ({ page }) => {
  const id = await setup(page);
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await page.getByRole("radio", { name: "By person" }).click();
    await page.getByRole("radio", { name: "Jordan" }).click();
    const task = page.getByRole("button", { name: /^Paint the pantry/ }).first();
    for (let i = 0; i < 6 && !(await task.isVisible()); i++) await page.getByRole("button", { name: "Next week" }).click();
    await task.click();
  } else {
    await page.getByRole("region", { name: "Team schedule grid" }).getByRole("button", { name: /^Paint the pantry, / }).first().click();
  }
  const best = page.getByRole("dialog").getByRole("region", { name: "Best people for this task" });
  await expect(best.getByRole("button", { name: /Give to Priya/ })).toContainText(/Free then|Less free time then/);
  await best.getByRole("button", { name: /Give to Priya/ }).click();
  await expect.poll(() => ownerOf(page, id, "T6")).toBe("Priya");
});
