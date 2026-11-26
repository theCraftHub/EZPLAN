/** Step L1: a company invite link, opened and accepted by the invited person. */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("a company invite: the invited person signs in, sees who invited them, and joins", async ({ page: dana, browser }, info) => {
  await signIn(dana, "Dana Reyes");
  const org = (await (await dana.request.post("/api/orgs", { data: { name: `Rivera Co ${info.project.name}`, people: 5 } })).json()) as { id: string };
  const sent = (await (await dana.request.post(`/api/orgs/${org.id}/invites`, { data: { people: [{ email: `ivan@northfield.example`, name: "Ivan Petrov", department: "IT" }] } })).json()) as { invited: { link: string }[] };
  const ivan = await (await browser.newContext({ viewport: dana.viewportSize()!, isMobile: dana.viewportSize()!.width < 600, hasTouch: dana.viewportSize()!.width < 600 })).newPage();
  await ivan.goto(new URL(sent.invited[0]!.link).pathname);
  await ivan.getByRole("link", { name: "Sign in with Test ID" }).click();
  await ivan.getByRole("link", { name: "Continue as Ivan Petrov" }).click();
  await expect(ivan.getByText(new RegExp(`Dana Reyes invited you to join Rivera Co ${info.project.name}`))).toBeVisible();
  await ivan.getByRole("button", { name: `Join Rivera Co ${info.project.name}` }).click();
  await expect(ivan.getByRole("heading", { name: /^Hi Ivan/ })).toBeVisible();
  const orgs = (await (await ivan.request.get("/api/orgs")).json()) as { orgs: { name: string; role: string }[] };
  expect(orgs.orgs).toContainEqual(expect.objectContaining({ name: `Rivera Co ${info.project.name}`, role: "member" }));
  // The link worked once.
  await ivan.goto(new URL(sent.invited[0]!.link).pathname);
  await expect(ivan).toHaveURL(/\/$/);
});
