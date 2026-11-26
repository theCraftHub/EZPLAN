/** Step L2: business onboarding end to end, on phone and desktop, then an invited person joins. */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("set up a business: company, domain, people (a bad row skipped), rules, first plan, resume from Home, go live; Ivan joins", async ({ page, browser }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-l2-${name}.png`, fullPage: true }); };
  const tag = `${info.project.name}${Date.now() % 100000}`;
  const company = `Northfield Builders ${tag}`;
  await signIn(page, "Dana Reyes");
  await page.goto("/business/start");

  // 1. About your company
  await expect(page.getByRole("heading", { name: "Start your business account" })).toBeVisible();
  await expect(page.getByText("Step 1 of 6: Company")).toBeVisible();
  await page.getByLabel("Company name").fill(company);
  await expect(page.getByLabel("Your work email")).toHaveValue("dana@northfield.example");
  await page.getByLabel("Industry").selectOption("Construction");
  await page.getByLabel("People who will use it").fill("3");
  await shot("1-company");
  await page.getByRole("button", { name: "Continue" }).click();

  // 2. Verify your domain (the test DNS answers with the record)
  await expect(page.getByText("Step 2 of 6: Domain")).toBeVisible();
  await expect(page.getByLabel("Your company's domain")).toHaveValue("northfield.example");
  await page.getByLabel("Your company's domain").fill(`nf-${tag}.example`);
  await page.getByRole("button", { name: "Get the record" }).click();
  await expect(page.getByText(/^rakuplan-verify=/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue, check again later" })).toBeVisible();
  await shot("2-domain");
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByText(`✓ Found. nf-${tag}.example is verified.`)).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // 3. Bring your people: 3 seats (Dana uses one), so the third person doesn't fit.
  await expect(page.getByRole("heading", { name: "Who should join?" })).toBeVisible();
  await page.getByLabel(/Paste names and emails/).fill("Ivan Petrov <ivan@northfield.example>\nMei Chen, mei@northfield.example\nKim Park <kim@example.com>\njust a name");
  await page.getByRole("button", { name: "Check the list" }).click();
  await expect(page.getByText(/Line 4 has no email address/)).toBeVisible();
  const people = page.getByRole("list", { name: "People to invite" });
  await expect(people.getByRole("listitem")).toHaveCount(3);
  await expect(people.getByRole("listitem", { name: "Kim Park" }).getByText("No seats left. Add seats in Licenses, or free one.")).toBeVisible();
  await expect(page.getByText("2 people ready, 1 to fix")).toBeVisible();
  await people.getByRole("listitem", { name: "Mei Chen" }).getByLabel("Role").selectOption("admin");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled(); // changed: check again first
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText("2 people ready, 1 to fix")).toBeVisible();
  await shot("3-people");
  await page.getByRole("button", { name: "Continue" }).click();

  // 4. Rules
  await expect(page.getByRole("heading", { name: "Pick a starting set of rules" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Standard \(recommended\)/ })).toBeChecked();
  await page.getByRole("radio", { name: /^Strict/ }).check();
  await expect(page.getByText("Only Owners and Admins can download plan files.")).toBeVisible();
  await shot("4-rules");
  await page.getByRole("button", { name: "Continue" }).click();

  // Leave and resume from Home.
  await expect(page.getByRole("heading", { name: "Make your first plan (2 minutes)" })).toBeVisible();
  await page.goto("/");
  const resume = page.getByRole("region", { name: `Finish setting up ${company}` });
  await expect(resume).toBeVisible();
  await resume.getByRole("button", { name: "Continue setup" }).click();

  // 5. First plan from the industry's template
  await expect(page.getByRole("radio", { name: /Start from "Construction job"/ })).toBeChecked();
  await shot("5-first");
  await page.getByRole("button", { name: 'Make "Construction job"' }).click();

  // 6. Go live
  await expect(page.getByRole("heading", { name: `${company} is ready` })).toBeVisible();
  const checklist = page.getByRole("list", { name: "Checklist" });
  await expect(checklist).toContainText("2 people get an invite link when you press Go live.");
  await expect(checklist).toContainText(`nf-${tag}.example is verified.`);
  await expect(checklist).toContainText("Second admin: Mei Chen");
  await expect(checklist).toContainText("Rules: Strict");
  await expect(checklist).toContainText("First plan: Construction job, ready to edit");
  await expect(page.getByText(/1 row won't be invited: kim@example.com \(No seats left/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Invite email preview" })).toContainText(`Dana Reyes invited you to join ${company} on Rakuplan as Member.`);
  await shot("6-live");
  await page.getByRole("button", { name: "Go live" }).click();
  await expect(page.getByRole("heading", { name: `${company} is live` })).toBeVisible();
  const links = page.getByRole("list", { name: "Invite links" });
  await expect(links.getByRole("listitem")).toHaveCount(2);
  await shot("7-done");
  const label = (await links.getByRole("button", { name: /^Copy link: .*/ }).first().getAttribute("aria-label"))!;
  const link = label.replace("Copy link: ", "");
  await page.goto("/");
  await expect(page.getByRole("region", { name: `Finish setting up ${company}` })).toHaveCount(0);

  // Ivan opens his link, signs in and joins; the company's first plan is on his Home.
  const small = page.viewportSize()!.width < 600;
  const ivan = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: small, hasTouch: small })).newPage();
  await ivan.goto(new URL(link).pathname);
  await ivan.getByRole("link", { name: "Sign in with Test ID" }).click();
  await ivan.getByRole("link", { name: "Continue as Ivan Petrov" }).click();
  await ivan.getByRole("button", { name: `Join ${company}` }).click();
  await expect(ivan.getByRole("heading", { name: /^Hi Ivan/ })).toBeVisible();
  await expect(ivan.getByRole("list", { name: "Your plans" }).getByText("Construction job").first()).toBeVisible();
});
