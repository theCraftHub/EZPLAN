/** Step N1: share a read-only link; someone without an account opens it, sees changes, presents; the link is turned off. */
import { expect, test } from "@playwright/test";
import { addPlan, signIn } from "./helpers";

test("share link: make, open without signing in, stays current, present, turn off", async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  const shot = async (p: typeof page, name: string) => { if (process.env.SHOTS) await p.screenshot({ path: `e2e/.results/shots/${info.project.name}-n1-${name}.png`, fullPage: true }); };
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page, "Kim Park");
  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Patio ${tag}\nstart: 2027-01-04\nteam: Kim <kim@example.com>\n---\n## P1: Build\n- [ ] T1: Level the ground (2d) @Kim\n- [ ] M1: Patio ready (milestone) depends: T1`);
  await page.goto(`/p/${id}/share`);
  const links = page.getByRole("region", { name: "Share links" });
  await links.getByLabel("Works for").selectOption("7");
  await links.getByRole("button", { name: "Make a link" }).click();
  const url = (await links.locator("code").innerText()).trim();
  expect(url).toMatch(/\/s\//);
  await shot(page, "1-make");

  // Someone with no account.
  const small = page.viewportSize()!.width < 600;
  const guest = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: small, hasTouch: small })).newPage();
  await guest.goto(new URL(url).pathname);
  await expect(guest.getByRole("heading", { name: `Patio ${tag}` })).toBeVisible();
  await expect(guest.getByText(/Shared with you · read-only/)).toBeVisible();
  await expect(guest.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  expect(await guest.content()).not.toContain("kim@example.com");
  await guest.getByRole("button", { name: "Checklist" }).click();
  await expect(guest.getByRole("region", { name: "Phase: Build" })).toContainText("Level the ground");
  await shot(guest, "2-shared");
  // The owner finishes a task; the shared page shows it (it checks every 30 seconds; a reload is immediate).
  expect((await page.request.post(`/api/plans/${id}/ops`, { data: { opId: `s-${tag}`, clientId: "e2e", op: { kind: "setStatus", taskId: "T1", status: "done" } } })).status()).toBe(200);
  await guest.reload();
  await guest.getByRole("button", { name: "Checklist" }).click();
  await expect(guest.getByRole("region", { name: "Phase: Build" }).getByText("Done", { exact: true })).toBeVisible();

  // Presentation mode.
  await guest.getByRole("button", { name: "Present" }).click();
  const deck = guest.getByRole("dialog", { name: "Presentation" });
  await expect(deck.getByRole("heading", { name: `Patio ${tag}` })).toBeVisible();
  await guest.keyboard.press("ArrowRight");
  await expect(deck.getByRole("heading", { name: "Milestones" })).toBeVisible();
  await expect(deck).toContainText("Patio ready");
  await shot(guest, "3-present");
  await guest.keyboard.press("Escape");
  await expect(deck).toHaveCount(0);

  // Turned off: the page says so on the next load.
  await links.getByRole("button", { name: "Turn off" }).click();
  await expect(links.getByRole("list", { name: "Links that work now" })).toHaveCount(0);
  await guest.reload();
  await expect(guest.getByText("This link doesn't work any more. Ask whoever sent it for a new one.")).toBeVisible();
  await guest.context().close();
});
