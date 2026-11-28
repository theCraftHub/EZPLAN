/** Step J3: the risk log with its heat map, adding a risk from the AI check, and the dashboard count. */
import { expect, test } from "@playwright/test";
import { addPlan, KITCHEN, openView, signIn } from "./helpers";

test("risk log: add a high risk, see it on the heat map, close it; add one from the AI check", async ({ page }, info) => {
  const shot = (name: string) => `e2e/.results/shots/${info.project.name}-j3-${name}.png`;
  await signIn(page);
  const id = await addPlan(page, KITCHEN.replace("title: Kitchen Remodel", `title: Risky Kitchen ${info.project.name}`));
  await page.goto(`/p/${id}/risks`);
  const log = page.getByRole("region", { name: "Risk log" });
  await expect(log.getByText(/Nothing in the log yet/)).toBeVisible();

  // A likely, severe risk lands in a "high" cell.
  await log.getByRole("button", { name: "Add to the log" }).click();
  const form = page.getByRole("form", { name: "Add to the log" });
  await form.getByLabel("Title").fill("Cabinets arrive damaged");
  await form.getByLabel("What could happen, and what you'll do about it").fill("Inspect on delivery; supplier replaces within 5 days.");
  await form.getByLabel("Owner").fill("Jordan");
  await form.getByLabel("Likelihood").selectOption("4");
  await form.getByLabel("Impact").selectOption("5");
  await form.getByText("Linked tasks (0)").click();
  await form.getByLabel("Order cabinets").check();
  await form.getByRole("button", { name: "Add", exact: true }).click();
  const item = log.getByRole("listitem", { name: "Risk: Cabinets arrive damaged" });
  await expect(item.getByText("High · likelihood 4 × impact 5")).toBeVisible();
  await expect(item.getByText(/Owner Jordan · About Order cabinets/)).toBeVisible();

  // And an issue, which isn't on the heat map.
  await log.getByRole("button", { name: "Add to the log" }).click();
  await form.getByLabel("Type").selectOption("issue");
  await form.getByLabel("Title").fill("Quote from supplier B is missing");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(log.getByRole("listitem", { name: "Issue: Quote from supplier B is missing" })).toBeVisible();

  const map = page.getByRole("region", { name: "Risk heat map" });
  const cell = map.getByRole("button", { name: "Likelihood 4, impact 5: 1 open risk, high" });
  await cell.click();
  await expect(log.getByRole("listitem")).toHaveCount(1);
  if (process.env.SHOTS) await page.screenshot({ path: shot("risks"), fullPage: true });
  await cell.click();

  // The dashboard counts open risks and issues (desktop); closing one updates it.
  if (info.project.name === "desktop") {
    await openView(page, "Overview");
    await expect(page.getByRole("region", { name: "Key numbers" }).getByRole("link", { name: "1 risk, 1 issue" })).toBeVisible();
    await page.getByRole("region", { name: "Key numbers" }).getByRole("link", { name: "1 risk, 1 issue" }).click();
  }
  await log.getByRole("listitem", { name: "Risk: Cabinets arrive damaged" }).getByRole("button", { name: "Close" }).click();
  await expect(log.getByRole("listitem", { name: "Risk: Cabinets arrive damaged" })).toHaveCount(0); // showing open ones
  await expect(map.getByRole("button", { name: "Likelihood 4, impact 5: 0 open risks, high" })).toBeDisabled();
  await page.getByRole("button", { name: "Open and closed" }).click();
  await expect(log.getByRole("listitem", { name: "Risk: Cabinets arrive damaged" }).getByText("Closed", { exact: true })).toBeVisible();

  // A risk the AI check found goes into the log in one click.
  await openView(page, "Overview");
  const check = page.getByRole("region", { name: "Plan Check" });
  await check.getByRole("button", { name: "Run AI check" }).click();
  await check.getByRole("button", { name: "Add to risk log" }).first().click();
  await openView(page, "Risks");
  await expect(log.getByRole("listitem", { name: /^Risk: / }).filter({ hasText: "From the AI check" })).toBeVisible();
});
