/** Comments, the Commenter role and the Activity view, with two people signed in. */
import { expect, test, type Page } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();
const row = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${title}`) }) });

test("Sam (commenter) comments and mentions Alex; Alex sees it live; Sam can't change tasks; Activity shows both", async ({ page: alex, browser }) => {
  await signIn(alex);
  const id = await addPlan(alex, KITCHEN.replace("title: Kitchen Remodel", "title: Comment Kitchen"));
  const link = ((await (await alex.request.post(`/api/plans/${id}/invites`, { data: { email: "sam@example.com", role: "commenter" } })).json()) as { link: string }).link;
  const ctx = await browser.newContext({ viewport: alex.viewportSize()!, isMobile: alex.viewportSize()!.width < 600, hasTouch: alex.viewportSize()!.width < 600 });
  const sam = await ctx.newPage();
  await sam.goto(new URL(link).pathname);
  await sam.getByRole("link", { name: "Sign in with Test ID" }).click();
  await sam.getByRole("link", { name: "Continue as Sam Okoye" }).click();
  await expect(sam.getByText(/as a Commenter \(you can see everything and comment\)/)).toBeVisible();
  await sam.getByRole("button", { name: "Accept and open the plan" }).click();

  // Alex has the task open; Sam comments from the checklist.
  await alex.goto(`/p/${id}/checklist`);
  await live(alex);
  await row(alex, "Order cabinets").getByRole("button", { name: /^Order cabinets(?!:)/ }).click();
  const alexSheet = alex.getByRole("dialog");
  await expect(alexSheet.getByText("No comments yet.")).toBeVisible();

  await sam.goto(`/p/${id}/checklist`);
  await live(sam);
  await expect(sam.getByText("Can comment")).toBeVisible();
  await expect(row(sam, "Order cabinets").getByRole("button", { name: /Order cabinets: To do/ })).toBeDisabled();
  await row(sam, "Order cabinets").getByRole("button", { name: /^Order cabinets(?!:)/ }).click();
  const samSheet = sam.getByRole("dialog");
  const box = samSheet.getByLabel("Add a comment");
  await box.fill("Which supplier? @Ale");
  await samSheet.getByRole("option", { name: "@Alex Rivera" }).click();
  await expect(box).toHaveValue("Which supplier? @Alex Rivera ");
  await box.pressSequentially("please confirm <b>today</b>");
  await samSheet.getByRole("button", { name: "Post comment" }).click();
  await expect(samSheet.getByRole("listitem", { name: "Comment by Sam Okoye" })).toContainText("<b>today</b>"); // shown as text
  await expect(samSheet.getByRole("button", { name: "Edit" })).toBeVisible();

  // Suggestions open at the cursor and work from the keyboard; Escape closes them, not the sheet.
  await box.pressSequentially("Also @");
  const menu = samSheet.getByRole("listbox", { name: "People to mention" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option", { name: "@Sam Okoye" })).toHaveCount(0); // not suggested to themselves
  if (process.env.SHOTS) await sam.screenshot({ path: `e2e/.results/shots/${test.info().project.name}-i-mention-menu.png` });
  const [boxAt, menuAt] = [(await box.boundingBox())!, (await menu.boundingBox())!];
  expect(menuAt.y).toBeGreaterThan(boxAt.y);
  expect(menuAt.y).toBeLessThan(boxAt.y + boxAt.height); // opens inside the box, under the line being typed
  await box.press("Escape");
  await expect(menu).toBeHidden();
  await expect(samSheet).toBeVisible();
  await box.pressSequentially("A");
  await expect(menu.getByRole("option", { name: "@Alex Rivera" })).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");
  await expect(box).toHaveValue("Also @Alex Rivera ");
  await expect(menu).toBeHidden();
  await box.fill("");

  // Alex sees it without reloading, and the row shows a count.
  await expect(alexSheet.getByRole("listitem", { name: "Comment by Sam Okoye" })).toContainText("Which supplier? @Alex Rivera please confirm");
  await alexSheet.getByRole("button", { name: "Close" }).click();
  await expect(row(alex, "Order cabinets").getByLabel("1 comment")).toBeVisible();

  // Alex's bell: the mention, which opens the task with the comment.
  await alex.goto("/");
  await alex.getByRole("link", { name: /^Notifications, \d+ unread$/ }).click();
  await alex.getByRole("button", { name: "Unread: Sam Okoye mentioned you on Order cabinets (Comment Kitchen)" }).click();
  await expect(alex.getByRole("dialog").getByRole("listitem", { name: "Comment by Sam Okoye" })).toBeVisible();
  await alex.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  // Alex changes the task; Activity lists it, Sam's comment and Sam joining.
  await row(alex, "Order cabinets").getByRole("button", { name: /Mark as Doing/ }).click();
  await alex.getByRole("link", { name: "Activity" }).click();
  const activity = alex.getByRole("region", { name: "Activity" });
  await expect(activity.getByText("Alex Rivera set Order cabinets to in progress")).toBeVisible();
  await expect(activity.getByText("Sam Okoye commented on Order cabinets")).toBeVisible();
  await expect(activity.getByText("Sam Okoye joined the plan as a Commenter")).toBeVisible();
  await activity.getByLabel("Show").selectOption("Sam Okoye");
  await expect(activity.getByText("Alex Rivera set Order cabinets to in progress")).toHaveCount(0);
  await ctx.close();
});
