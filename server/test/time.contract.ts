/** Step N4: time logging. Editors log their own time; managers for anyone; viewers read; CSV is formula-safe. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const MAY = "u-may|May Fox|may@time.test"; // maker, manager
const JO = "u-jo2|Jo Wells|jo@time.test"; // editor
const VIC = "u-vic|Vic|vic@time.test"; // viewer
const PLAN = `---\nrakuplan: 1\ntitle: Shop fit\ncurrency: EUR\n---\n## P1: Work\n- [ ] T1: Shelving (2d) @Jo cost: 900\n- [ ] T2: Signs (1d) @May`;

export function timeContract(hostName: string, factory: HostFactory) {
  describe(`Time logging: ${hostName}`, () => {
    let host: TestHost;
    let id = "";
    const req = async (method: string, path: string, body?: unknown, user = MAY) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      const text = await r.text();
      let json: Record<string, any> = {};
      try { json = JSON.parse(text); } catch { /* csv */ }
      return { status: r.status, text, body: json };
    };
    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      id = (await req("POST", "/api/plans", { text: PLAN })).body.id;
      for (const [who, email, role] of [[JO, "jo@time.test", "editor"], [VIC, "vic@time.test", "viewer"]] as const) {
        const link = (await req("POST", `/api/plans/${id}/invites`, { email, role })).body.link;
        await req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, who);
      }
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("editors log their own time under the name the plan uses; checks hours, days and tasks", async () => {
      expect((await req("POST", `/api/plans/${id}/time`, { taskId: "T1", date: "2027-01-04", hours: 3.5, note: "=HYPERLINK(\"x\")" }, JO)).status).toBe(201);
      expect((await req("POST", `/api/plans/${id}/time`, { taskId: "T9", date: "2027-01-04", hours: 1 }, JO)).status).toBe(400);
      expect((await req("POST", `/api/plans/${id}/time`, { taskId: "T1", date: "2027-01-04", hours: 0.1 }, JO)).status).toBe(400);
      expect((await req("POST", `/api/plans/${id}/time`, { taskId: "T1", date: "2099-01-01", hours: 1 }, JO)).body.error).toBe("Choose a day up to today.");
      expect((await req("POST", `/api/plans/${id}/time`, { taskId: "T1", date: "2027-01-04", hours: 1, person: "May" }, JO)).status).toBe(403);
      expect((await req("POST", `/api/plans/${id}/time`, { taskId: "T1", date: "2027-01-04", hours: 1 }, VIC)).status).toBe(403);
      const list = (await req("GET", `/api/plans/${id}/time`, undefined, VIC)).body;
      expect(list).toMatchObject({ canLog: false, entries: [{ taskId: "T1", person: "Jo", minutes: 210, mine: false }] });
    });

    it("managers log for others and remove any entry; people remove their own", async () => {
      const made = await req("POST", `/api/plans/${id}/time`, { taskId: "T2", date: "2027-01-04", hours: 2, person: "Ana" });
      expect(made.status).toBe(201);
      const entries = (await req("GET", `/api/plans/${id}/time`)).body.entries as { id: string; person: string }[];
      expect(entries.map((e) => e.person).sort()).toEqual(["Ana", "Jo"]);
      const jos = entries.find((e) => e.person === "Jo")!;
      expect((await req("DELETE", `/api/plans/${id}/time/${made.body.id}`, undefined, JO)).status).toBe(403);
      expect((await req("DELETE", `/api/plans/${id}/time/${jos.id}`, undefined, JO)).status).toBe(200);
      expect((await req("GET", `/api/plans/${id}/activity`)).body.items.some((i: { summary: string }) => i.summary === "May Fox logged 2 h on Signs for Ana")).toBe(true);
    });

    it("CSV export neutralizes formulas; hourly rates are part of availability", async () => {
      await req("POST", `/api/plans/${id}/time`, { taskId: "T1", date: "2027-01-04", hours: 1, note: "=SUM(A1)" }, JO);
      const csv = await req("GET", `/api/plans/${id}/time.csv`);
      expect(csv.text.split("\r\n")[0]).toBe("Date,Person,Task ID,Task,Hours,Note");
      expect(csv.text).toContain(`"'=SUM(A1)"`);
      expect((await req("PUT", `/api/plans/${id}/people/Jo`, { rate: 55 })).status).toBe(200);
      expect((await req("GET", `/api/plans/${id}`)).body.people.Jo).toMatchObject({ rate: 55 });
    });
  });
}
