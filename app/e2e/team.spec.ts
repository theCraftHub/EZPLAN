import { expect, test, type Page } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

// Jordan has two tasks that could run side by side, so a second person can finish sooner.
const TEAM_PLAN = KITCHEN.replace("- [ ] M2: Kitchen ready (milestone) depends: T5", "- [ ] T6: Paint the pantry (3d) @Jordan depends: M1\n- [ ] M2: Kitchen ready (milestone) depends: T5, T6");

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible();
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) < 1024;

async function openPerson(page: Page, name: string) {
  if (isPhone(page)) {
    await page.getByRole("radio", { name: "By person" }).click();
    await page.getByRole("radio", { name }).click();
    await page.getByRole("button", { name: `Edit ${name}'s availability` }).click();
  } else {
    await page.getByRole("region", { name: "Team schedule grid" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  }
}

test("Timeline draws every task with its dates and marks the critical path", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.goto(`/p/${id}/timeline`);
  await live(page);
  const chart = page.getByRole("region", { name: "Timeline" });
  await expect(chart.getByRole("listitem", { name: /^Order cabinets: Jan 6 to Jan 7, critical$/ })).toBeVisible();
  await expect(chart.getByRole("listitem", { name: /^Measure the kitchen: .*, done$/ })).toBeVisible();
  await expect(chart.getByRole("listitem", { name: /^Kitchen ready: Jan 15, critical$/ })).toBeVisible();
  await chart.getByRole("radio", { name: "Week" }).click();
  await expect(chart.getByRole("radio", { name: "Week" })).toHaveAttribute("aria-checked", "true");
});

test("adding a person suggests the task that finishes the plan sooner, and applying it moves the finish", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, TEAM_PLAN);
  await page.goto(`/p/${id}/team`);
  await live(page);
  const before = (await (await page.request.get(`/api/plans/${id}`)).json()) as { schedule: { finish: string } };
  await page.getByRole("button", { name: "Add person" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name").fill("Sam");
  await sheet.getByRole("radiogroup", { name: "Hours a week for this project" }).getByRole("radio", { name: "20 h/week" }).click();
  await sheet.getByRole("button", { name: "Add to plan" }).click();
  await expect(page.getByText(/Sam is on the plan\. Giving Sam ".+" moves the finish to/)).toBeVisible();
  await page.getByRole("button", { name: "Give it to Sam" }).click();
  await expect.poll(async () => ((await (await page.request.get(`/api/plans/${id}`)).json()) as { schedule: { finish: string } }).schedule.finish < before.schedule.finish).toBe(true);
  const after = (await (await page.request.get(`/api/plans/${id}`)).json()) as { people: Record<string, unknown>; plan: { phases: { tasks: { owner?: string }[] }[] } };
  expect(after.people.Sam).toEqual({ hoursPerWeek: 20 });
  expect(after.plan.phases.flatMap((p) => p.tasks).some((t) => t.owner === "Sam")).toBe(true);
});

test("changing someone's hours and days off reschedules the plan and is saved", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.goto(`/p/${id}/team`);
  await live(page);
  const finish = page.getByText(/^(Mon|Tue|Wed|Thu|Fri), /).first();
  const before = await finish.textContent();
  await openPerson(page, "Jordan");
  const sheet = page.getByRole("dialog", { name: "Jordan's availability" });
  await sheet.getByRole("radiogroup", { name: "Hours a week for this project" }).getByRole("radio", { name: "20 h/week" }).click();
  await sheet.getByLabel("First day off").fill("2027-01-07");
  await sheet.getByLabel("Last day off").fill("2027-01-08");
  await sheet.getByRole("button", { name: "Add days off" }).click();
  await expect(sheet.getByText(/Jan 7, 2027 to .*Jan 8, 2027/)).toBeVisible();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(finish).not.toHaveText(before!);
  const saved = (await (await page.request.get(`/api/plans/${id}`)).json()) as { people: Record<string, unknown> };
  expect(saved.people.Jordan).toEqual({ hoursPerWeek: 20, timeOff: [{ start: "2027-01-07", end: "2027-01-08" }] });
  await page.reload();
  await live(page);
  if (isPhone(page)) {
    await page.getByRole("radio", { name: /^Th\s*7/ }).click();
    await expect(page.getByText("Off: Day off").first()).toBeVisible();
  } else {
    await expect(page.getByRole("region", { name: "Team schedule grid" }).getByText(/Thu, Jan 7, 2027: Day off/)).toBeAttached();
  }
});

test("My availability adds you to the plan with your own hours", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.goto(`/p/${id}/team`);
  await live(page);
  await page.getByRole("button", { name: "My availability" }).click();
  const sheet = page.getByRole("dialog", { name: "My availability" });
  await expect(sheet.getByLabel("Name")).toHaveValue("Alex");
  await sheet.getByRole("radiogroup", { name: "Hours a week for this project" }).getByRole("radio", { name: "Custom" }).click();
  await sheet.getByLabel("Hours a week (1 to 60)").fill("12");
  await sheet.getByRole("button", { name: "Add to plan" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = (await (await page.request.get(`/api/plans/${id}`)).json()) as { people: Record<string, unknown> };
  expect(saved.people.Alex).toEqual({ hoursPerWeek: 12 });
});

test("the workspace work week shows each plan's new finish before saving, and Full time follows it", async ({ page }) => {
  await signIn(page);
  await addPlan(page, KITCHEN);
  await page.goto("/settings");
  const card = page.getByRole("region", { name: "Standard work week" });
  try {
    await card.getByRole("button", { name: "Thu" }).click();
    await card.getByRole("button", { name: "Fri" }).click();
    await card.getByRole("button", { name: "Preview changes" }).click();
    await expect(card.getByText(/Before you save: \d+ of \d+ plans change their finish date/)).toBeVisible();
    await expect(card.getByText(/Kitchen Remodel: Jan \d+ → Jan \d+/).first()).toBeVisible();
    await card.getByRole("button", { name: "Cancel" }).click();
    await card.getByRole("button", { name: "Thu" }).click();
    await card.getByRole("button", { name: "Fri" }).click();
    await card.getByRole("button", { name: "37.5 h" }).click();
    await card.getByRole("button", { name: "Preview changes" }).click();
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText("Saved.")).toBeVisible();
    await page.goto("/new");
    await page.getByRole("button", { name: /I already have a reply or a plan file/ }).click();
    await page.getByLabel(/Paste your assistant's whole reply/).fill(KITCHEN);
    await page.getByRole("button", { name: "Check my plan" }).click();
    await expect(page.getByRole("radio", { name: "Full time · 37.5 h/week" }).first()).toBeVisible();
  } finally {
    const me = (await (await page.request.get("/api/me")).json()) as { workspaces: { id: string }[] };
    await page.request.put(`/api/workspaces/${me.workspaces[0]!.id}/work-week`, { data: { hoursPerWeek: 40, workdays: [1, 2, 3, 4, 5] } });
  }
});
