import { expect, test, type Page } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

/** The checklist row of one task (other rows can mention it in "waits on"). */
const row = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${title}`) }) });
const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible();

test("Update with my AI: copy the plan, paste the reply, accept some changes; progress stays", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.goto(`/p/${id}`);
  await live(page);
  await page.getByRole("link", { name: "Update with my AI" }).click();
  const prompt = await page.getByLabel("The prompt").inputValue();
  expect(prompt).toContain("Keep every existing ID");
  const block = /CURRENT PLAN\n```\n([\s\S]*?)\n```/.exec(prompt)![1]!;
  const reply = block
    .replace("- [/] T2: Get three contractor quotes (3d)", "- [x] T2: Get three contractor quotes (3d)")
    .replace("- [ ] T3: Order cabinets (2d)", "- [ ] T3: Order cabinets (3d)")
    .replace(/- \[ \] T4: Remove old cabinets[^\n]*\n/, "")
    + "\n- [ ] T6: Paint the walls (2d) @Priya depends: T5\n";
  await page.getByRole("button", { name: "I have the reply" }).click();
  await page.getByLabel("Paste the assistant's whole reply").fill(`Here you go:\n\`\`\`\n${reply}\n\`\`\`\nWHAT CHANGED\n- Cabinets take a day longer to order.\n- Added painting.`);
  await page.getByRole("button", { name: "Show the changes" }).click();
  const review = page.getByRole("region", { name: "Update with my AI" });
  await expect(review.getByText("Cabinets take a day longer to order.")).toBeVisible();
  await expect(review.getByRole("checkbox", { name: /"Order cabinets": time needed 2d → 3d/ })).toBeChecked();
  await expect(review.getByRole("checkbox", { name: /New task in Build: Paint the walls \(Priya\)/ })).toBeChecked();
  await expect(review.getByRole("checkbox", { name: /"Remove old cabinets" wasn't in the reply/ })).not.toBeChecked();
  await expect(review.getByText(/marks "Get three contractor quotes" as done\. Progress only changes in the plan itself/)).toBeVisible();
  await review.getByRole("checkbox", { name: /"Order cabinets": time needed/ }).uncheck();
  await review.getByRole("button", { name: "Apply 1 change" }).click();
  await expect(page.getByText("1 change from your AI assistant applied.")).toBeVisible();
  const saved = (await (await page.request.get(`/api/plans/${id}`)).json()) as { plan: { phases: { tasks: { id: string; status: string; estimate?: { amount: number } }[] }[] } };
  const tasks = saved.plan.phases.flatMap((p) => p.tasks);
  expect(tasks.find((t) => t.id === "T6")).toBeTruthy();
  expect(tasks.find((t) => t.id === "T4")).toBeTruthy(); // missing from the reply: kept
  expect(tasks.find((t) => t.id === "T2")!.status).toBe("progress"); // the reply can't change progress
  expect(tasks.find((t) => t.id === "T3")!.estimate!.amount).toBe(2); // unticked: not applied

  // Version history has the plan from before the update, and restoring it brings it back exactly.
  await page.getByRole("link", { name: "History and Trash" }).click();
  const history = page.getByRole("region", { name: "Version history" });
  await expect(history.getByText("Before an update from an AI assistant")).toBeVisible();
  await history.getByRole("listitem").filter({ hasText: "Before an update from an AI assistant" }).getByRole("button", { name: "Restore this version" }).click();
  await history.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText(/is back\. The plan as it was a moment ago is saved/)).toBeVisible();
  await expect.poll(async () => ((await (await page.request.get(`/api/plans/${id}`)).json()) as { plan: { phases: { tasks: { id: string }[] }[] } }).plan.phases.flatMap((p) => p.tasks).some((t) => t.id === "T6")).toBe(false);
});

test("Trash: a deleted task can be brought back", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.goto(`/p/${id}/checklist`);
  await live(page);
  await row(page, "Remove old cabinets").getByRole("button").nth(1).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
  await page.getByRole("link", { name: "History and Trash" }).click();
  const trash = page.getByRole("region", { name: "Trash" });
  await expect(trash.getByText("Remove old cabinets")).toBeVisible();
  await expect(trash.getByText(/Deleted .* by Alex Rivera/)).toBeVisible();
  await trash.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText('"Remove old cabinets" is back in the plan.')).toBeVisible();
  await page.getByRole("link", { name: "Checklist" }).click();
  await expect(row(page, "Remove old cabinets")).toBeVisible();
});

test("download the plan file and open the printable summary", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.goto(`/p/${id}`);
  await live(page);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download plan file" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Kitchen Remodel\./);
  await page.getByRole("link", { name: "Print summary" }).click();
  const sheet = page.getByRole("article", { name: "Printable summary" });
  await expect(sheet.getByRole("heading", { name: "Kitchen Remodel" })).toBeVisible();
  await expect(sheet.getByText("Order placed")).toBeVisible();
  await expect(sheet.getByText("Install new cabinets")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation", { name: "Main" }).filter({ visible: true })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Print" })).toBeHidden();
});

test("start from a template, or from a past project with progress cleared", async ({ page }) => {
  await signIn(page);
  await page.goto("/new");
  await page.getByRole("button", { name: /Start from a template/ }).click();
  await page.getByRole("radio", { name: /Office move/ }).click();
  await page.getByLabel("Plan name").fill("Move to Main Street");
  await page.getByLabel("Start date").fill("2027-02-01");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("heading", { name: "Move to Main Street" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByRole("heading", { name: "Move to Main Street" })).toBeVisible();

  await addPlan(page, KITCHEN.replace("Kitchen Remodel", "Old Kitchen"));
  await page.goto("/new");
  await page.getByRole("button", { name: /Start from a past project/ }).click();
  await page.getByRole("radio", { name: /Old Kitchen/ }).first().click();
  await expect(page.getByLabel("Plan name")).toHaveValue("Old Kitchen (copy)");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("2 phases · 5 tasks · 2 milestones")).toBeVisible(); // nothing "already done"
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByText("0 of 5 tasks done")).toBeVisible();
});
