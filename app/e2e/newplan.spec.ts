import { expect, test } from "@playwright/test";
import { KITCHEN, signIn } from "./helpers";

test("existing chat: copy the prompt, paste the reply, set hours, save, and the plan opens", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await page.goto("/new");
  await page.getByRole("button", { name: /I've been talking it through with my AI/ }).click();
  await page.getByLabel(/Which project\?/).fill("the kitchen");
  const prompt = page.getByLabel("The prompt");
  await expect(prompt).toHaveValue(/the kitchen/);
  await page.getByRole("button", { name: "Copy prompt" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("the kitchen");

  await page.getByRole("button", { name: "I have the reply" }).click();
  await page.getByLabel(/Paste your assistant's whole reply/).fill(`Sure! Here's your plan:\n\n${KITCHEN}\nGood luck!`);
  await page.getByRole("button", { name: "Check my plan" }).click();
  await expect(page.getByRole("heading", { name: "Kitchen Remodel" })).toBeVisible();
  await expect(page.getByText("2 phases · 5 tasks · 1 already done · 2 milestones")).toBeVisible();
  const finish = page.getByLabel("Your plan").getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/).first();
  const before = await finish.textContent();

  // Priya only has 5 hours a week: the finish date moves later before anything is saved.
  await page.getByRole("radiogroup", { name: "Hours a week for Priya" }).getByRole("radio", { name: "5 h/week" }).click();
  await expect(finish).not.toHaveText(before!);
  const after = await finish.textContent();

  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page).toHaveURL(/\/p\/[\w-]+$/);
  const id = page.url().split("/p/")[1]!;
  const saved = (await (await page.request.get(`/api/plans/${id}`)).json()) as { people: Record<string, { hoursPerWeek: number }> };
  expect(saved.people.Priya).toEqual({ hoursPerWeek: 5 });
  expect(after).not.toBe(before);
});

test("custom hours accept 1 to 60 and explain bad values", async ({ page }) => {
  await signIn(page);
  await page.goto("/new");
  await page.getByRole("button", { name: /I already have a reply or a plan file/ }).click();
  await page.getByLabel(/Paste your assistant's whole reply/).fill(KITCHEN);
  await page.getByRole("button", { name: "Check my plan" }).click();
  const jordan = page.getByRole("group", { name: "Hours a week for Jordan" });
  await jordan.getByRole("radio", { name: "Custom" }).click();
  const box = jordan.getByLabel("Hours a week (1 to 60)");
  await box.fill("0");
  await expect(jordan.getByText("Enter 1 to 60 hours a week")).toBeVisible();
  await box.fill("12");
  await expect(jordan.getByText("About 2.4 h a day over 5 days")).toBeVisible();
  await jordan.getByRole("button", { name: "One hour more" }).click();
  await expect(box).toHaveValue("13");
  await expect(jordan.getByRole("radio", { name: "Full time · 40 h/week" })).toBeVisible();
});

test("fresh start: the wizard asks one question at a time and builds a prompt from the answers", async ({ page }) => {
  await signIn(page);
  await page.goto("/new");
  await page.getByRole("button", { name: /I'm starting fresh/ }).click();
  await expect(page.getByText("Question 1 of 9")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await page.getByRole("textbox").fill("Move our office to the new building");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("textbox").fill("Everyone working from the new office");
  for (let i = 0; i < 7; i++) await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Make my prompt" }).click();
  await expect(page.getByLabel("The prompt")).toHaveValue(/Move our office to the new building/);
  await expect(page.getByText("Paste it into a new chat with any AI assistant.")).toBeVisible();
});

test("a reply that isn't a plan gets a plain explanation, and nothing is saved", async ({ page }) => {
  await signIn(page);
  const before = ((await (await page.request.get("/api/plans")).json()) as { plans: unknown[] }).plans.length;
  await page.goto("/new");
  await page.getByRole("button", { name: /I already have a reply or a plan file/ }).click();
  await page.getByLabel(/Paste your assistant's whole reply/).fill("Sorry, I can't help with that.");
  await page.getByRole("button", { name: "Check my plan" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(((await (await page.request.get("/api/plans")).json()) as { plans: unknown[] }).plans.length).toBe(before);
});

test("a plan file can be opened from the device", async ({ page }) => {
  await signIn(page);
  await page.goto("/new");
  await page.getByRole("button", { name: /I already have a reply or a plan file/ }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "kitchen.rakuplan", mimeType: "text/markdown", buffer: Buffer.from(KITCHEN) });
  await expect(page.getByText("Opened kitchen.rakuplan")).toBeVisible();
  await page.getByRole("button", { name: "Check my plan" }).click();
  await expect(page.getByRole("heading", { name: "Kitchen Remodel" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/p\//);
});
