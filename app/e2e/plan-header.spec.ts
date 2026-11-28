/** The plan header: view picker, top actions and More, on phone and desktop. */
import { expect, test, type Page } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";
import { OTHER_PAGES, PLAN_VIEWS } from "../src/pages/plan/planNav";

const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible();
const VIEWS = ["Overview", "Checklist", "Board", "Timeline", "Grid", "Team", "Risks", "Activity"];
const MORE = ["Present", "Print summary", "Download plan file", "Add to calendar", "History and Trash"];

test("view picker: mouse and keyboard; More menu; status", async ({ page }, info) => {
  const phone = info.project.name === "phone";
  await signIn(page);
  const id = await addPlan(page, KITCHEN.replace("Kitchen Remodel", "Header Kitchen"));
  await page.goto(`/p/${id}`);
  await live(page);
  await expect(page.getByRole("status").filter({ hasText: /^Live/ })).toHaveText(/^Live/);

  // No strip of 8 tabs; one picker that lists all 8 views.
  await expect(page.getByRole("navigation", { name: "Plan views" }).getByRole("link")).toHaveCount(0);
  const picker = page.getByRole("button", { name: "Plan view: Overview" });
  await picker.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText(VIEWS.map((v) => new RegExp(`^${v}`)));
  for (const v of VIEWS) await expect(menu.getByRole("menuitem", { name: v, exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  await menu.getByRole("menuitem", { name: "Board", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${id}/board$`));
  await expect(page.getByRole("button", { name: "Plan view: Board" })).toBeVisible();

  // Keyboard: Enter opens, arrows move, Enter chooses; Escape closes without moving.
  await page.goto(`/p/${id}`);
  await live(page);
  await page.getByRole("button", { name: "Plan view: Overview" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Overview", exact: true })).toBeFocused();
  // Radix moves focus a moment after each key, as a person would see it.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Checklist", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Board", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/p/${id}/board$`));
  await page.getByRole("button", { name: "Plan view: Board" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/p/${id}/board$`));

  // Top actions and More.
  const actions = page.getByRole("group", { name: "Plan actions" });
  await expect(actions.getByRole("link", { name: "Update with my AI" })).toBeVisible();
  await expect(actions.getByRole("link", { name: "Share" })).toBeVisible();
  if (phone) await expect(actions.getByRole("link", { name: "Status report" })).toBeHidden();
  else await expect(actions.getByRole("link", { name: "Status report" })).toBeVisible();
  await actions.getByRole("button", { name: "More plan actions" }).click();
  const more = page.getByRole("menu");
  for (const name of MORE) await expect(more.getByRole("menuitem", { name, exact: true })).toBeVisible();
  await expect(more.getByRole("menuitem", { name: "Status report", exact: true })).toHaveCount(phone ? 1 : 0);
  await expect(more.getByRole("menuitem", { name: "Download plan file" })).toHaveAttribute("href", `/api/plans/${id}/export`);
  await expect(more.getByRole("menuitem", { name: "Add to calendar" })).toHaveAttribute("href", `/api/plans/${id}/calendar.ics`);
  await more.getByRole("menuitem", { name: "History and Trash" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${id}/history$`));
  await expect(page.getByRole("button", { name: "Plan view: History and Trash" })).toBeVisible();

  // Present opens from More.
  await actions.getByRole("button", { name: "More plan actions" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Present" }).click();
  await expect(page.getByRole("dialog", { name: "Presentation" })).toBeVisible();
});

test("a viewer: no Update, More still has the file, View only", async ({ page: alex, browser }) => {
  await signIn(alex);
  const id = await addPlan(alex, KITCHEN.replace("Kitchen Remodel", "Viewer Kitchen"));
  const link = ((await (await alex.request.post(`/api/plans/${id}/invites`, { data: { email: "sam@example.com", role: "viewer" } })).json()) as { link: string }).link;
  const ctx = await browser.newContext({ viewport: alex.viewportSize()!, isMobile: alex.viewportSize()!.width < 600, hasTouch: alex.viewportSize()!.width < 600 });
  const sam = await ctx.newPage();
  await signIn(sam, "Sam Okoye");
  expect((await sam.request.post(`/api/invites/${link.split("/invite/")[1]}/accept`, { data: {} })).status()).toBe(200);
  await sam.goto(`/p/${id}`);
  await live(sam);
  await expect(sam.getByText("View only")).toBeVisible();
  await expect(sam.getByRole("link", { name: "Update with my AI" })).toHaveCount(0);
  await sam.getByRole("button", { name: "More plan actions" }).click();
  await expect(sam.getByRole("menu").getByRole("menuitem", { name: "Download plan file" })).toBeVisible();
  await ctx.close();
});

test("a long title never makes the page scroll sideways", async ({ page }) => {
  await signIn(page);
  const title = "Long " + "very long plan title words ".repeat(5).slice(0, 115);
  expect(title.length).toBe(120);
  const id = await addPlan(page, KITCHEN.replace("Kitchen Remodel", title));
  await page.goto(`/p/${id}`);
  await live(page);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a plan inside a master links back to the master", async ({ page }, info) => {
  const tag = `${info.project.name}${Date.now() % 100000}`;
  const plan = (title: string) => `---\nrakuplan: 1\ntitle: ${title}\nstart: 2027-01-04\n---\n## P1: Work\n- [ ] T1: Walls (2d) @Kai\n`;
  await signIn(page);
  const a = await addPlan(page, plan(`Lobby ${tag}`));
  const b = await addPlan(page, plan(`Atrium ${tag}`));
  const res = await page.request.post("/api/masters", { data: { title: `Campus ${tag}`, planIds: [a, b] } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const masterId = ((await res.json()) as { id: string }).id;
  await page.goto(`/p/${a}`);
  await live(page);
  const back = page.getByRole("link", { name: new RegExp(`^Campus ${tag}`) });
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute("href", `/m/${masterId}`);
  await expect(page.getByText(`Part of the master plan Campus ${tag}`)).toBeVisible();
});

for (const width of [360, 421, 501]) test(`at ${width}px the picker shows the whole name of every page, with no sideways scroll`, async ({ page }) => {
  await page.setViewportSize({ width, height: 740 });
  await signIn(page);
  const id = await addPlan(page, KITCHEN.replace("Kitchen Remodel", "Narrow Kitchen"));
  // Every view, and every page reached from the header that shows the picker (print has its own sheet).
  const pages = [...PLAN_VIEWS.map((v) => ({ view: v.view, name: v.label })), ...["update", "report", "history", "share"].map((v) => ({ view: v, name: OTHER_PAGES[v]! }))];
  for (const { view, name } of pages) {
    await page.goto(`/p/${id}${view ? `/${view}` : ""}`);
    await live(page);
    const label = page.getByRole("button", { name: `Plan view: ${name}` }).locator("[data-picker-label]");
    await expect(label).toBeVisible();
    const fits = await label.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits, `${name}: label is cut off`).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: page scrolls sideways`).toBe(true);
  }
  // Update and Share keep their names (icon-only up to 500px, with a tooltip).
  if (width <= 500) expect((await page.getByRole("link", { name: "Update with my AI" }).innerText()).trim()).toBe("");
  await expect(page.getByRole("link", { name: "Update with my AI" })).toHaveAttribute("title", "Update with my AI");
  await expect(page.getByRole("group", { name: "Plan actions" }).getByRole("link", { name: "Share", exact: true })).toBeVisible();
});

test("More menu groups are named", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN.replace("Kitchen Remodel", "Group Kitchen"));
  await page.goto(`/p/${id}`);
  await live(page);
  await page.getByRole("button", { name: "More plan actions" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("group", { name: "Share and report" }).getByRole("menuitem", { name: "Present" })).toBeVisible();
  await expect(menu.getByRole("group", { name: "File" }).getByRole("menuitem", { name: "Download plan file" })).toBeVisible();
});

test("slim bar appears on scroll", async ({ page }, info) => {
  const phone = info.project.name === "phone";
  const title = "Long " + "very long plan title words ".repeat(5).slice(0, 115);
  const tasks = Array.from({ length: 40 }, (_, i) => `- [ ] T${i + 1}: Task number ${i + 1} (1d) @Jordan${i ? ` depends: T${i}` : ""}`).join("\n");
  const text = `---\nrakuplan: 1\ntitle: ${title}\nstart: 2027-01-04\nteam: Jordan\n---\n## P1: Work\n${tasks}\n`;
  await signIn(page);
  const id = await addPlan(page, text);
  await page.goto(`/p/${id}/checklist`);
  await live(page);
  const bar = page.getByRole("region", { name: "Plan bar" });
  await expect(bar).toBeHidden();
  await expect(page.locator("section[aria-label='Plan bar']")).toHaveAttribute("inert", "");
  expect(await page.locator("section[aria-label='Plan bar'] [role=status]").count()).toBe(0);

  // Row 2 half visible below the top bar: still hidden. Fully scrolled past: visible.
  const topBar = await page.evaluate(() => Math.round(document.querySelector("header.sticky")!.getBoundingClientRect().height));
  const rowBottom = await page.evaluate(() => document.querySelector("[data-plan-row2]")!.getBoundingClientRect().bottom + scrollY);
  await page.evaluate((y) => window.scrollTo(0, y), rowBottom - topBar - 20);
  await page.waitForTimeout(300);
  await expect(bar).toBeHidden();
  await page.evaluate((y) => window.scrollTo(0, y), rowBottom - topBar + 4);
  await expect(bar).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 1200));
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Plan view: Checklist" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Share" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "More plan actions" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Update with my AI" })).toBeVisible();
  const box = (await bar.boundingBox())!;
  if (phone) {
    const top = await page.evaluate(() => document.querySelector("header.sticky")!.getBoundingClientRect().bottom);
    expect(Math.abs(box.y - top)).toBeLessThanOrEqual(1);
  } else expect(box.y).toBeLessThanOrEqual(1);
  const t = bar.getByTestId("bar-title");
  await expect(t).toHaveText(title);
  expect(await t.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // The bar's picker works.
  await bar.getByRole("button", { name: "Plan view: Checklist" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Board", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${id}/board$`));
  await page.goto(`/p/${id}/checklist`);
  await live(page);
  // The list may still be filling in after a reload, so scroll again until the page is tall enough.
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect(bar).toBeVisible({ timeout: 1000 });
  }).toPass();

  await page.emulateMedia({ media: "print" });
  await expect(bar).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await expect(bar).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar).toBeHidden();
  await expect(page.locator("section[aria-label='Plan bar']")).toHaveAttribute("aria-hidden", "true");
});

const BIG = (name: string) => `---\nrakuplan: 1\ntitle: ${name}\nstart: 2027-01-04\nteam: ${Array.from({ length: 20 }, (_, i) => `Pat${i}`).join(", ")}\n---\n## P1: Work\n${Array.from({ length: 40 }, (_, i) => `- [ ] T${i + 1}: Task number ${i + 1} (1d) @Pat${i % 20}`).join("\n")}\n`;

test("sticky table cells never paint over the slim bar (desktop)", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "desktop layout");
  await signIn(page);
  const id = await addPlan(page, BIG("Stack Kitchen"));
  for (const view of ["grid", "team"]) {
    await page.goto(`/p/${id}/${view}`);
    await live(page);
    await page.evaluate(() => window.scrollTo(0, 700));
    const bar = page.getByRole("region", { name: "Plan bar" });
    await expect(bar).toBeVisible();
    await page.waitForTimeout(300);
    const ok = await page.evaluate(() => {
      const b = document.querySelector("section[aria-label='Plan bar']")!;
      const t = b.querySelector("[data-testid=bar-title]")!.getBoundingClientRect();
      const hit = document.elementFromPoint(t.left + 20, t.top + t.height / 2);
      return !!hit && b.contains(hit);
    });
    expect(ok, `${view}: something paints over the bar`).toBe(true);
    if (process.env.SHOTS) await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-bar-${view}.png` });
  }
});

test("scroll padding clears the bar while a plan page is open", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN.replace("Kitchen Remodel", "Pad Kitchen"));
  await page.goto(`/p/${id}`);
  await live(page);
  const pad = () => page.evaluate(() => document.documentElement.style.scrollPaddingTop);
  await expect.poll(async () => parseInt(await pad())).toBeGreaterThan(30);
  await page.getByRole("link", { name: "All plans" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(pad).toBe("");
});

test("focus inside the bar moves to row 2 when the bar hides (desktop)", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "desktop layout");
  await signIn(page);
  const id = await addPlan(page, BIG("Focus Kitchen"));
  await page.goto(`/p/${id}/checklist`);
  await live(page);
  await page.evaluate(() => window.scrollTo(0, 1200));
  const bar = page.getByRole("region", { name: "Plan bar" });
  await expect(bar).toBeVisible();
  await bar.getByRole("link", { name: "Share" }).focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    return { name: a.getAttribute("aria-label"), inRow2: !!a.closest("[data-plan-row2]") };
  })).toEqual({ name: "Share", inRow2: true });
});

test("the print summary keeps the header, hidden when printing", async ({ page }) => {
  await signIn(page);
  const id = await addPlan(page, KITCHEN.replace("Kitchen Remodel", "Print Kitchen"));
  await page.goto(`/p/${id}/print`);
  const picker = page.getByRole("button", { name: "Plan view: Print summary" }).first();
  await expect(picker).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(picker).toBeHidden();
});

test("screenshots of the header and slim bar", async ({ page }, info) => {
  test.skip(!process.env.SHOTS, "screenshots only when SHOTS=1");
  const tasks = Array.from({ length: 40 }, (_, i) => `- [ ] T${i + 1}: Task number ${i + 1} (1d) @Jordan`).join("\n");
  await signIn(page);
  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Shots Kitchen Remodel\nstart: 2027-01-04\nteam: Jordan\n---\n## P1: Work\n${tasks}\n`);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const v of PLAN_VIEWS) {
      await page.goto(`/p/${id}${v.view ? `/${v.view}` : ""}`);
      await live(page);
      await page.evaluate(() => window.scrollTo(0, 1200));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/.results/shots/${info.project.name}-h3-${scheme}-${v.view || "overview"}.png` });
    }
  }
});
