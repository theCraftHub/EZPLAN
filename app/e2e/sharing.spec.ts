import { expect, test, type Page } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();
const row = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${title}`) }) });

test("Alex invites Sam; Sam joins, edits live, becomes view-only, then loses access", async ({ page: alex, browser }) => {
  test.setTimeout(90_000);
  await signIn(alex, "Alex Rivera");
  const id = await addPlan(alex, KITCHEN.replace("Kitchen Remodel", "Shared Kitchen"));
  await alex.goto(`/p/${id}/share`);
  const invite = alex.getByRole("region", { name: "Invite someone" });
  await invite.getByLabel("Their email").fill("sam@example.com");
  await invite.getByRole("radio", { name: /Editor/ }).check();
  await invite.getByRole("button", { name: "Make invite link" }).click();
  const link = await invite.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/\/invite\/[\w-]{30,}$/);
  await expect(alex.getByRole("region", { name: "People with access" }).getByText("sam@example.com")).toBeVisible(); // waiting to accept

  // Sam opens the link, signs in, accepts.
  const samCtx = await browser.newContext({ viewport: alex.viewportSize()! });
  const sam = await samCtx.newPage();
  await sam.goto(new URL(link).pathname);
  await sam.getByRole("link", { name: "Sign in with Test ID" }).click();
  await sam.getByRole("link", { name: "Continue as Sam Okoye" }).click();
  await expect(sam.getByText(/Alex Rivera invited you to Shared Kitchen as an Editor/)).toBeVisible();
  await sam.getByRole("button", { name: "Accept and open the plan" }).click();
  await expect(sam.getByRole("heading", { name: "Shared Kitchen" })).toBeVisible();
  await sam.goto("/");
  await expect(sam.getByRole("link", { name: /Shared Kitchen/ }).getByText("Shared with you")).toBeVisible();

  // Both on the checklist: Sam's edit appears for Alex, credited to Sam; Alex sees Sam is here.
  await alex.goto(`/p/${id}/checklist`);
  await sam.goto(`/p/${id}/checklist`);
  await live(alex);
  await live(sam);
  await expect(alex.getByText("Sam Okoye is here")).toBeVisible();
  await row(sam, "Order cabinets").getByRole("button", { name: /Mark as Doing/ }).click();
  await expect(row(alex, "Order cabinets").getByRole("button", { name: /Order cabinets: Doing/ })).toBeVisible();

  // Alex makes Sam a viewer: Sam's open page reloads by itself and is view only.
  await alex.goto(`/p/${id}/share`);
  await alex.getByLabel("Role for Sam Okoye").selectOption("viewer");
  await expect(sam.getByText("View only")).toBeVisible({ timeout: 15_000 });
  await expect(row(sam, "Order cabinets").getByRole("button", { name: /Order cabinets: Doing/ })).toBeDisabled();
  await expect(sam.getByRole("region", { name: "Phase: Build" }).getByLabel("Add a task to this phase")).toHaveCount(0);
  await expect(sam.getByRole("link", { name: "Update with my AI" })).toHaveCount(0);

  // Availability changes reach Sam's open page without reloading.
  await sam.getByRole("navigation", { name: "Plan views" }).getByRole("link", { name: "Team" }).click();
  await live(sam);
  const finish = sam.getByText(/^(Mon|Tue|Wed|Thu|Fri), /).first();
  const before = await finish.textContent();
  await alex.request.put(`/api/plans/${id}/people/Jordan`, { data: { hoursPerWeek: 8 } });
  await expect(finish).not.toHaveText(before!);

  // Alex removes Sam: Sam's page loses the plan at once.
  await alex.reload();
  await alex.getByRole("button", { name: "Remove Sam Okoye" }).click();
  await expect(sam.getByText("This plan doesn't exist or you don't have access to it.")).toBeVisible({ timeout: 15_000 });
  expect((await sam.request.get(`/api/plans/${id}`)).status()).toBe(404);
  await samCtx.close();
});

test("an invite opened by the wrong account explains whose it is", async ({ page, browser }) => {
  await signIn(page, "Alex Rivera");
  const id = await addPlan(page, KITCHEN);
  const res = await page.request.post(`/api/plans/${id}/invites`, { data: { email: "someone@example.com", role: "viewer" } });
  const { link } = (await res.json()) as { link: string };
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signIn(other, "Sam Okoye");
  await other.goto(new URL(link).pathname);
  await expect(other.getByText(/This invite is for s•+@example\.com\. Sign in with that address/)).toBeVisible();
  await expect(other.getByRole("button", { name: "Accept and open the plan" })).toHaveCount(0);
  await ctx.close();
});
