/** Step L3b: command bar, person panel → offboarding (plans and tasks handed over), rules preview, domains, audit log; phone and desktop. */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function as(browser: Browser, page: Page, who: "Ivan Petrov" | "Mei Chen") {
  const small = page.viewportSize()!.width < 600;
  const p = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: small, hasTouch: small })).newPage();
  await signIn(p, who);
  return p;
}

test("admin console part 2: command bar, offboarding, rules, domains, audit log", async ({ page, browser }, info) => {
  const shot = async (name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-l3b-${name}.png`, fullPage: true }); };
  const phone = page.viewportSize()!.width < 600;
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page, "Dana Reyes");
  const org = (await (await page.request.post("/api/orgs", { data: { name: `Cedar ${tag}`, people: 5 } })).json()) as { id: string; workspaceId: string };
  const sent = (await (await page.request.post(`/api/orgs/${org.id}/invites`, { data: { people: [{ email: "ivan@northfield.example", name: "Ivan Petrov" }, { email: "mei@northfield.example", name: "Mei Chen" }] } })).json()) as { invited: { link: string }[] };
  const ivan = await as(browser, page, "Ivan Petrov");
  const mei = await as(browser, page, "Mei Chen");
  for (const [p, i] of [[ivan, 0], [mei, 1]] as const) expect((await p.request.post(`/api/join/${sent.invited[i]!.link.split("/join/")[1]}/accept`, { data: {} })).status()).toBe(200);
  const made = await ivan.request.post("/api/plans", { data: { workspaceId: org.workspaceId, text: `---\nrakuplan: 1\ntitle: Gate ${tag}\n---\n## P1: Work\n- [ ] T1: Order the gate (1d) @Ivan\n- [ ] T2: Fit it (1d) @Mei` } });
  const planId = ((await made.json()) as { id: string }).id;

  // Command bar → Ivan's panel → Offboard.
  await page.goto(`/admin/org/${org.id}`);
  await page.getByRole("button", { name: /^Search/ }).click();
  const bar = page.getByRole("dialog", { name: "Command bar" });
  await bar.getByLabel("Search people, plans, workspaces and settings").fill("ivan");
  await expect(bar.getByRole("option").first()).toContainText("Ivan Petrov");
  await shot("1-command");
  await bar.getByLabel("Search people, plans, workspaces and settings").press("Enter");
  const panel = page.getByRole("dialog", { name: "Ivan Petrov" });
  await expect(panel).toBeVisible();
  await panel.getByRole("link", { name: "Offboard…" }).click();

  await expect(page.getByRole("heading", { name: "Offboarding" })).toBeVisible();
  await expect(page.getByLabel("Who is leaving?")).toHaveValue(/.+/);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Ivan Petrov made 1 plan and has 1 open task in the company's plans.")).toBeVisible();
  await page.getByLabel("Hand their work to").selectOption({ label: "Mei Chen" });
  await shot("2-handover");
  await page.getByRole("button", { name: "Continue" }).click();
  const will = page.getByRole("list", { name: "What will happen" });
  await expect(will).toContainText(`Gate ${tag}: new owner Mei Chen`);
  await expect(will).toContainText("1 open task handed over");
  await shot("3-confirm");
  await page.getByRole("button", { name: "Offboard Ivan Petrov" }).click();
  await expect(page.getByText(/^Ivan Petrov is offboarded: signed out of \d+ devices?/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Orphaned plans" })).toContainText("Every plan has an owner in the company.");
  await shot("4-done");
  expect((await ivan.request.get(`/api/plans/${planId}`)).status()).toBe(401); // signed out everywhere
  const tasks = ((await (await mei.request.get(`/api/plans/${planId}`)).json()) as { plan: { phases: { tasks: { owner: string }[] }[] } }).plan.phases[0]!.tasks.map((t) => t.owner);
  expect(tasks).toEqual(["Mei", "Mei"]); // written the way the plan already names Mei

  // Rules: who a change affects, then save.
  const nav = async (name: string) => {
    if (phone) { await page.getByRole("button", { name: "Sections" }).click(); await page.getByRole("dialog", { name: "Console sections" }).getByRole("link", { name, exact: true }).click(); }
    else await page.getByRole("navigation", { name: "Admin console" }).getByRole("link", { name, exact: true }).click();
  };
  await nav("Rules");
  await page.getByRole("radio", { name: /^Open/ }).check();
  const affects = page.getByRole("region", { name: "Who this affects" });
  await expect(affects).toContainText("People who can invite outsiders: 1 now, 2 after.");
  await shot("5-rules");
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByText("Rules saved. The change is in the audit log.")).toBeVisible();

  // Domains: add, check (the test DNS answers), verified.
  await nav("Domains");
  await page.getByLabel("Your company's domain").fill(`cedar-${tag}.example`);
  await page.getByRole("button", { name: "Get the record" }).click();
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByRole("region", { name: `cedar-${tag}.example` }).getByText("Verified", { exact: true })).toBeVisible();
  await shot("6-domains");

  // Audit log: intact, filtered to offboarding.
  await nav("Audit log");
  await expect(page.getByText(/^✓ Log intact/)).toBeVisible();
  await page.getByLabel("What happened").selectOption({ label: "Offboarded" });
  await expect(page.getByRole("list", { name: "Audit entries" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Audit entries" })).toContainText("ivan@northfield.example by Dana Reyes");
  await shot("7-audit");
  await ivan.context().close();
  await mei.context().close();
});
