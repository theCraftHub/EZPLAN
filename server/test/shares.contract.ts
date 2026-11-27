/** Step N1: read-only share links: anyone with the link sees the plan (no emails), until it expires or is turned off. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const SUE = "u-sue|Sue|sue@share.test";
const VAL = "u-val|Val|val@share.test";
const OPAL = "u-opal|Opal Owner|opal@co.test";
const MEMB = "u-memb|Mem Ber|memb@co.test";
const PLAN = `---\nrakuplan: 1\ntitle: Garden\nstart: 2027-01-04\nteam: Sue <sue@share.test>, Val\n---\n## P1: Beds\n- [ ] T1: Dig (2d) @Sue`;

export function sharesContract(hostName: string, factory: HostFactory) {
  describe(`Share links: ${hostName}`, () => {
    let host: TestHost;
    let id = "";
    const req = async (method: string, path: string, body?: unknown, user?: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, headers: r.headers, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const open = (url: string, q = "") => req("GET", `/api/share/${url.split("/s/")[1]}${q}`);
    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      id = (await req("POST", "/api/plans", { text: PLAN }, SUE)).body.id;
      const link = (await req("POST", `/api/plans/${id}/invites`, { email: "val@share.test", role: "viewer" }, SUE)).body.link;
      await req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, VAL);
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("anyone with the link sees the plan without signing in, with no email addresses; counted opens", async () => {
      const made = await req("POST", `/api/plans/${id}/shares`, { days: 30 }, SUE);
      expect(made.status).toBe(201);
      expect(made.body.url).toMatch(/\/s\/[A-Za-z0-9_-]{30,}$/);
      const seen = await open(made.body.url);
      expect(seen.status).toBe(200);
      expect(seen.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(seen.headers.get("cache-control")).toBe("no-store");
      expect(seen.body.plan.title).toBe("Garden");
      expect(JSON.stringify(seen.body)).not.toContain("sue@share.test");
      expect((await open(made.body.url, `?since=${seen.body.version}`)).body).toEqual({ version: seen.body.version, unchanged: true });
      const list = (await req("GET", `/api/plans/${id}/shares`, undefined, SUE)).body;
      expect(list.links[0]).toMatchObject({ by: "Sue", opens: 1 });
      expect(list.links[0].expiresAt - list.links[0].createdAt).toBe(30 * 86_400_000);
    });

    it("viewers can't share; turned-off, expired and archived links stop working; wrong tokens look the same", async () => {
      expect((await req("POST", `/api/plans/${id}/shares`, {}, VAL)).status).toBe(403);
      expect((await req("POST", `/api/plans/${id}/shares`, { days: 5 }, SUE)).status).toBe(400);
      const a = (await req("POST", `/api/plans/${id}/shares`, {}, SUE)).body;
      expect(a.expiresAt).toBeNull();
      expect((await req("DELETE", `/api/plans/${id}/shares/${a.id}`, undefined, SUE)).status).toBe(200);
      const off = await open(a.url);
      expect(off.status).toBe(404);
      expect((await open("x/s/not-a-real-token")).body).toEqual(off.body);
      const b = (await req("POST", `/api/plans/${id}/shares`, { days: 7 }, SUE)).body;
      await host.sql!(`UPDATE share_links SET expires_at = 1 WHERE id = ?`, [b.id]);
      expect((await open(b.url)).status).toBe(404);
      const c = (await req("POST", `/api/plans/${id}/shares`, {}, SUE)).body;
      await req("PUT", `/api/plans/${id}/state`, { state: "archived" }, SUE);
      expect((await open(c.url)).status).toBe(404);
      await req("PUT", `/api/plans/${id}/state`, { state: "active" }, SUE);
      expect((await open(c.url)).status).toBe(200);
    });

    it("company plans follow the company's rules", async () => {
      const org = (await req("POST", "/api/orgs", { name: "Co", people: 3 }, OPAL)).body as { id: string; workspaceId: string };
      const inv = (await req("POST", `/api/orgs/${org.id}/invites`, { people: [{ email: "memb@co.test" }] }, OPAL)).body.invited[0].link;
      await req("POST", `/api/join/${inv.split("/join/")[1]}/accept`, {}, MEMB);
      const p = (await req("POST", "/api/plans", { workspaceId: org.workspaceId, text: PLAN }, OPAL)).body.id;
      const refused = await req("POST", `/api/plans/${p}/shares`, {}, MEMB);
      expect(refused.body.error).toBe("Co only lets managers make share links.");
      expect((await req("GET", `/api/plans/${p}/shares`, undefined, MEMB)).body).toMatchObject({ canShare: false, reason: "Co only lets managers make share links." });
      await req("PUT", `/api/orgs/${org.id}/settings`, { preset: "open" }, OPAL);
      expect((await req("POST", `/api/plans/${p}/shares`, {}, MEMB)).status).toBe(201);
      expect((await req("GET", `/api/orgs/${org.id}/audit?action=plan.shared`, undefined, OPAL)).body.items).toHaveLength(1);
    });
  });
}
