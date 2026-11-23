/**
 * Sign-in and sessions contract, written once and run on both hosts against FakeOidc.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeOidc, type FakeClaims, type Tamper } from "./fakeOidc";
import { TODAY, type HostFactory, type TestHost } from "./contract";

export const PUBLIC_URL = "https://plans.test";
export const ALLOWED = ["pat@example.com", "lee@example.com", "kai@example.com"];
const nowMs = () => Date.parse(`${TODAY}T12:00:00Z`);

export function newFake() {
  return FakeOidc.create(nowMs);
}

function cookieFrom(res: Response): string | null {
  const raw = res.headers.get("set-cookie") ?? "";
  const m = /(?:^|,\s*)session=([^;]*)/.exec(raw);
  return m && m[1] ? `session=${m[1]}` : null;
}

export function signInContract(hostName: string, factory: HostFactory) {
  describe(`Sign-in and sessions: ${hostName}`, () => {
    let host: TestHost;
    let fake: FakeOidc;

    beforeAll(async () => {
      fake = await newFake();
      host = await factory.start({ testAuth: false, fake });
    }, 60_000);
    afterAll(async () => host?.stop());

    /** Runs the whole browser round trip; returns the callback response. */
    async function signIn(claims: FakeClaims, tamper: Tamper = {}, returnTo = "/plans") {
      const login = await host.fetch(`/auth/login?provider=test-id&returnTo=${encodeURIComponent(returnTo)}`);
      expect(login.status).toBe(302);
      const callback = fake.authorize(login.headers.get("location")!, claims, tamper);
      return host.fetch(callback);
    }
    const pat: FakeClaims = { sub: "pat-1", email: "Pat@Example.com", email_verified: true, name: "Pat Lee" };

    it("lists the sign-in options", async () => {
      const res = await host.fetch("/auth/providers");
      expect(await res.json()).toEqual({ providers: [{ id: "test-id", label: "Test ID" }] });
    });

    it("signs in with PKCE, creates the person and a private workspace, and returns to the page", async () => {
      const login = await host.fetch(`/auth/login?provider=test-id&returnTo=%2Fplans%2F42`);
      const to = new URL(login.headers.get("location")!);
      expect(to.origin).toBe(fake.issuer);
      expect(to.searchParams.get("redirect_uri")).toBe(`${PUBLIC_URL}/auth/callback`);
      expect(to.searchParams.get("code_challenge_method")).toBe("S256");
      expect(to.searchParams.get("scope")).toBe("openid email profile");
      const res = await host.fetch(fake.authorize(to.toString(), pat));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/plans/42");
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/Secure/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      const me = (await (await host.fetch("/api/me", {}, undefined, cookieFrom(res)!)).json()) as { user: { name: string; email: string }; workspaces: unknown[] };
      expect(me.user).toMatchObject({ name: "Pat Lee", email: "pat@example.com" });
      expect(me.workspaces).toHaveLength(1);
    });

    it("signing in again keeps the same person, even after an email change at the provider", async () => {
      const a = (await (await host.fetch("/api/me", {}, undefined, cookieFrom(await signIn(pat))!)).json()) as { user: { id: string } };
      const b = (await (await host.fetch("/api/me", {}, undefined, cookieFrom(await signIn({ ...pat, email: "lee@example.com" }))!)).json()) as { user: { id: string }; workspaces: unknown[] };
      expect(b.user.id).toBe(a.user.id);
      expect(b.workspaces).toHaveLength(1);
    });

    it("refuses tampered, replayed or incomplete sign-ins", async () => {
      const kai: FakeClaims = { sub: "kai-1", email: "kai@example.com", email_verified: true };
      for (const tamper of [{ nonce: "other" }, { audience: "someone-else" }, { issuer: "https://evil.test" }, { expiresIn: -600 }, { foreignKey: true }] as Tamper[]) {
        const res = await signIn(kai, tamper);
        expect(res.status, JSON.stringify(tamper)).toBe(400);
        expect(cookieFrom(res)).toBeNull();
      }
      // The same callback twice: the second is refused (one-time state).
      const login = await host.fetch(`/auth/login?provider=test-id`);
      const cb = fake.authorize(login.headers.get("location")!, kai);
      expect((await host.fetch(cb)).status).toBe(302);
      expect((await host.fetch(cb)).status).toBe(400);
      // A made-up state, a missing code, an unknown provider.
      expect((await host.fetch(`/auth/callback?code=x&state=made-up`)).status).toBe(400);
      expect((await host.fetch(`/auth/callback?state=x`)).status).toBe(400);
      expect((await host.fetch(`/auth/login?provider=nope`)).status).toBe(400);
    });

    it("needs a verified email on the allow list", async () => {
      expect((await signIn({ sub: "u2", email: "kai@example.com", email_verified: false })).status).toBe(400);
      expect((await signIn({ sub: "u3", email_verified: true })).status).toBe(400);
      const eve = await signIn({ sub: "eve-1", email: "eve@example.com", email_verified: true });
      expect(eve.status).toBe(400);
      expect(await eve.json()).toEqual({ error: "This account isn't allowed to sign in here." });
    });

    it("only returns to pages on this site", async () => {
      for (const bad of ["https://evil.test/x", "//evil.test", "/\\evil.test", "javascript:alert(1)"]) {
        const res = await signIn(pat, {}, bad);
        expect(res.headers.get("location"), bad).toBe("/");
      }
    });

    it("ends sessions on sign-out, and everywhere at once", async () => {
      const one = cookieFrom(await signIn(pat))!;
      const two = cookieFrom(await signIn(pat))!;
      const out = await host.fetch("/auth/logout", { method: "POST", headers: { origin: PUBLIC_URL } }, undefined, one);
      expect(out.status).toBe(200);
      expect((await host.fetch("/api/me", {}, undefined, one)).status).toBe(401);
      expect((await host.fetch("/api/me", {}, undefined, two)).status).toBe(200);
      const three = cookieFrom(await signIn(pat))!;
      const all = await host.fetch("/api/logout-everywhere", { method: "POST", headers: { origin: PUBLIC_URL } }, undefined, two);
      expect(all.status).toBe(200);
      expect((await host.fetch("/api/me", {}, undefined, two)).status).toBe(401);
      expect((await host.fetch("/api/me", {}, undefined, three)).status).toBe(401);
    });

    it("refuses changes sent from other sites", async () => {
      const cookie = cookieFrom(await signIn(pat))!;
      const evil = await host.fetch("/api/plans", { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" }, body: JSON.stringify({ text: "- [ ] T1: x" }) }, undefined, cookie);
      expect(evil.status).toBe(403);
      const form = await host.fetch("/api/plans", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }, undefined, cookie);
      expect(form.status).toBe(403);
      const ours = await host.fetch("/api/plans", { method: "POST", headers: { origin: PUBLIC_URL, "content-type": "application/json" }, body: JSON.stringify({ text: "---\nezplan: 1\ntitle: Mine\n---\n## P1: A\n- [ ] T1: B (1d)" }) }, undefined, cookie);
      expect(ours.status).toBe(201);
    });

    it("rejects garbage session cookies", async () => {
      expect((await host.fetch("/api/me", {}, undefined, "session=not-a-real-token")).status).toBe(401);
      expect((await host.fetch("/api/me", {}, undefined, `session=${"x".repeat(5000)}`)).status).toBe(401);
    });
  });
}
