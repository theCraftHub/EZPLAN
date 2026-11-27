/** Step M2: a task that needs approval: set the approver, mark it Done, it waits; the manager approves. */
import { expect, test, type Page } from "@playwright/test";
import { addPlan, signIn } from "./helpers";

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();
const row = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${title}`) }) });

test("approval: set who approves, mark Done, it waits, then approved", async ({ page }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-m2-${name}.png`, fullPage: true }); };
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page, "Kim Park");
  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Sign-off ${tag}\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: Draft the contract (1d) @Kim\n- [ ] T2: File it (1d) @Kim`);
  await page.goto(`/p/${id}/checklist`);
  await live(page);

  await row(page, "Draft the contract").getByRole("button", { name: /^Draft the contract(?!:)/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Needs approval from").fill("Kim");
  await sheet.getByRole("button", { name: "Save" }).click();
  await row(page, "Draft the contract").getByRole("button", { name: /Draft the contract: To do/ }).click();
  await row(page, "Draft the contract").getByRole("button", { name: /Draft the contract: Doing/ }).click();
  await expect(row(page, "Draft the contract").getByText("Waiting for Kim's approval")).toBeVisible();
  await shot("1-waiting");

  await row(page, "Draft the contract").getByRole("button", { name: /^Draft the contract(?!:)/ }).click();
  const approval = page.getByRole("dialog").getByRole("region", { name: "Approval" });
  await expect(approval).toContainText("Waiting for Kim's approval. It counts as done once approved.");
  await shot("2-sheet");
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(row(page, "Draft the contract").getByText("Approved", { exact: true })).toBeVisible();
  await row(page, "Draft the contract").getByRole("button", { name: /^Draft the contract(?!:)/ }).click();
  await expect(page.getByRole("dialog").getByText(/^Approved by Kim Park/)).toBeVisible();
});
