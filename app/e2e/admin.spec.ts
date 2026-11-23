/** AI credits, spending and the safety review queue, with real sign-ins on two or three devices. */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();

type Who = "Sam Okoye" | "Kim Park" | "Pat Lee";
const emails: Record<Who, string> = { "Sam Okoye": "sam@example.com", "Kim Park": "kim@example.com", "Pat Lee": "pat@example.com" };

async function other(browser: Browser, like: Page, who: Who, path = "/") {
  const ctx = await browser.newContext({ viewport: like.viewportSize()!, isMobile: (like.viewportSize()?.width ?? 1000) < 600, hasTouch: (like.viewportSize()?.width ?? 1000) < 600 });
  const page = await ctx.newPage();
  await signIn(page, who, path);
  return page;
}

/** Alex makes a plan and invites Sam as an editor; returns the plan id and Alex's workspace. */
async function shared(alex: Page, sam: Page, title: string, who: Who = "Sam Okoye") {
  const id = await addPlan(alex, KITCHEN.replace("title: Kitchen Remodel", `title: ${title}`));
  const link = ((await (await alex.request.post(`/api/plans/${id}/invites`, { data: { email: emails[who], role: "editor" } })).json()) as { link: string }).link;
  expect((await sam.request.post(`/api/invites/${link.split("/invite/")[1]}/accept`, { data: {} })).status()).toBe(200);
  const ws = ((await (await alex.request.get("/api/me")).json()) as { workspaces: { id: string }[] }).workspaces[0]!.id;
  return { id, ws };
}

test("a member runs low and asks; Alex approves from the pool; they carry on, and never see the pool", async ({ page: alex, browser }, info) => {
  // A different person on each screen size, so each run starts with no extra credits.
  const who: Who = info.project.name === "phone" ? "Sam Okoye" : "Kim Park";
  await signIn(alex);
  const sam = await other(browser, alex, who);
  const { id, ws } = await shared(alex, sam, "Credits Kitchen", who);

  // Alex sets everyone's allowance so Sam has exactly one AI check left this month.
  const used = ((await (await sam.request.get(`/api/plans/${id}/ai`)).json()) as { usage: { checks: { used: number; limit: number } } }).usage.checks;
  const grants = used.limit - Number(((await (await alex.request.get(`/api/workspaces/${ws}/ai/admin`)).json()) as { defaultAllowance: { checks: number } }).defaultAllowance.checks);
  await alex.goto("/settings");
  await alex.getByRole("link", { name: "Manage AI credits and see spending" }).click();
  await expect(alex.getByRole("heading", { name: "AI credits" })).toBeVisible();
  const everyone = alex.getByRole("form", { name: "Everyone, each month" });
  await everyone.getByLabel("Checks").fill(String(used.used - grants + 1));
  await everyone.getByRole("button", { name: "Save" }).click();
  await expect(alex.getByText("Saved the monthly allowance for everyone.")).toBeVisible();

  // Sam uses the last one, then asks for more right there.
  await sam.goto(`/p/${id}`);
  await live(sam);
  const check = sam.getByRole("region", { name: "Plan Check" });
  await check.getByRole("button", { name: "Run AI check" }).click();
  await expect(check.getByText(/No AI checks left this month/)).toBeVisible();
  await check.getByRole("button", { name: "Ask for more credits" }).click();
  const ask = check.getByRole("form", { name: "Ask for more AI credits" });
  await expect(ask.getByText("Your request goes to Alex Rivera.")).toBeVisible();
  await ask.getByLabel("AI checks").fill("5");
  await ask.getByLabel("Why (optional)").fill("Permit questions this week");
  await ask.getByRole("button", { name: "Send request" }).click();
  await expect(check.getByText("Asked for 5 AI checks. Waiting for Alex Rivera.")).toBeVisible();

  // Alex approves on another device.
  await alex.reload();
  const req = alex.getByRole("group", { name: `Request from ${who}` });
  await expect(req.getByText('"Permit questions this week"')).toBeVisible();
  await req.getByRole("button", { name: "Approve" }).click();
  await expect(alex.getByText(`Gave ${who} 5 AI checks more this month.`)).toBeVisible();

  // Sam carries on.
  await sam.reload();
  await live(sam);
  await expect(check.getByText("Alex Rivera gave you 5 AI checks more this month.")).toBeVisible();
  await expect(check.getByText(/5 of \d+ AI checks left this month/)).toBeVisible();
  await check.getByRole("button", { name: "Run again" }).click();
  await expect(check.getByText(/4 of \d+ AI checks left this month/)).toBeVisible();

  // Sam can't open Alex's credits or spending, and has no link to them.
  await sam.goto(`/admin/ai/${ws}`);
  await expect(sam.getByText("Only people who manage AI credits for this workspace can do that.")).toBeVisible();
  await sam.goto(`/admin/ai/${ws}/spending`);
  await expect(sam.getByText(/Only people allowed to see AI spending/)).toBeVisible();
  await expect(sam.getByRole("link", { name: "Add credits to the pool" })).toHaveCount(0);

  // Back to a roomy allowance for the other tests.
  await alex.request.put(`/api/workspaces/${ws}/ai/allowances/*`, { data: { checks: 100, reports: 30 } });
  await sam.context().close();
});

