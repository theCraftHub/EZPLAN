/** Step N3: calendars. A private feed of my tasks, busy times from my calendar, public holidays, and a plan's .ics. */
import { expect, test } from "@playwright/test";
import { addPlan, planAction, signIn } from "./helpers";

test("calendars: my feed, my calendar's busy times, public holidays, a plan's calendar file", async ({ page, browser }, info) => {
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page, "Kim Park");
  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Shelves ${tag}\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: Build shelves (2d) @Kim`);
  try {
    await page.goto("/settings");
    const card = page.getByRole("region", { name: "Calendars" });
    await card.getByRole("button", { name: "Make my calendar link" }).click();
    const url = (await card.locator("code").innerText()).trim();
    const outsider = await browser.newContext();
    const feed = await outsider.request.get(new URL(url).pathname);
    expect(feed.status()).toBe(200);
    expect(await feed.text()).toContain("SUMMARY:Build shelves");
    await outsider.close();

    await card.getByLabel("Private calendar address").fill("https://calendar.google.com/calendar/ical/kim/private-1/basic.ics");
    await card.getByRole("button", { name: "Connect" }).click();
    await expect(card.getByText(/Connected to calendar\.google\.com/)).toBeVisible();
    await expect(card.getByRole("list", { name: "Busy in the next two weeks" })).toContainText("Jan 5: all day");
    if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-n3-calendars.png`, fullPage: true });

    // Busy all of Jan 5, so the two-day task ends Jan 6 instead of Jan 5.
    const finish = async () => ((await (await page.request.get("/api/plans")).json()) as { plans: { id: string; summary: { finish: string } }[] }).plans.find((p) => p.id === id)!.summary.finish;
    expect(await finish()).toBe("2027-01-06");

    const week = page.getByRole("region", { name: "Standard work week" });
    await week.getByLabel("Public holidays", { exact: true }).selectOption("US");
    await week.getByRole("button", { name: "Preview changes" }).click();
    await week.getByRole("button", { name: "Save" }).click();
    await expect(week.getByText(/^Saved\./)).toBeVisible();

    await page.goto(`/p/${id}`);
    const download = page.waitForEvent("download");
    await planAction(page, "Add to calendar");
    expect((await download).suggestedFilename()).toBe(`Shelves ${tag}.ics`);
  } finally {
    // Leave Kim as other tests expect: no calendar, no holidays.
    // (Changes without an Origin must be JSON, like every request from the app.)
    await page.request.delete("/api/me/calendar-busy", { data: {} });
    await page.request.delete("/api/me/calendar-feed", { data: {} });
    const me = (await (await page.request.get("/api/me")).json()) as { workspaces: { id: string }[] };
    await page.request.put(`/api/workspaces/${me.workspaces[0]!.id}/work-week`, { data: { hoursPerWeek: 40, workdays: [1, 2, 3, 4, 5], holidayCountry: null } });
  }
});
