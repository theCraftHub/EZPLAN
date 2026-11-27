/** Speed on a big plan (2,000 tasks, 50 people). Run alone: npx playwright test e2e/speed.spec.ts */
import { expect, test } from "@playwright/test";
import { bigPlan } from "./bigplan";
import { signIn } from "./helpers";

test.skip(!process.env.SPEED, "speed checks only when SPEED=1");

test("big plan: open, switch views, edit", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const res = await page.request.post("/api/plans", { data: { text: bigPlan() } });
  expect(res.status(), await res.text()).toBe(201);
  const id = ((await res.json()) as { id: string }).id;
  // Budgets from plan section 12 (with room for slower test machines).
  const time = async (label: string, fn: () => Promise<void>, budget = 1500) => {
    const t0 = Date.now();
    await fn();
    const ms = Date.now() - t0;
    console.log(`${test.info().project.name} ${label}: ${ms} ms`);
    expect(ms, `${label} within ${budget} ms`).toBeLessThan(budget);
    return ms;
  };
  await time("open overview", async () => { await page.goto(`/p/${id}`); await page.getByRole("status").filter({ hasText: "Live" }).waitFor(); });
  await time("checklist", async () => { await page.getByRole("navigation", { name: "Plan views" }).getByRole("link", { name: "Checklist" }).click(); await page.getByRole("region", { name: "Phase: Workstream 20" }).waitFor(); });
  // Measured inside the page: from the tap to the changed button being on screen.
  const editMs = await page.evaluate(() => new Promise<number>((done) => {
    const find = (s: string) => [...document.querySelectorAll("button[aria-label]")].find((b) => b.getAttribute("aria-label")!.startsWith(s)) as HTMLButtonElement | undefined;
    const t0 = performance.now();
    find("Task 2: To do")!.click();
    const check = () => (find("Task 2: Doing") ? requestAnimationFrame(() => done(Math.round(performance.now() - t0))) : requestAnimationFrame(check));
    check();
  }));
  console.log(`${test.info().project.name} edit to paint (in page): ${editMs} ms`);
  expect(editMs, "a tap shows within 100 ms").toBeLessThan(100);
  await time("timeline", async () => { await page.getByRole("navigation", { name: "Plan views" }).getByRole("link", { name: "Timeline" }).click(); await page.getByRole("region", { name: "Timeline" }).waitFor(); });
  await time("grid", async () => { await page.getByRole("navigation", { name: "Plan views" }).getByRole("link", { name: "Grid" }).click(); await page.getByRole("table", { name: "Tasks" }).waitFor(); });
  const gridScroll = await page.evaluate(async () => {
    let worst = 0; let last = performance.now();
    const stop = performance.now() + 2000;
    await new Promise<void>((done) => { const tick = (t: number) => { worst = Math.max(worst, t - last); last = t; scrollBy(0, 60); if (t < stop) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
    return { worstFrameMs: Math.round(worst), rows: document.querySelectorAll('[role="table"] [role="row"]').length };
  });
  console.log(`${test.info().project.name} grid scroll: ${JSON.stringify(gridScroll)}`);
  expect(gridScroll.worstFrameMs, "no frame slower than 50 ms while scrolling the grid").toBeLessThan(50);
  expect(gridScroll.rows, "only rows near the screen are drawn").toBeLessThan(200);
  await time("team", async () => { await page.getByRole("navigation", { name: "Plan views" }).getByRole("link", { name: "Team" }).click(); await page.getByRole("button", { name: "Add person" }).waitFor(); });
  const frames = await page.evaluate(async () => {
    const el = document.querySelector('[aria-label="Team schedule grid"]') ?? document.scrollingElement!;
    const box = (el as HTMLElement).closest(".overflow-x-auto") ?? el;
    let n = 0; let worst = 0; let last = performance.now();
    const stop = performance.now() + 2000;
    await new Promise<void>((done) => { const tick = (t: number) => { worst = Math.max(worst, t - last); last = t; n++; (box as HTMLElement).scrollLeft += 30; scrollBy(0, 40); if (t < stop) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
    return { fps: Math.round(n / 2), worstFrameMs: Math.round(worst) };
  });
  console.log(`${test.info().project.name} team scroll: ${JSON.stringify(frames)}`);
  expect(frames.worstFrameMs, "no frame slower than 50 ms while scrolling").toBeLessThan(50);
  const dom = await page.evaluate(() => document.querySelectorAll("*").length);
  console.log(`${test.info().project.name} team DOM nodes: ${dom}`);
  expect(dom).toBeLessThan(8000);
});

test("admin console People with 1,000 people: open, filter, select all, preview", async ({ page }, info) => {
  test.setTimeout(180_000);
  await signIn(page, "Dana Reyes");
  const org = (await (await page.request.post("/api/orgs", { data: { name: `Big Co ${info.project.name}${Date.now() % 100000}`, people: 1001 } })).json()) as { id: string };
  const people = Array.from({ length: 1000 }, (_, i) => ({ email: `person${i}@bigco.example`, name: `Person ${String(i).padStart(4, "0")}`, department: ["Field Ops", "Office", "Estimating", "Safety"][i % 4] }));
  const sent = await page.request.post(`/api/orgs/${org.id}/invites`, { data: { people }, timeout: 120_000 });
  expect(sent.status(), await sent.text()).toBe(201);
  const time = async (label: string, fn: () => Promise<void>, budget = 1500) => {
    const t0 = Date.now();
    await fn();
    const ms = Date.now() - t0;
    console.log(`${info.project.name} ${label}: ${ms} ms`);
    expect(ms, `${label} within ${budget} ms`).toBeLessThan(budget);
  };
  await time("open People (1,001)", async () => { await page.goto(`/admin/org/${org.id}/people`); await page.getByText("Showing 1001 people").waitFor(); }, 2500);
  await time("filter by department", async () => { await page.getByRole("button", { name: "Office", exact: true }).click(); await page.getByText("Showing 250 people of 1001").waitFor(); });
  await time("search", async () => { await page.getByLabel("Search").fill("Person 09"); await page.getByText(/^Showing 2[05] people of 1001$/).waitFor(); });
  await page.getByLabel("Search").fill("");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await time("select all", async () => { await page.getByLabel("Select everyone shown").check(); await page.getByText("1001 people selected").waitFor(); });
  await time("preview a change for everyone", async () => {
    const bar = page.getByRole("region", { name: "Change selected people" });
    await bar.getByLabel("Change", { exact: true }).selectOption("department");
    await bar.getByLabel("Department").fill("Everyone");
    await bar.getByRole("button", { name: "Preview" }).click();
    await bar.getByText("1001 people will change").waitFor();
  }, 3000);
});
