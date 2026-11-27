/**
 * Admin console, People and Licenses (step L3a): the people list, bulk changes (the preview equals
 * what's applied; 24-hour undo), role limits, seats, one person's details, sign out everywhere,
 * extra workspaces, and seats unused for 60 days.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const OLA = "u-ola|Ola Owner|ola@pine.test";
const ANA = "u-ana|Ana Lima|ana@pine.test"; // Member
const BEN = "u-ben|Ben Dept|ben@pine.test"; // Department admin
const CY = "u-cy|Cy Help|cy@pine.test"; // Helpdesk
const EVE = "u-eve3|Eve|eve3@example.com"; // outsider
const PLAN = "---\nrakuplan: 1\ntitle: Pine yard\n---\n## P1: Work\n- [ ] T1: Clear (1d)";

export function consoleContract(hostName: string, factory: HostFactory) {
  describe(`Admin console people and licenses: ${hostName}`, () => {
    let host: TestHost;
    let org = "", ws = "", yard = "", plan = "";
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const bulk = (body: Record<string, unknown>, user = OLA) => req("POST", `/api/orgs/${org}/people/bulk`, body, user);
    const people = async (user = OLA) => (await req("GET", `/api/orgs/${org}/people`, undefined, user)).body.people as { id: string; name: string; role: string; status: string; department: string | null; workspaces: string[]; seat: boolean }[];
    const find = async (name: string) => (await people()).find((p) => p.name === name)!;

    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      ({ id: org, workspaceId: ws } = (await req("POST", "/api/orgs", { name: "Pine Co", people: 5 }, OLA)).body as { id: string; workspaceId: string });
      const sent = (await req("POST", `/api/orgs/${org}/invites`, { people: [
        { email: "ana@pine.test", name: "Ana Lima", department: "Yard" },
        { email: "ben@pine.test", name: "Ben Dept", role: "dept_admin" },
        { email: "cy@pine.test", name: "Cy Help", role: "helpdesk" },
        { email: "dan@pine.test", name: "Dan Later" },
      ] }, OLA)).body.invited as { email: string; link: string }[];
      for (const [who, email] of [[ANA, "ana@pine.test"], [BEN, "ben@pine.test"], [CY, "cy@pine.test"]] as const) {
        await req("POST", `/api/join/${sent.find((s) => s.email === email)!.link.split("/join/")[1]}/accept`, {}, who);
      }
      plan = (await req("POST", "/api/plans", { workspaceId: ws, text: PLAN }, OLA)).body.id;
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("lists people and open invites with status and seats; /api/me lists my companies; outsiders get 404", async () => {
      const list = await people();
      expect(list.map((p) => [p.name, p.role, p.status, p.seat])).toEqual([
        ["Ana Lima", "member", "active", true], ["Ben Dept", "dept_admin", "active", true], ["Cy Help", "helpdesk", "active", true], ["Ola Owner", "owner", "active", true],
        ["Dan Later", "member", "invited", true],
      ]);
      expect((await req("GET", "/api/me", undefined, ANA)).body.orgs).toEqual([{ id: org, name: "Pine Co", role: "member", console: false }]);
      expect((await req("GET", `/api/orgs/${org}/people`, undefined, ANA)).status).toBe(404);
      expect((await req("GET", `/api/orgs/${org}/people`, undefined, EVE)).status).toBe(404);
      const o = (await req("GET", `/api/orgs/${org}`, undefined, OLA)).body;
      expect(o.stats).toMatchObject({ active: 4, invited: 1, admins: 1, reclaimable: 0 });
      expect(o.stats.departments).toContainEqual({ name: "Yard", people: 1 });
    });

    it("bulk: the preview changes nothing and equals what's applied; undo puts everyone back", async () => {
      const ids = [(await find("Ana Lima")).id, (await find("Dan Later")).id, (await find("Ola Owner")).id];
      const dry = await bulk({ action: "department", value: "Field Ops", ids, dryRun: true });
      expect(dry.body.changes.map((c: { name: string; from: string; to: string }) => [c.name, c.from, c.to])).toEqual([["Ana Lima", "Yard", "Field Ops"], ["Dan Later", "No department", "Field Ops"], ["Ola Owner", "No department", "Field Ops"]]);
      expect((await find("Ana Lima")).department).toBe("Yard");
      const applied = await bulk({ action: "department", value: "Field Ops", ids });
      expect(applied.body.changes).toEqual(dry.body.changes);
      expect((await people()).filter((p) => p.department === "Field Ops")).toHaveLength(3);
      expect((await req("POST", `/api/orgs/${org}/undo/${applied.body.undoId}`, {}, OLA)).body).toEqual({ ok: true, restored: 3 });
      expect((await find("Ana Lima")).department).toBe("Yard");
      expect((await find("Dan Later")).department).toBeNull();
      expect((await req("POST", `/api/orgs/${org}/undo/${applied.body.undoId}`, {}, OLA)).status).toBe(409); // once
      const old = await bulk({ action: "department", value: "X", ids: [ids[0]] });
      await host.sql!(`UPDATE undo_batches SET created_at = created_at - ? WHERE id = ?`, [25 * 3_600_000, old.body.undoId]);
      expect((await req("POST", `/api/orgs/${org}/undo/${old.body.undoId}`, {}, OLA)).body.error).toMatch(/24 hours/);
      await bulk({ action: "department", value: "Yard", ids: [ids[0]] });
    });

    it("role limits: Helpdesk resends but changes nothing else; a Department admin only reaches their members; nobody demotes themself or the last Owner", async () => {
      const ana = (await find("Ana Lima")).id, cy = (await find("Cy Help")).id, ola = (await find("Ola Owner")).id, dan = (await find("Dan Later")).id;
      expect((await bulk({ action: "role", value: "admin", ids: [ana] }, CY)).status).toBe(403);
      const resent = await bulk({ action: "resend", ids: [dan, ana] }, CY);
      expect(resent.body.changes.map((c: { name: string }) => c.name)).toEqual(["Dan Later"]);
      expect(resent.body.skipped).toEqual([expect.objectContaining({ name: "Ana Lima", reason: "Already joined." })]);
      expect(resent.body.links[0].link).toMatch(/\/join\//);
      expect(resent.body.undoId).toBeNull();
      const ben = await bulk({ action: "department", value: "North", ids: [ana, cy], dryRun: true }, BEN);
      expect(ben.body.changes.map((c: { name: string }) => c.name)).toEqual(["Ana Lima"]);
      expect(ben.body.skipped[0]).toMatchObject({ name: "Cy Help", reason: "Outside your department's workspaces." });
      expect((await bulk({ action: "role", value: "admin", ids: [ana], dryRun: true }, BEN)).body.skipped[0].reason).toBe("You can't make someone Admin.");
      expect((await bulk({ action: "deactivate", ids: [ola], dryRun: true })).body.skipped[0].reason).toMatch(/That's you/);
      expect((await bulk({ action: "deactivate", ids: [ola], dryRun: true }, BEN)).body.skipped[0].reason).toBe("Only an Owner can change an Owner.");
    });

    it("deactivate: access to company plans ends, the seat is freed, they're told; undo needs a free seat", async () => {
      const ana = (await find("Ana Lima")).id;
      expect((await req("GET", `/api/plans/${plan}`, undefined, ANA)).status).toBe(200);
      const off = await bulk({ action: "deactivate", ids: [ana] });
      expect(off.body.changes[0]).toMatchObject({ from: "Active", to: "Deactivated" });
      expect((await req("GET", `/api/plans/${plan}`, undefined, ANA)).status).toBe(404);
      expect((await req("GET", "/api/notifications", undefined, ANA)).body.items[0].text).toBe("Your access to Pine Co's plans has ended");
      expect((await req("GET", `/api/orgs/${org}`, undefined, OLA)).body.seats).toEqual({ total: 5, taken: 4 });
      // Someone takes the freed seat, so putting Ana back doesn't fit.
      await req("POST", `/api/orgs/${org}/invites`, { people: [{ email: "fay@pine.test" }] }, OLA);
      expect((await req("POST", `/api/orgs/${org}/undo/${off.body.undoId}`, {}, OLA)).body.error).toMatch(/needs 1 more seat/);
      await req("PUT", `/api/orgs/${org}/seats`, { seats: 6 }, OLA);
      expect((await req("POST", `/api/orgs/${org}/undo/${off.body.undoId}`, {}, OLA)).status).toBe(200);
      expect((await req("GET", `/api/plans/${plan}`, undefined, ANA)).status).toBe(200);
    });

    it("workspaces: add one; moving someone changes which plans they reach", async () => {
      expect((await req("POST", `/api/orgs/${org}/workspaces`, { name: "Yard crew" }, CY)).status).toBe(403);
      yard = (await req("POST", `/api/orgs/${org}/workspaces`, { name: "Yard crew" }, OLA)).body.id;
      expect((await req("POST", `/api/orgs/${org}/workspaces`, { name: "yard CREW" }, OLA)).status).toBe(409);
      const ana = (await find("Ana Lima")).id;
      const moved = await bulk({ action: "workspace", value: yard, ids: [ana] });
      expect(moved.body.changes[0]).toMatchObject({ from: "Pine Co", to: "Yard crew" });
      expect((await req("GET", `/api/plans/${plan}`, undefined, ANA)).status).toBe(404);
      const rows = await host.sql!(`SELECT workspace_id, role FROM members WHERE user_id = 'u-ana' AND workspace_id IN (?, ?)`, [ws, yard]);
      expect(rows).toEqual([{ workspace_id: yard, role: "editor" }]);
      expect(await host.sql!(`SELECT role FROM members WHERE user_id = 'u-ola' AND workspace_id = ?`, [yard])).toEqual([{ role: "manager" }]);
      await req("POST", `/api/orgs/${org}/undo/${moved.body.undoId}`, {}, OLA);
    });

    it("one person: details, plans they made, recent activity; Helpdesk signs someone out everywhere", async () => {
      const ola = (await find("Ola Owner")).id, ana = (await find("Ana Lima")).id;
      const me = (await req("GET", `/api/orgs/${org}/people/${ola}`, undefined, OLA)).body;
      expect(me.plans).toEqual([{ id: plan, title: "Pine yard" }]);
      expect(me.activity[0]).toHaveProperty("action");
      const out = await req("POST", `/api/orgs/${org}/people/${ana}/signout`, {}, CY);
      expect(out.status).toBe(200);
      expect((await req("POST", `/api/orgs/${org}/people/${ola}/signout`, {}, CY)).status).toBe(403);
      const log = (await req("GET", `/api/orgs/${org}/audit?action=person.signed_out`, undefined, OLA)).body.items;
      expect(log[0]).toMatchObject({ actor: "Cy Help", target: "ana@pine.test" });
    });

    it("licenses: people idle for 60 days are listed; freeing their seats is a bulk deactivate with undo", async () => {
      await host.sql!(`UPDATE org_members SET last_active_at = 1, joined_at = 1 WHERE user_id = 'u-ana'`);
      const r = (await req("GET", `/api/orgs/${org}/people`, undefined, OLA)).body;
      expect(r.reclaimable).toEqual([(await find("Ana Lima")).id]);
      expect((await req("GET", `/api/orgs/${org}`, undefined, OLA)).body.stats.reclaimable).toBe(1);
      // Using the app again counts as active.
      await req("GET", "/api/me", undefined, ANA);
      expect((await req("GET", `/api/orgs/${org}/people`, undefined, OLA)).body.reclaimable).toEqual([]);
    });
  });
}
