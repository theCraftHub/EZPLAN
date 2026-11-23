/** Screenshots of step E's screens (run with SHOTS=1). */
import { test } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

test.skip(!process.env.SHOTS, "screenshots only when SHOTS=1");
const out = (name: string, project: string) => `e2e/.results/shots/${project}-${name}.png`;

test("step E screens", async ({ page }, info) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN);
  await page.goto(`/p/${id}/update`);
  await page.getByRole("status").filter({ hasText: "Live" }).waitFor();
  const prompt = await page.getByLabel("The prompt").inputValue();
  const block = /CURRENT PLAN\n```\n([\s\S]*?)\n```/.exec(prompt)![1]!;
  const reply = block.replace("- [/] T2:", "- [x] T2:").replace("(2d) @Jordan depends: T2", "(3d) @Jordan depends: T2").replace(/- \[ \] T4: Remove old cabinets[^\n]*\n/, "") + "\n- [ ] T6: Paint the walls (2d) @Priya depends: T5\n";
  await page.getByRole("button", { name: "I have the reply" }).click();
  await page.getByLabel("Paste the assistant's whole reply").fill(`\`\`\`\n${reply}\n\`\`\`\nWHAT CHANGED\n- Cabinets take a day longer.\n- Added painting.`);
  await page.getByRole("button", { name: "Show the changes" }).click();
  await page.screenshot({ path: out("e-update-review", info.project.name), fullPage: true });
  await page.getByRole("button", { name: /^Apply/ }).click();
  await page.getByText(/from your AI assistant applied/).waitFor();
  await page.screenshot({ path: out("e-applied", info.project.name), fullPage: true });
  await page.goto(`/p/${id}/history`);
  await page.getByText("Before an update from an AI assistant").waitFor();
  await page.screenshot({ path: out("e-history", info.project.name), fullPage: true });
  await page.goto(`/p/${id}/print`);
  await page.getByRole("article", { name: "Printable summary" }).waitFor();
  await page.screenshot({ path: out("e-print", info.project.name), fullPage: true });
  await page.goto("/new");
  await page.getByRole("button", { name: /Start from a template/ }).click();
  await page.getByRole("radio", { name: /Construction job/ }).click();
  await page.screenshot({ path: out("e-templates", info.project.name), fullPage: true });
});
