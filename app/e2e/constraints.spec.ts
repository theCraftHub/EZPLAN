/** Step N5b: "can't start before" from the task sheet and by moving Timeline bars; the reason is shown. */
import { expect, test, type Page } from "@playwright/test";
import { addPlan, signIn } from "./helpers";

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();
const row = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${title}`) }) });
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) < 1024;
const taskOf = async (page: Page, id: string, tid: string) => ((await (await page.request.get(`/api/plans/${id}`)).json()) as { plan: { phases: { tasks: { id: string; notBefore?: string; due?: string }[] }[] } }).plan.phases.flatMap((p) => p.tasks).find((t) => t.id === tid)!;

test("constraints: set a start date in the task, move bars on the Timeline", async ({ page }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-n5b-${name}.png`, fullPage: true }); };
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page, "Kim Park");
  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Office move ${tag}\nstart: 2027-03-01\n---\n## P1: Move\n- [ ] T1: Book movers (1d) @Kim finish: by 2027-03-01\n- [ ] T2: Pack the desks (2d) @Ana\n- [ ] T3: Move day (1d) @Kim depends: T2`);

  // In the task: can't start before Mar 10.
  await page.goto(`/p/${id}/checklist`);
  await live(page);
  await row(page, "Pack the desks").getByRole("button", { name: /^Pack the desks(?!:)/ }).click();
  let sheet = page.getByRole("dialog");
  await sheet.getByLabel("Can't start before").fill("2027-03-10");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(row(page, "Pack the desks")).toContainText("Mar 10 to Mar 11");
  await row(page, "Pack the desks").getByRole("button", { name: /^Pack the desks(?!:)/ }).click();
  sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Starts Mar 10 because it can't start before then.")).toBeVisible();
  await shot("1-sheet");
  await page.keyboard.press("Escape");
  expect((await taskOf(page, id, "T2")).notBefore).toBe("2027-03-10");
  // "finish: by" is the due date.
  expect((await taskOf(page, id, "T1")).due).toBe("2027-03-01");

  // Timeline: arrow keys move the bar a day (Shift: a week).
  await page.goto(`/p/${id}/timeline`);
  await live(page);
  const chart = page.getByRole("region", { name: "Timeline" });
  const bar = chart.getByRole("button", { name: /^Move Pack the desks, starts Mar 10/ });
  await bar.focus();
  await page.keyboard.press("ArrowRight");
  await expect(chart.getByRole("button", { name: /^Move Pack the desks, starts Mar 11/ })).toBeFocused();
  await expect(chart.getByRole("status")).toContainText("Pack the desks can't start before Mar 11 now.");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(chart.getByRole("listitem", { name: /^Pack the desks: Mar 4 to Mar 5/ })).toBeVisible();
  // Move day follows its predecessor.
  await expect(chart.getByRole("listitem", { name: /^Move day: Mar 8/ })).toBeVisible();

  if (!isPhone(page)) {
    // Drag Book movers three days to the right (Day zoom is 36 px a day).
    const b = chart.getByRole("button", { name: /^Move Book movers, starts Mar 1/ });
    const box = (await b.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 10 + 36 * 3, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(chart.getByRole("listitem", { name: /^Book movers: Mar 4 to Mar 4/ })).toBeVisible();
    expect((await taskOf(page, id, "T1")).notBefore).toBe("2027-03-04");
    await shot("2-timeline");
  }
  // Plan Check flags the finish date it now misses.
  await page.goto(`/p/${id}`);
  await live(page);
  if (!isPhone(page)) await expect(page.getByText(/"Book movers" is scheduled to finish 2027-03-04, after its due date 2027-03-01/)).toBeVisible();
});
