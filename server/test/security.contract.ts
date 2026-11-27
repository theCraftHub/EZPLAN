/**
 * Security regressions (step S1), run on both hosts: hostile text is stored as text; other sites
 * can't make changes; private answers aren't cached; oversized requests, request floods and email
 * header tricks are refused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const MAL = "u-mal|Mal <script>alert(1)</script>|mal@evil.test";
const NIA = "u-nia|Nia|nia@good.test";
const XSS = `<img src=x onerror="alert(1)"><script>alert(2)</script>'); DROP TABLE plans;--`;

export function securityContract(hostName: string, factory: HostFactory) {
  describe(`Security: ${hostName}`, () => {
    let host: TestHost;
    const req = async (method: string, path: string, body: unknown, user: string, headers: Record<string, string> = {}) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }, user);
      return { status: r.status, headers: r.headers, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };

    beforeAll(async () => { host = await factory.start({ testAuth: true }); }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("hostile text: plan imports drop HTML tags, everything else is stored and returned as plain text", async () => {
      const text = `---\nrakuplan: 1\ntitle: ${XSS}\n---\n## P1: Work\n- [ ] T1: ${XSS} (1d)`;
      const made = await req("POST", "/api/plans", { text }, MAL);
      expect(made.status).toBe(201);
      const got = (await req("GET", `/api/plans/${made.body.id}`, undefined, MAL)).body;
      // Imported plan text loses its HTML tags; the rest is kept exactly, as text.
      for (const t of [got.plan.title, got.plan.phases[0].tasks[0].title]) {
        expect(t).not.toMatch(/[<>]/);
        expect(t).toContain("'); DROP TABLE plans;--");
      }
      expect((await req("GET", "/api/plans", undefined, MAL)).body.plans.length).toBe(1); // the table is fine
      const org = await req("POST", "/api/orgs", { name: XSS, people: 2 }, MAL);
      expect((await req("GET", `/api/orgs/${org.body.id}`, undefined, MAL)).body.name).toBe(XSS.slice(0, 120));
    });

    it("changes from another site are refused; private answers are never cached or sniffed", async () => {
      expect((await req("POST", "/api/orgs", { name: "X", people: 1 }, NIA, { origin: "https://evil.test" })).status).toBe(403);
      // A plain form on another site can't send JSON, and without an Origin only JSON is accepted.
      expect((await req("POST", "/api/orgs", "name=X&people=1", NIA, { "content-type": "application/x-www-form-urlencoded" })).status).toBe(403);
      const me = await req("GET", "/api/me", undefined, NIA);
      expect(me.headers.get("cache-control")).toBe("no-store");
      expect(me.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("refuses requests over 5 MB before reading them", async () => {
      const r = await req("POST", "/api/plans", { text: "x".repeat(6 * 1024 * 1024) }, NIA);
      expect(r.status).toBe(413);
    });

    it("rate limits: a flood of domain checks is stopped for that person only; sign-in floods per address", async () => {
      const org = (await req("POST", "/api/orgs", { name: "Flood Co", people: 2 }, NIA)).body.id;
      const statuses: number[] = [];
      for (let i = 0; i < 31; i++) statuses.push((await req("POST", `/api/orgs/${org}/domains`, { domain: `d${i}.good.test` }, NIA)).status);
      expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
      const last = await req("POST", `/api/orgs/${org}/domains`, { domain: "more.good.test" }, NIA);
      expect(last.status).toBe(429);
      expect(last.body.error).toBe("Too many tries. Wait a minute, then try again.");
      expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
      expect((await req("GET", `/api/orgs/${org}`, undefined, NIA)).status).toBe(200); // reading still works
      const other = (await req("POST", "/api/orgs", { name: "Calm Co", people: 2 }, MAL)).body.id;
      expect((await req("POST", `/api/orgs/${other}/domains`, { domain: "calm.evil.test" }, MAL)).status).toBe(201);
      let signIn = 0;
      for (let i = 0; i < 61; i++) signIn = (await host.fetch("/auth/login?provider=none")).status;
      expect(signIn).toBe(429);
    });

    it("line breaks in names can't add email headers", async () => {
      const org = (await req("POST", "/api/orgs", { name: "Evil\r\nBcc: everyone@victim.test", people: 3 }, NIA)).body.id;
      await req("POST", `/api/orgs/${org}/invites`, { people: [{ email: "ann@good.test" }] }, NIA);
      const [row] = await host.sql!(`SELECT subject FROM email_outbox WHERE to_addr = 'ann@good.test'`);
      expect(String(row!.subject)).not.toMatch(/[\r\n]/);
      expect(String(row!.subject)).toContain("Evil Bcc: everyone@victim.test");
    });

    it("the audit chain is keyed: rewriting a row and recomputing a plain hash is still caught", async () => {
      const org = (await req("POST", "/api/orgs", { name: "Chain Co", people: 2 }, NIA)).body.id;
      const [r] = await host.sql!(`SELECT * FROM audit_log WHERE org_id = ? AND seq = 1`, [org]);
      const plain = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([r!.org_id, 1, Number(r!.at), r!.actor_id, r!.actor_name, r!.action, "Someone else", r!.detail, r!.prev_hash]))))).map((b) => b.toString(16).padStart(2, "0")).join("");
      await host.sql!(`UPDATE audit_log SET target = 'Someone else', hash = ? WHERE org_id = ? AND seq = 1`, [plain, org]);
      expect((await req("GET", `/api/orgs/${org}/audit`, undefined, NIA)).body).toMatchObject({ intact: false, brokenAt: 1 });
    });
  });
}
