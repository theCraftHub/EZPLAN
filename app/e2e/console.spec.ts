/** Step L3a: the company admin console on phone and desktop (Overview, People, bulk change with undo, person panel, Add people, Licenses). */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function joinAs(browser: Browser, page: Page, who: "Ivan Petrov" | "Mei Chen", link: string) {
  const small = page.viewportSize()!.width < 600;
  const p = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: small, hasTouch: small })).newPage();
  await signIn(p, who);
  expect((await p.request.post(`/api/join/${link.split("/join/")[1]}/accept`, { data: {} })).status()).toBe(200);
  await p.context().close();
}

test("admin console: overview, add a workspace, bulk move with preview and undo, person panel, seats, add people", async ({ page, browser }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-l3a-${name}.png`, fullPage: true }); };
  const phone = page.viewportSize()!.width < 600;
  const tag = `${info.project.name}${Date.now() % 100000}`;
  const company = `Harbor ${tag}`;
  await signIn(page, "Dana Reyes");
  const org = (await (await page.request.post("/api/orgs", { data: { name: company, people: 4 } })).json()) as { id: string };
  const sent = (await (await page.request.post(`/api/orgs/${org.id}/invites`, { data: { people: [
    { email: "ivan@northfield.example", name: "Ivan Petrov", department: "Field Ops" },
    { email: "mei@northfield.example", name: "Mei Chen", department: "Field Ops" },
    { email: "noah@northfield.example", name: "Noah Diaz" },
  ] } })).json()) as { invited: { email: string; link: string }[] };
  await joinAs(browser, page, "Ivan Petrov", sent.invited[0]!.link);
  await joinAs(browser, page, "Mei Chen", sent.invited[1]!.link);

  // Overview
  await page.goto(`/admin/org/${org.id}`);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("4 of 4")).toBeVisible();
  const attention = page.getByRole("region", { name: "Needs attention" });
  await expect(attention).toContainText("1 invite not accepted");
  await expect(attention).toContainText("No seats left");
  const workspaces = page.getByRole("region", { name: "Workspaces" });
  await workspaces.getByLabel("New workspace").fill("Field Ops North");
  await workspaces.getByRole("button", { name: "Add workspace" }).click();
  await expect(workspaces.getByText("Field Ops North")).toBeVisible();
  await shot("1-overview");

  // People, through the panel (a sheet on phones)
  if (phone) {
    await page.getByRole("button", { name: "Sections" }).click();
    await page.getByRole("dialog", { name: "Console sections" }).getByRole("link", { name: /^People\s*(,|$)/ }).click();
  } else await page.getByRole("navigation", { name: "Admin console" }).getByRole("link", { name: /^People\s*(,|$)/ }).click();
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  await expect(page.getByText("Showing 4 people")).toBeVisible();
  await page.getByRole("button", { name: "Field Ops", exact: true }).click();
  await expect(page.getByText("Showing 2 people of 4")).toBeVisible();
  await page.getByLabel("Select everyone shown").check();
  const bar = page.getByRole("region", { name: "Change selected people" });
  await expect(bar).toContainText("2 people selected");
  await bar.getByLabel("Change", { exact: true }).selectOption("workspace");
  await bar.getByLabel("Workspace", { exact: true }).selectOption({ label: "Field Ops North" });
  await bar.getByRole("button", { name: "Preview" }).click();
  const preview = bar.getByRole("region", { name: "Preview" });
  await expect(preview).toContainText("2 people will change. You can undo this for 24 hours.");
  await expect(preview).toContainText(`Ivan Petrov: ${company} → Field Ops North`);
  await shot("2-preview");
  await preview.getByRole("button", { name: "Move 2 people" }).click();
  await expect(page.getByText("Changed 2 people. You can undo this for 24 hours.")).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await shot("3-moved");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Changed 2 people.")).toHaveCount(0);
  const ivanWs = (await (await page.request.get(`/api/orgs/${org.id}/people`)).json()) as { people: { name: string; workspaces: string[] }[] };
  const o = (await (await page.request.get(`/api/orgs/${org.id}`)).json()) as { workspaces: { id: string; name: string }[] };
  expect(ivanWs.people.find((p) => p.name === "Ivan Petrov")!.workspaces).toEqual([o.workspaces.find((w) => w.name === company)!.id]);

  // Person panel
  await page.getByRole("button", { name: "Ivan Petrov" }).first().click();
  const panel = page.getByRole("dialog", { name: "Ivan Petrov" });
  await expect(panel).toContainText("Field Ops");
  await panel.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(panel.getByText(/^Signed out of \d+ devices?\./)).toBeVisible();
  await shot("4-person");
  await panel.getByRole("button", { name: "Close" }).click();

  // Add people: no seats left until the Owner adds one in Licenses.
  await page.goto(`/admin/org/${org.id}/add`);
  await page.getByLabel(/Paste names and emails/).fill("Ola Berg <ola@northfield.example>");
  await page.getByRole("button", { name: "Check the list" }).click();
  await expect(page.getByText("No seats left. Add seats in Licenses, or free one.")).toBeVisible();
  await page.goto(`/admin/org/${org.id}/licenses`);
  await page.getByRole("button", { name: "More seats" }).click();
  await page.getByRole("button", { name: "Save seats" }).click();
  await expect(page.getByText("Seats saved.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Seats" })).toContainText("5");
  await shot("5-licenses");
  await page.goto(`/admin/org/${org.id}/add`);
  await page.getByLabel(/Paste names and emails/).fill("Ola Berg <ola@northfield.example>");
  await page.getByRole("button", { name: "Check the list" }).click();
  await page.getByRole("button", { name: "Invite 1 person" }).click();
  await expect(page.getByRole("list", { name: "Invite links" }).getByText("ola@northfield.example")).toBeVisible();
  await shot("6-added");
  await page.getByRole("button", { name: "See People" }).click();
  await expect(page.getByText("Showing 5 people")).toBeVisible();
});
