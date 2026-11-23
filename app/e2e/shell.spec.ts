import { expect, test } from "@playwright/test";
import { addPlan, KITCHEN, signIn } from "./helpers";

test("signed-out visitors see the sign-in page, and sign-in returns them to where they were going", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("link", { name: "Sign in with Test ID" }).click();
  await page.getByRole("link", { name: "Continue as Alex Rivera" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("Home shows each plan's progress, health, finish and next milestone", async ({ page }) => {
  await signIn(page);
  await addPlan(page, KITCHEN);
  await page.reload();
  const card = page.getByRole("list", { name: "Your plans" }).getByRole("link", { name: /Kitchen Remodel/ }).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText("1 of 5 tasks done");
  await expect(card).toContainText("Order placed");
  await expect(card.getByRole("img", { name: /% done/ })).toBeVisible();
  await expect(card).toContainText(/On track|At risk|Off track/);
});

test("the same destinations are reachable on phone and desktop", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  await expect(nav).toHaveCount(1);
  for (const name of ["Home", "New plan", "Settings"]) await expect(nav.getByRole("link", { name })).toBeVisible();
  await nav.getByRole("link", { name: "New plan" }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(nav.getByRole("link", { name: "New plan" })).toHaveAttribute("aria-current", "page");
});

test("pages are served with security headers, and unknown addresses open the app", async ({ page, request }) => {
  const res = await request.get("/p/does-not-exist");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await request.get("/assets/missing.js")).status()).toBe(404);
  expect((await request.get("/_headers")).status()).toBe(404);
  await signIn(page, "Alex Rivera", "/nowhere");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("signing out ends the session, from Settings on any screen size", async ({ page }) => {
  await signIn(page);
  await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("main").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect((await page.request.get("/api/me")).status()).toBe(401);
});

test("signing out on every device ends all sessions", async ({ browser, page }) => {
  await signIn(page);
  const other = await browser.newContext();
  const phone2 = await other.newPage();
  await signIn(phone2);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out on every device" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect((await phone2.request.get("/api/me")).status()).toBe(401);
  await other.close();
});
