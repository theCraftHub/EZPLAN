/** Step M5: the owner's Operations page: owner-only numbers; errors kept without personal data; refusals counted. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";
import { PLATFORM_ADMIN } from "./hostConfig";

const OWNER = `u-own|Owner|${PLATFORM_ADMIN}`;
const NED = "u-ned|Ned|ned@ops.test";

export function opsContract(hostName: string, factory: HostFactory) {
  describe(`Operations page: ${hostName}`, () => {
    let host: TestHost;
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    beforeAll(async () => { host = await factory.start({ testAuth: true }); }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("is for platform admins only; numbers add up", async () => {
      expect((await req("GET", "/api/ops", undefined, NED)).status).toBe(404);
      await req("POST", "/api/plans", { text: "---\nrakuplan: 1\ntitle: A\n---\n## P1: W\n- [ ] T1: X (1d)" }, NED);
      const org = (await req("POST", "/api/orgs", { name: "Ops Co", people: 2 }, NED)).body.id;
      const o = (await req("GET", "/api/ops", undefined, OWNER)).body;
      expect(o.plans.active).toBeGreaterThanOrEqual(1);
      expect(o.companies.total).toBe(1);
      expect(o.companies.auditBroken).toEqual([]);
      expect(o.database).toMatchObject({ upToDate: true });
      expect(o.email.sending).toBe(false);
      await host.sql!(`UPDATE audit_log SET target = 'x' WHERE org_id = ? AND seq = 1`, [org]);
      expect((await req("GET", "/api/ops", undefined, OWNER)).body.companies.auditBroken).toEqual([{ id: org, name: "Ops Co", at: 1 }]);
    });

    it("keeps unexpected errors with the route pattern and no personal data", async () => {
      expect((await req("GET", "/api/test/fail", undefined, NED)).status).toBe(500);
      const e = (await req("GET", "/api/ops", undefined, OWNER)).body.errors;
      expect(e.last24h).toBe(1);
      expect(e.recent[0]).toMatchObject({ method: "GET", route: "/api/test/fail", name: "Error" });
      expect(e.recent[0].message).toBe("Test failure for [email] with token [token]");
      expect(e.byRoute[0]).toMatchObject({ route: "/api/test/fail", n: 1 });
    });

    it("counts rate-limit refusals by rule", async () => {
      const org = (await req("POST", "/api/orgs", { name: "Busy Co", people: 2 }, NED)).body.id;
      for (let i = 0; i < 32; i++) await req("POST", `/api/orgs/${org}/domains`, { domain: `x${i}.ops.test` }, NED);
      expect((await req("GET", "/api/ops", undefined, OWNER)).body.limits).toEqual({ refusedToday: 2, byRule: { domains: 2 } });
    });
  });
}
