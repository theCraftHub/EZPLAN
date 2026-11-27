/** Step M1: archiving and restoring plans; archived plans are read-only; portfolio numbers on Home. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostFactory, TestHost } from "./contract";

const ANN = "u-ann|Ann Maker|ann@port.test";
const BO = "u-bo|Bo Viewer|bo@port.test";
const PLAN = (title: string, done: boolean) => `---\nrakuplan: 1\ntitle: ${title}\nstart: 2027-01-04\n---\n## P1: Work\n- [${done ? "x" : " "}] T1: Build (2d)${done ? " done: 2027-01-05 by Ann" : ""}\n- [${done ? "x" : " "}] T2: Paint (1d) due: 2027-01-08${done ? " done: 2027-01-07 by Ann" : ""}`;

export function portfolioContract(hostName: string, factory: HostFactory) {
  describe(`Portfolio and archiving: ${hostName}`, () => {
    let host: TestHost;
    let live = "", finished = "";
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      live = (await req("POST", "/api/plans", { text: PLAN("Shed", false) }, ANN)).body.id;
      finished = (await req("POST", "/api/plans", { text: PLAN("Fence", true) }, ANN)).body.id;
      const link = (await req("POST", `/api/plans/${live}/invites`, { email: "bo@port.test", role: "editor" }, ANN)).body.link;
      await req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, BO);
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("Home lists each plan with its Plan Check score; finished plans get days taken and on-time tasks", async () => {
      const plans = (await req("GET", "/api/plans", undefined, ANN)).body.plans as { id: string; archivedAt: number | null; canArchive: boolean; summary: Record<string, unknown> }[];
      const f = plans.find((p) => p.id === finished)!;
      expect(f.summary).toMatchObject({ health: "Complete", finishedOn: "2027-01-07", tookDays: 4, onTimePercent: 100 });
      expect(typeof f.summary.checkScore).toBe("number");
      expect(plans.find((p) => p.id === live)).toMatchObject({ archivedAt: null, canArchive: true });
      expect(((await req("GET", "/api/plans", undefined, BO)).body.plans as { canArchive: boolean }[])[0]!.canArchive).toBe(false);
    });

    it("only the maker or a workspace manager archives; archived plans are read-only until restored", async () => {
      expect((await req("PUT", `/api/plans/${live}/state`, { state: "archived" }, BO)).status).toBe(403);
      expect((await req("PUT", `/api/plans/${live}/state`, { state: "gone" }, ANN)).status).toBe(400);
      expect((await req("PUT", `/api/plans/${live}/state`, { state: "archived" }, ANN)).body).toEqual({ state: "archived" });
      const seen = (await req("GET", `/api/plans/${live}`, undefined, BO)).body;
      expect(seen).toMatchObject({ state: "archived", role: "viewer", canArchive: false });
      expect((await req("PUT", `/api/plans/${live}/people/Bo`, { hoursPerWeek: 20 }, ANN)).status).toBe(403);
      expect((await req("POST", `/api/plans/${live}/invites`, { email: "x@port.test", role: "viewer" }, ANN)).status).toBe(403);
      expect((await req("POST", `/api/plans/${live}/ai/check`, {}, ANN)).status).not.toBe(200);
      expect(((await req("GET", "/api/plans", undefined, ANN)).body.plans as { id: string; archivedAt: number | null }[]).find((p) => p.id === live)!.archivedAt).toBeGreaterThan(0);
      expect((await req("PUT", `/api/plans/${live}/state`, { state: "active" }, ANN)).status).toBe(200);
      expect((await req("GET", `/api/plans/${live}`, undefined, BO)).body).toMatchObject({ state: "active", role: "editor" });
      expect((await req("GET", `/api/plans/${live}/activity`, undefined, ANN)).body.items.map((i: { summary: string }) => i.summary).slice(0, 2)).toEqual(["Ann Maker restored the plan", "Ann Maker archived the plan"]);
    });
  });
}
