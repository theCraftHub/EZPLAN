/** Safety cases: a report opens a follow-up with the reporter's company, shared with our safety team. */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("Kim reports; Alex (Kim's manager) follows up with our team, never learning who reported", async ({ page: alex, browser }, info) => {
  const shots = (name: string) => `e2e/.results/shots/${info.project.name}-j0-${name}.png`;
  const size = { viewport: alex.viewportSize()!, isMobile: alex.viewportSize()!.width < 600, hasTouch: alex.viewportSize()!.width < 600 };
  await signIn(alex);
  const kim = await (await browser.newContext(size)).newPage();
  await signIn(kim, "Kim Park", "/help");
  // Kim works in Alex's company (the admin console will do this; a test-only route does it here, undone at the end).
  const join = { data: { person: "kim@example.com", intoWorkspaceOf: "alex@example.com" } };
  expect((await kim.request.post("/e2e/join", join)).ok()).toBe(true);
  try {
    // Kim reports a coworker from Help.
    await kim.reload();
    const form = kim.getByRole("region", { name: /Contact .* support/ });
    await form.getByLabel("What is it about?").selectOption({ label: "Report abuse or a safety problem" });
    await form.getByLabel("Subject").fill(`Harassing comments (${info.project.name})`);
    await form.getByLabel("What happened?").fill("A coworker keeps posting insults on my tasks.");
    await form.getByRole("button", { name: "Send request" }).click();
    await expect(kim.getByRole("heading", { name: `Harassing comments (${info.project.name})` })).toBeVisible();

    // Alex gets the notice in the bell, and it opens the case.
    await alex.goto("/notifications");
    await alex.getByRole("button", { name: /^Unread: Our system flagged behavior within your workspace that requires follow-up/ }).first().click();
    await expect(alex.getByRole("heading", { name: /^Safety case for / })).toBeVisible();
    const convo = alex.getByRole("region", { name: "Conversation" });
    await expect(convo.getByText(/Further communication will follow in this thread/)).toBeVisible();
    await expect(alex.getByText(/doesn't say who reported anything/)).toBeVisible();
    for (const secret of ["Kim", "Harassing", "insults"]) await expect(alex.getByText(secret)).toHaveCount(0);
    await alex.getByLabel("Reply to our safety team").fill("Which team is this about?");
    await alex.getByRole("button", { name: "Send" }).click();
    await expect(convo.getByRole("listitem", { name: "Message from Alex Rivera" })).toContainText("Which team is this about?");
    if (process.env.SHOTS) await alex.screenshot({ path: shots("case-manager"), fullPage: true });

    // Pat (our safety team) finds it under Safety review, with the original report and what was emailed.
    const pat = await (await browser.newContext(size)).newPage();
    await signIn(pat, "Pat Lee", "/admin/safety");
    await pat.getByRole("region", { name: "Company follow-ups" }).getByRole("link", { name: /Safety case for / }).first().click();
    await expect(pat.getByRole("link", { name: "Open the original report" })).toBeVisible();
    await expect(pat.getByText(/Emailed to alex@example.com \(not sent: email is off on this server/).first()).toBeVisible();
    await pat.getByLabel("Write to the company's managers").fill("Please check the comments on Office move.");
    await pat.getByRole("button", { name: "Send" }).click();
    await expect(pat.getByRole("listitem", { name: "Message from Pat Lee" })).toBeVisible();
    if (process.env.SHOTS) await pat.screenshot({ path: shots("case-staff"), fullPage: true });

    // Alex sees "safety team", not Pat's name; Kim (the reporter) has no case to open.
    await alex.reload();
    await expect(convo.getByRole("listitem", { name: /^Message from .+ safety team$/ }).last()).toContainText("Please check the comments on Office move.");
    await expect(alex.getByText("Pat Lee")).toHaveCount(0);
    await kim.goto("/help");
    await expect(kim.getByRole("region", { name: "Safety follow-ups" })).toHaveCount(0);
  } finally {
    await kim.request.post("/e2e/join?leave=1", join);
  }
});
