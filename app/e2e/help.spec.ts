/** Help: the company's contact, a request with plan access, our team replies and opens the plan, access taken back. */
import { expect, test } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

test("company contact, a request to support with plan access, a reply from our team, then access taken back", async ({ page: alex, browser }, info) => {
  await signIn(alex);
  const title = `Help Kitchen ${info.project.name}`;
  const id = await addPlan(alex, KITCHEN.replace("title: Kitchen Remodel", `title: ${title}`));

  // Alex (a manager) sets the company contact in Settings.
  await alex.goto("/settings");
  const card = alex.getByRole("region", { name: "Company support contact" });
  await card.getByLabel("Team name").fill("Rivera IT");
  await card.getByLabel("Email").fill("it@rivera.example");
  await card.getByLabel("Help-desk link").fill("https://help.rivera.example/desk");
  await card.getByRole("button", { name: "Save contact" }).click();
  await expect(card.getByText("Saved. People on your plans see it under Help.")).toBeVisible();

  // Help shows it, and Alex sends a request about the plan, giving access.
  await alex.getByRole("link", { name: "Help" }).first().click();
  await expect(alex.getByRole("region", { name: "Your company's support" }).getByRole("link", { name: "Help desk (help.rivera.example)" })).toBeVisible();
  const form = alex.getByRole("region", { name: /Contact .* support/ });
  await form.getByLabel("What is it about?").selectOption({ label: "Report abuse or a safety problem" });
  await expect(form.getByText(/its managers are told only that our safety team is following up on something in their workspace, never who reported it or what it says/)).toBeVisible();
  await form.getByLabel("What is it about?").selectOption({ label: "Something isn't working" });
  await form.getByLabel("Subject").fill(`Dates look wrong (${info.project.name})`);
  await form.getByLabel("What happened?").fill("The finish moved a week.");
  await form.getByLabel("Which plan (optional)").selectOption({ label: title });
  await form.getByLabel(/Let support see this plan for 7 days/).check();
  await form.getByRole("button", { name: "Send request" }).click();
  await expect(alex.getByRole("heading", { name: `Dates look wrong (${info.project.name})` })).toBeVisible();
  await expect(alex.getByText(/support can open it until/)).toBeVisible();
  const url = alex.url();

  // Pat (our team) finds it in the inbox, opens the plan read-only and replies.
  const ctx = await browser.newContext({ viewport: alex.viewportSize()! });
  const pat = await ctx.newPage();
  await signIn(pat, "Pat Lee", "/settings");
  await pat.getByRole("link", { name: /Support inbox/ }).last().click();
  await pat.getByRole("link", { name: new RegExp(`Dates look wrong \\(${info.project.name}\\)`) }).click();
  await expect(pat.getByText(/Browser: /)).toBeVisible();
  await pat.getByRole("button", { name: "Open the plan (read-only)" }).click();
  await expect(pat.getByLabel("Plan (read-only)")).toContainText("Order cabinets");
  await pat.getByLabel("Reply").fill("Found it: Priya's days off. Fixing the wording.");
  await pat.getByRole("button", { name: "Send reply" }).click();

  // Alex sees the reply (and the bell), and that the plan was opened; then takes access back.
  await alex.goto("/");
  await expect(alex.getByRole("link", { name: /^Notifications, \d+ unread$/ }).first()).toBeVisible();
  await alex.goto(new URL(url).pathname);
  await expect(alex.getByRole("listitem", { name: "Message from Support" })).toContainText("Found it");
  await expect(alex.getByText(/Opened by support: Pat Lee/)).toBeVisible();
  await alex.getByRole("button", { name: "Take back access" }).click();
  await expect(alex.getByText(/access ended/)).toBeVisible();

  await pat.reload();
  await expect(pat.getByRole("button", { name: "Open the plan (read-only)" })).toHaveCount(0);
  await ctx.close();
  void id;
});
