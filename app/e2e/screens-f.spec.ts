import { test } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

test.skip(!process.env.SHOTS, "screenshots only when SHOTS=1");
const TEAM_PLAN = KITCHEN.replace("- [ ] M2: Kitchen ready (milestone) depends: T5", "- [ ] T6: Paint the pantry (3d) @Jordan depends: M1\n- [ ] M2: Kitchen ready (milestone) depends: T5, T6");

test("step F screens", async ({ page }, info) => {
  const out = (n: string) => `e2e/.results/shots/${info.project.name}-${n}.png`;
  await signIn(page);
  const id = await addPlan(page, TEAM_PLAN);
  await page.request.put(`/api/plans/${id}/people/Priya`, { data: { hoursPerWeek: 20 } });
  await page.goto(`/p/${id}/team`);
  await page.getByRole("status").filter({ hasText: "Live" }).waitFor();
  if (info.project.name === "desktop") {
    const block = page.getByRole("region", { name: "Team schedule grid" }).getByRole("button", { name: /^Paint the pantry, / }).first();
    await block.focus();
    await page.keyboard.press("ArrowDown");
    await page.screenshot({ path: out("f-pick") });
    await page.keyboard.press("Enter");
    await page.screenshot({ path: out("f-preview") });
  } else {
    await page.getByRole("radio", { name: "By person" }).click();
    await page.getByRole("radio", { name: "Jordan" }).click();
    const task = page.getByRole("button", { name: /^Paint the pantry/ }).first();
    for (let i = 0; i < 6 && !(await task.isVisible()); i++) await page.getByRole("button", { name: "Next week" }).click();
    await task.click();
    await page.getByRole("region", { name: "Best people for this task" }).getByRole("button").first().waitFor();
    await page.screenshot({ path: out("f-best") });
  }
});