test("AI spending: open a person, then their project, then the department", async ({ page: alex, browser }) => {
  await signIn(alex);
  const sam = await other(browser, alex, "Sam Okoye");
  const { id, ws } = await shared(alex, sam, "Spending Kitchen");
  expect((await alex.request.post(`/api/plans/${id}/ai/check`, { data: {} })).status()).toBe(200);
  expect((await sam.request.post(`/api/plans/${id}/ai/check`, { data: {} })).status()).toBe(200);
  await sam.context().close();

  await alex.goto(`/admin/ai/${ws}/spending`);
  await expect(alex.getByRole("heading", { name: "AI spending" })).toBeVisible();
  await expect(alex.getByRole("img", { name: /AI cost per day/ })).toBeVisible();
  await alex.getByRole("radio", { name: "people" }).click();
  await alex.getByLabel("AI spending by people").getByRole("link", { name: /Sam Okoye/ }).click();
  const detail = alex.getByRole("region", { name: "Cost detail" });
  await expect(detail.getByRole("heading", { name: "Sam Okoye" })).toBeVisible();
  await expect(detail.getByText("Invited to a plan")).toBeVisible();
  await alex.getByRole("link", { name: "Project: Spending Kitchen →" }).last().click();
  await expect(detail.getByRole("heading", { name: "Spending Kitchen" })).toBeVisible();
  await expect(alex.getByRole("region", { name: "By feature" }).getByText(/AI Plan Check · 2 runs/)).toBeVisible();
  await alex.getByRole("link", { name: "Person: Alex Rivera →" }).click();
  await alex.getByRole("link", { name: /^Department: / }).click();
  await expect(detail.getByText("Department", { exact: true })).toBeVisible();
  await expect(detail.getByRole("heading", { name: "No department" })).toBeVisible();
  await alex.getByRole("link", { name: "Back to AI spending" }).click();
  await expect(alex.getByRole("link", { name: /Export people \(CSV\)/ })).toBeVisible();
});

test("safety review: a plan declined twice waits; only the review team sees it and releases it", async ({ page: sam, browser }) => {
  await signIn(sam, "Sam Okoye");
  const id = await addPlan(sam, KITCHEN.replace("title: Kitchen Remodel", "title: Hold me [refuse]"));
  await sam.goto(`/p/${id}`);
  await live(sam);
  await sam.getByRole("region", { name: "Plan Check" }).getByRole("button", { name: "Run AI check" }).click();
  await expect(sam.getByText(/waiting for a safety review/).first()).toBeVisible();
  await sam.goto("/admin/safety");
  await expect(sam.getByText("This page is only for the review team.")).toBeVisible();

  const pat = await other(browser, sam, "Pat Lee", "/settings");
  await pat.getByRole("link", { name: /Safety review \(\d+ waiting\)/ }).click();
  const item = pat.getByRole("region", { name: "Held: Hold me [refuse]" });
  await expect(item.getByText(/Sam Okoye · sam@example.com · AI Plan Check/)).toBeVisible();
  await expect(item.getByRole("button", { name: "Keep held" })).toBeDisabled(); // needs a note
  await item.getByRole("button", { name: "Release" }).click();
  await expect(pat.getByRole("region", { name: "Held: Hold me [refuse]" })).toHaveCount(0);
  await expect(pat.getByText(/Released: Hold me \[refuse\] \(Sam Okoye\) by Pat Lee/).first()).toBeVisible();
  await pat.context().close();

  await sam.goto(`/p/${id}`);
  await live(sam);
  await expect(sam.getByText(/waiting for a safety review/)).toHaveCount(0);
});
