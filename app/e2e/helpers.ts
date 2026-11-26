import { expect, type Page } from "@playwright/test";

/** Signs in through the real flow: our sign-in page → the test sign-in service → back to the app. */
export async function signIn(page: Page, who: "Alex Rivera" | "Sam Okoye" | "Kim Park" | "Pat Lee" = "Alex Rivera", path = "/") {
  await page.goto(path);
  await page.getByRole("link", { name: "Sign in with Test ID" }).click();
  await page.getByRole("link", { name: `Continue as ${who}` }).click();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

/** Adds a plan through the API as the signed-in person (same as pasting it on the New plan screen). */
export async function addPlan(page: Page, text: string): Promise<string> {
  const res = await page.request.post("/api/plans", { data: { text } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

export const KITCHEN = `---
rakuplan: 1
title: Kitchen Remodel
goal: New kitchen ready by spring.
start: 2027-01-04
team: Jordan, Priya
---
## P1: Plan and order
- [x] T1: Measure the kitchen (1d) @Jordan done: 2027-01-04 by Jordan
- [/] T2: Get three contractor quotes (3d) @Priya depends: T1
- [ ] T3: Order cabinets (2d) @Jordan depends: T2
- [ ] M1: Order placed (milestone) depends: T3
## P2: Build
- [ ] T4: Remove old cabinets (2d) @Jordan depends: M1
- [ ] T5: Install new cabinets (4d) @Jordan depends: T4
- [ ] M2: Kitchen ready (milestone) depends: T5
`;
