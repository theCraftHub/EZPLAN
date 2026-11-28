/** Step N5d: "Try a change" on a plan's Overview. Nothing changes until "Make this change". */
import { expect, test, type Page } from "@playwright/test";
import { addPlan, signIn } from "./helpers";

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();

test("try a change: a task takes longer, someone is away; make one of them", async ({ page }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-n5d-${name}.png`, fullPage: true }); };
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page, "Kim Park");
  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Launch ${tag}\nstart: 2027-03-01\n---\n## P1: Work\n- [ ] T1: Write copy (2d) @Ana\n- [ ] T2: Build page (3d) @Jo depends: T1\n- [ ] M1: Live (milestone) depends: T2`);
  await page.goto(`/p/${id}`);
  await live(page);
  const card = page.getByRole("region", { name: "Try a change" });
  await card.getByLabel("What if").selectOption({ label: "A task takes longer" });
  await card.getByLabel("Task").selectOption({ label: "Write copy" });
  await card.getByLabel("More working days").fill("2");
  await expect(card.getByText("The finish moves from Mar 5 to Mar 9 (2 working days later).")).toBeVisible();
  await expect(card.getByText("Live: Mar 5 → Mar 9")).toBeVisible();
  await expect(card.getByText("2 tasks would finish on a different day.")).toBeVisible();
  await shot("1-longer");
  // Nothing was saved.
  const est = async () => ((await (await page.request.get(`/api/plans/${id}`)).json()) as { plan: { phases: { tasks: { id: string; estimate?: { amount: number; unit: string } }[] }[] } }).plan.phases[0]!.tasks[0]!.estimate;
  expect(await est()).toEqual({ amount: 2, unit: "d" });

  await card.getByLabel("What if").selectOption({ label: "Someone is away" });
  await card.getByLabel("Person").selectOption("Jo");
  await card.getByLabel("From").fill("2027-04-01");
  await expect(card.getByText("The finish stays Mar 5.")).toBeVisible();
  await card.getByLabel("From").fill("2027-03-03");
  await card.getByLabel("Working days").fill("2");
  await expect(card.getByText(/The finish moves from Mar 5 to Mar 9/)).toBeVisible();

  // Make the first one for real.
  await card.getByLabel("What if").selectOption({ label: "A task takes longer" });
  await card.getByLabel("Task").selectOption({ label: "Write copy" });
  await card.getByLabel("More working days").fill("1");
  await card.getByRole("button", { name: "Make this change" }).click();
  await expect(card.getByText("Done: Write copy takes 1 more working day.")).toBeVisible();
  await expect.poll(est).toEqual({ amount: 3, unit: "d" });
});
