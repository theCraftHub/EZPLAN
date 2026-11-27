/** Step S1: hostile text shows as plain text and never runs; pages carry the security policy. */
import { expect, test } from "@playwright/test";
import { addPlan, signIn } from "./helpers";

const PAYLOAD = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>`;

test("hostile text in a company name and a comment shows as text and never runs", async ({ page, browser }, info) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
  const tag = `${info.project.name}${Date.now() % 100000}`;
  await signIn(page);
  const policy = (await page.request.get("/")).headers()["content-security-policy"] ?? "";
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("frame-ancestors 'none'");

  const id = await addPlan(page, `---\nrakuplan: 1\ntitle: Safe ${tag}\n---\n## P1: Work\n- [ ] T1: Order cabinets (1d)`);
  expect((await page.request.post(`/api/plans/${id}/tasks/T1/comments`, { data: { body: `Look ${PAYLOAD}` } })).status()).toBe(201);
  await page.goto(`/p/${id}/checklist`);
  await page.getByRole("button", { name: /^Order cabinets(?!:)/ }).first().click();
  await expect(page.getByRole("dialog").getByText(`Look ${PAYLOAD}`)).toBeVisible();

  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();

  const small = page.viewportSize()!.width < 600;
  const dana = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: small, hasTouch: small })).newPage();
  dana.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await signIn(dana, "Dana Reyes");
  const org = (await (await dana.request.post("/api/orgs", { data: { name: `${PAYLOAD} ${tag}`, people: 2 } })).json()) as { id: string };
  await dana.goto(`/admin/org/${org.id}`);
  await expect(dana.getByText(`${PAYLOAD} ${tag} · admin console`)).toBeVisible();
  await dana.goto("/");
  await expect(dana.getByRole("region", { name: `Finish setting up ${PAYLOAD} ${tag}` })).toBeVisible();
  expect(await dana.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(dialogs).toEqual([]);
  await dana.context().close();
});
