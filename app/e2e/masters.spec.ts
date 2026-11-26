/** Step K3: master plans in the app, on phone and desktop. */
import { expect, test } from "@playwright/test";
import { addPlan, signIn } from "./helpers";

const plan = (title: string, body: string) => `---\nrakuplan: 1\ntitle: ${title}\nstart: 2027-01-04\n---\n## P1: Work\n${body}\n`;

test("group plans into a master; overview, what-if, timeline, departments, discussion, activity; a plan inside it", async ({ page }, info) => {
  const shot = (name: string) => `e2e/.results/shots/${info.project.name}-k3-${name}.png`;
  const tag = `${info.project.name}${Date.now() % 100000}`; // unique: other tests make plans with similar names
  await signIn(page);
  const recId = await addPlan(page, plan(`Reception ${tag}`, "- [ ] T1: Demolish old front desk (2d) @Kai dept: Facilities\n- [ ] T2: Move network closet (3d) @Ivan dept: IT depends: T1"));
  await addPlan(page, plan(`Kitchen ${tag}`, "- [ ] T1: Strip old kitchen (3d) @Kai dept: Facilities\n- [ ] T2: Install cabinets (4d) @Kai dept: Facilities depends: T1"));
  const officeId = await addPlan(page, plan(`Office ${tag}`, `- [ ] T1: Walls and paint (3d) @Kai dept: Facilities\n- [ ] T2: Network cabling (2d) @Ivan dept: IT depends: T1, reception-${tag}/T2`));

  // Home: New master plan, choose the three plans.
  await page.goto("/");
  await page.getByRole("button", { name: "New master plan" }).click();
  const form = page.getByRole("region", { name: "New master plan" });
  await form.getByLabel("Name").fill(`HQ remodel ${tag}`);
  for (const t of ["Reception", "Kitchen", "Office"]) await form.getByLabel(`${t} ${tag}`, { exact: true }).check();
  await form.getByRole("button", { name: "Make the master plan" }).click();
  await expect(page.getByRole("heading", { name: `HQ remodel ${tag}` })).toBeVisible();
  await expect(page.getByText(/Master plan · 3 plans inside/)).toBeVisible();

  // Overview: plan cards, what waits across plans, and the finish; Kai is shared, so his work decides it.
  await expect(page.getByRole("region", { name: `Office ${tag}` }).getByText(/Waits on Move network closet/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Waiting across plans" }).getByText("Move network closet")).toBeVisible();
  await expect(page.getByRole("region", { name: "What decides the finish" }).getByText(/Kai works on 3 plans/)).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: shot("overview"), fullPage: true });
  const tryIt = page.getByRole("form", { name: "Try a change" });
  await tryIt.getByLabel("Someone's hours change").selectOption("Kai");
  await tryIt.getByLabel("hours a week").fill("80");
  await expect(tryIt.getByRole("status")).toContainText(/The finish moves from .+ to /);
  await tryIt.getByRole("button", { name: "Clear" }).click();

  // Timeline: open a plan for its tasks.
  await page.getByRole("link", { name: "Timeline", exact: true }).click();
  await page.getByRole("button", { name: `▸ Kitchen ${tag}` }).click();
  await expect(page.getByText("Install cabinets")).toBeVisible();

  // Departments: Facilities, with Kai booked across every plan; add a contact.
  await page.getByRole("link", { name: "Departments", exact: true }).click();
  const fac = page.getByRole("region", { name: "Department Facilities" });
  await expect(fac.getByText(/open tasks/)).toBeVisible();
  await expect(fac.getByText(/^Kai/)).toBeVisible();
  await fac.getByRole("button", { name: "Add a contact" }).click();
  await fac.getByLabel("Facilities contact").fill("Dana Reyes");
  await fac.getByLabel("Role").fill("Facilities lead");
  await fac.getByRole("button", { name: "Save" }).click();
  await expect(fac.getByText("Dana Reyes · Facilities lead")).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: shot("departments"), fullPage: true });

  // Discussion: post in Whole building.
  await page.getByRole("link", { name: "Discussion", exact: true }).click();
  await page.getByLabel("Message Whole building").fill("Permits approved. Every room can start.");
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByRole("listitem", { name: "Message from Alex Rivera" })).toContainText("Permits approved");

  // Activity across plans, filtered to one plan.
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page.getByText(/posted in the Whole building discussion/)).toBeVisible();
  await page.getByRole("group", { name: "Plan" }).getByRole("button", { name: "Whole building" }).click();
  await expect(page.getByText(/made the master plan with 3 plans/)).toBeVisible();

  // A plan inside: its link back, and its wait on another plan, in words.
  await page.goto(`/p/${officeId}/checklist`);
  await expect(page.getByRole("link", { name: new RegExp(`HQ remodel ${tag} › Office ${tag}`) })).toBeVisible();
  await expect(page.getByText(`Part of the master plan HQ remodel ${tag}`)).toBeVisible();
  await expect(page.getByText(new RegExp(`waits on Reception ${tag}: Move network closet`))).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: shot("inside"), fullPage: true });
  void recId;
});
