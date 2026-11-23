/**
 * The API and live-room contract, written once. Each host (self-hosted Node, cloud Workers)
 * runs it against its own connectors, so both behave identically. Plan section 7b.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { levelPlan, parsePlan, type PersonAvailability, type Plan } from "@ezplan/shared";

export const TODAY = "2027-01-04";

export interface TestHost {
  /** Sends a request (redirects not followed) as test `user` ("id|Name|email"), with a cookie, or anonymously. */
  fetch(path: string, init?: RequestInit, user?: string, cookie?: string): Promise<Response>;
  /** Stops and starts the host on the same stored data (a restart or redeploy). */
  restart(): Promise<void>;
  stop(): Promise<void>;
  /** Opens a live connection (WebSocket), or returns the refusal status. */
  live?: import("./live.contract").LiveOpen;
}

export interface HostFactory {
  /** `fake`: the stand-in sign-in provider to configure (sign-in tests). */
  start(opts: { testAuth: boolean; fake?: import("./fakeOidc").FakeOidc; testAi?: boolean }): Promise<TestHost>;
}

const ALEX = "u-alex|Alex|alex@example.com";
const SAM = "u-sam|Sam|sam@example.com";
const kitchenText = readFileSync(join(import.meta.dirname, "..", "..", "shared", "test", "fixtures", "assistants", "copilot-renovation-v2.txt"), "utf8");

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function apiContract(hostName: string, factory: HostFactory) {
  describe(`API contract: ${hostName}`, () => {
    let host: TestHost;
    let planId = "";

    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
    }, 60_000);
    afterAll(async () => {
      await host?.stop();
    });

    it("answers health checks and refuses anonymous requests", async () => {
      expect((await host.fetch("/api/health")).status).toBe(200);
      const me = await host.fetch("/api/me");
      expect(me.status).toBe(401);
      expect(await me.json()).toEqual({ error: "Sign in to continue." });
    });

    it("gives a new person a private workspace with the standard work week", async () => {
      const res = await host.fetch("/api/me", {}, ALEX);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: { name: string }; workspaces: { role: string; work_week: { hoursPerWeek: number } }[] };
      expect(body.user.name).toBe("Alex");
      expect(body.workspaces).toHaveLength(1);
      expect(body.workspaces[0]!.role).toBe("manager");
      expect(body.workspaces[0]!.work_week.hoursPerWeek).toBe(40);
    });

    it("imports a plan and schedules it exactly like the engine", async () => {
      const res = await host.fetch("/api/plans", json({ text: kitchenText }), ALEX);
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: string; state: string };
      planId = created.id;
      expect(created.state).toBe("active");

      const list = (await (await host.fetch("/api/plans", {}, ALEX)).json()) as { plans: { id: string; title: string; summary: { finish: string; percent: number; countedTasks: number; health: string } }[] };
      const mine = list.plans.find((p) => p.id === planId)!;
      const direct = levelPlan(parsePlan(kitchenText).plan, { today: TODAY, workWeek: { hoursPerWeek: 40, workdays: [1, 2, 3, 4, 5] } });
      // Home's summary comes from the same engine as the plan page.
      expect(mine.summary.finish).toBe(direct.finish);
      expect(mine.summary.countedTasks).toBeGreaterThan(0);
      expect(["On track", "At risk", "Off track", "Complete"]).toContain(mine.summary.health);

      const got = (await (await host.fetch(`/api/plans/${planId}`, {}, ALEX)).json()) as { schedule: { finish: string }; plan: { title: string }; check: { score: number } };
      expect(got.plan.title).toBe("Kitchen Remodel by Spring 2027");
      expect((got as unknown as { today: string }).today).toBe(TODAY);
      expect(got.schedule.finish).toBe(direct.finish);
      expect(got.check.score).toBeGreaterThan(0);
    });

    it("refuses plans that break the Acceptable Use Policy", async () => {
      const res = await host.fetch("/api/plans", json({ text: "---\nezplan: 1\ntitle: X\n---\n## P1: A\n- [ ] T1: Build a bomb" }), ALEX);
      expect(res.status).toBe(422);
    });

    it("applies edits in order, records who finished a task, and ignores replays", async () => {
      const edit = (opId: string, op: unknown) => host.fetch(`/api/plans/${planId}/ops`, json({ opId, clientId: "c1", op }), ALEX);
      const first = (await (await edit("op-1", { kind: "setStatus", taskId: "T1", status: "done" })).json()) as { status: string; version: number; applied: { effective: { kind: string } } };
      expect(first.status).toBe("applied");
      expect(first.version).toBe(1);
      const again = (await (await edit("op-1", { kind: "setStatus", taskId: "T1", status: "done" })).json()) as { status: string; version: number };
      expect(again).toEqual({ status: "duplicate", version: 1 });

      const plan = (await (await host.fetch(`/api/plans/${planId}`, {}, ALEX)).json()) as { version: number; plan: { phases: { tasks: { id: string; status: string; done?: { by?: string; date: string } }[] }[] } };
      const t1 = plan.plan.phases.flatMap((p) => p.tasks).find((t) => t.id === "T1")!;
      expect(t1.status).toBe("done");
      expect(t1.done).toEqual({ date: TODAY, by: "Alex" }); // from the signed-in person, never the request
    });

    it("applies many edits sent at once exactly once each, in sequence", async () => {
      const titles = Array.from({ length: 12 }, (_, i) => `Renamed ${i}`);
      const results = await Promise.all(
        titles.map((title, i) => host.fetch(`/api/plans/${planId}/ops`, json({ opId: `burst-${i}`, clientId: "c2", op: { kind: "setField", taskId: "T2", field: "title", value: title } }), ALEX).then((r) => r.json() as Promise<{ status: string; version: number }>)),
      );
      expect(results.every((r) => r.status === "applied")).toBe(true);
      expect(results.map((r) => r.version).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 2));
    });

    it("rejects malformed or unsafe edits", async () => {
      const bad = [
        { kind: "setField", taskId: "T1", field: "done", value: { date: TODAY, by: "Mallory" } }, // attribution isn't editable
        { kind: "setField", taskId: "T1", field: "due", value: "next week" },
        { kind: "setStatus", taskId: "T1", status: "finished" },
        { kind: "dropTable" },
      ];
      for (const op of bad) expect((await host.fetch(`/api/plans/${planId}/ops`, json({ opId: crypto.randomUUID(), clientId: "c1", op }), ALEX)).status).toBe(400);
    });

    it("hides other workspaces' plans as if they didn't exist", async () => {
      expect((await host.fetch(`/api/plans/${planId}`, {}, SAM)).status).toBe(404);
      expect((await host.fetch(`/api/plans/${planId}/ops`, json({ opId: "x", clientId: "c", op: { kind: "setStatus", taskId: "T1", status: "todo" } }), SAM)).status).toBe(404);
      expect((await host.fetch(`/api/plans/${planId}/export`, {}, SAM)).status).toBe(404);
      const list = (await (await host.fetch("/api/plans", {}, SAM)).json()) as { plans: unknown[] };
      expect(list.plans).toEqual([]);
    });

    it("exports a plan file that reads back to the same plan", async () => {
      const res = await host.fetch(`/api/plans/${planId}/export`, {}, ALEX);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="Kitchen Remodel by Spring 2027\./);
      const text = await res.text();
      const live = (await (await host.fetch(`/api/plans/${planId}`, {}, ALEX)).json()) as { plan: unknown };
      expect(parsePlan(text).plan).toEqual(live.plan);
    });

    it("previews a plan with typed availability without saving it, then saves the availability with the plan", async () => {
      const before = ((await (await host.fetch("/api/plans", {}, ALEX)).json()) as { plans: unknown[] }).plans.length;
      const plain = (await (await host.fetch("/api/plans/preview", json({ text: kitchenText }), ALEX)).json()) as { finish: string; people: string[]; check: { findings: { code: string }[] } };
      const people = { Priya: { hoursPerWeek: 10 }, Jordan: { hoursPerWeek: 40, timeOff: [{ start: "2027-01-11", end: "2027-01-15", label: "Vacation" }] } };
      const slower = (await (await host.fetch("/api/plans/preview", json({ text: kitchenText, people }), ALEX)).json()) as { finish: string };
      const parsed = parsePlan(kitchenText).plan;
      const week = { hoursPerWeek: 40, workdays: [1, 2, 3, 4, 5] };
      expect(plain.people.length).toBeGreaterThan(0);
      expect(plain.finish).toBe(levelPlan(parsed, { today: TODAY, workWeek: week }).finish);
      expect(slower.finish).toBe(levelPlan(parsed, { today: TODAY, workWeek: week, people }).finish);
      expect(slower.finish > plain.finish).toBe(true);
      expect(((await (await host.fetch("/api/plans", {}, ALEX)).json()) as { plans: unknown[] }).plans.length).toBe(before);

      const saved = (await (await host.fetch("/api/plans", json({ text: kitchenText, people }), ALEX)).json()) as { id: string };
      const got = (await (await host.fetch(`/api/plans/${saved.id}`, {}, ALEX)).json()) as { people: Record<string, unknown>; schedule: { finish: string } };
      expect(got.people).toEqual(people);
      expect(got.schedule.finish).toBe(slower.finish);
    });

    it("updates one person's availability, and refuses bad values, viewers' changes and other workspaces", async () => {
      const put = (name: string, body: unknown, user = ALEX) => host.fetch(`/api/plans/${planId}/people/${encodeURIComponent(name)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, user);
      const ok = await put("Priya", { hoursPerWeek: 20.5, workdays: [1, 2, 3] });
      expect(ok.status).toBe(200);
      expect(((await (await host.fetch(`/api/plans/${planId}`, {}, ALEX)).json()) as { people: Record<string, unknown> }).people).toEqual({ Priya: { hoursPerWeek: 20.5, workdays: [1, 2, 3] } });
      await put("priya", { hoursPerWeek: 30 }); // same person, any capitalization
      expect(((await (await host.fetch(`/api/plans/${planId}`, {}, ALEX)).json()) as { people: Record<string, unknown> }).people).toEqual({ priya: { hoursPerWeek: 30 } });
      expect((await put("Priya", { hoursPerWeek: 0 })).status).toBe(400);
      expect((await put("Priya", { hoursPerWeek: 61 })).status).toBe(400);
      expect((await put("Priya", { timeOff: [{ start: "2027-02-10", end: "2027-02-01" }] })).status).toBe(400);
      expect((await put("Priya", { hoursPerWeek: 10, password: "x" })).status).toBe(400);
      expect((await put("Priya", { hoursPerWeek: 10 }, SAM)).status).toBe(404);
      expect((await host.fetch("/api/plans", json({ text: kitchenText, people: { Priya: { hoursPerWeek: 99 } } }), ALEX)).status).toBe(400);
    });

    it("previews and saves the workspace work week; only managers can, with valid values", async () => {
      const me = (await (await host.fetch("/api/me", {}, ALEX)).json()) as { workspaces: { id: string }[] };
      const ws = me.workspaces[0]!.id;
      const put = (body: unknown, user = ALEX) => host.fetch(`/api/workspaces/${ws}/work-week`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, user);
      const next = { hoursPerWeek: 30, workdays: [1, 2, 3, 4] };
      const dry = (await (await put({ ...next, dryRun: true })).json()) as { saved: boolean; impact: { planId: string; before: string; after: string }[] };
      expect(dry.saved).toBe(false);
      const kitchen = dry.impact.find((i) => i.planId === planId)!;
      const plan = (await (await host.fetch(`/api/plans/${planId}`, {}, ALEX)).json()) as { plan: Plan; people: Record<string, PersonAvailability>; schedule: { finish: string }; workWeek: { hoursPerWeek: number } };
      expect(kitchen.before).toBe(plan.schedule.finish);
      expect(kitchen.after).toBe(levelPlan(plan.plan, { today: TODAY, workWeek: next, people: plan.people }).finish);
      expect(kitchen.after).not.toBe(kitchen.before);
      expect(plan.workWeek.hoursPerWeek).toBe(40); // nothing saved by the preview

      expect((await put({ hoursPerWeek: 37.5, workdays: [1, 2, 3, 4, 5] })).status).toBe(200);
      expect(((await (await host.fetch("/api/me", {}, ALEX)).json()) as { workspaces: { work_week: unknown }[] }).workspaces[0]!.work_week).toEqual({ hoursPerWeek: 37.5, workdays: [1, 2, 3, 4, 5] });
      expect((await put({ hoursPerWeek: 37.4, workdays: [1] })).status).toBe(400);
      expect((await put({ hoursPerWeek: 40, workdays: [] })).status).toBe(400);
      expect((await put({ hoursPerWeek: 40, workdays: [7] })).status).toBe(400);
      expect((await put({ hoursPerWeek: 40, workdays: [1, 2, 3, 4, 5] }, SAM)).status).toBe(404);
      expect((await put({ hoursPerWeek: 40, workdays: [1, 2, 3, 4, 5] })).status).toBe(200);
    });

    it("applies an AI update after saving a version, restores versions exactly, and lists the Trash", async () => {
      const created = (await (await host.fetch("/api/plans", json({ text: "---\nezplan: 1\ntitle: Move\nstart: 2027-01-04\n---\n## P1: Pack\n- [x] T1: Boxes (1d) @Alex\n- [ ] T2: Pack books (2d) @Alex depends: T1" }), ALEX)).json()) as { id: string };
      const id = created.id;
      const get = async () => (await (await host.fetch(`/api/plans/${id}`, {}, ALEX)).json()) as { plan: Plan; version: number };
      const before = (await get()).plan;
      const ops = [
        { kind: "setPlanField", field: "goal", value: "Moved by Friday" },
        { kind: "addPhase", phase: { id: "P2", title: "Move day" }, afterId: "P1" },
        { kind: "addTask", phaseId: "P2", task: { id: "T3", title: "Load the van", status: "todo", milestone: false, depends: [{ id: "T2", type: "FS", lagDays: 0 }], notes: [], tags: [], subtasks: [], extra: {} }, first: true },
        { kind: "setField", taskId: "T2", field: "estimate", value: { amount: 3, unit: "d" } },
      ];
      const res = (await (await host.fetch(`/api/plans/${id}/update`, json({ ops }), ALEX)).json()) as { applied: number; savedVersion: number };
      expect(res.applied).toBe(4);
      const after = (await get()).plan;
      expect(after.goal).toBe("Moved by Friday");
      expect(after.phases.map((p) => p.title)).toEqual(["Pack", "Move day"]);
      expect(after.phases[0]!.tasks[0]!.done!.by).toBe("Alex"); // progress untouched

      const versions = (await (await host.fetch(`/api/plans/${id}/versions`, {}, ALEX)).json()) as { versions: { version: number; reason: string; by: string }[] };
      expect(versions.versions.map((v) => v.reason)).toEqual(["Before an update from an AI assistant", "import"]);
      expect(versions.versions[0]!.by).toBe("Alex");

      expect((await host.fetch(`/api/plans/${id}/versions/${res.savedVersion}/restore`, json({}), ALEX)).status).toBe(200);
      expect((await get()).plan).toEqual(before);
      expect(((await (await host.fetch(`/api/plans/${id}/versions`, {}, ALEX)).json()) as { versions: { reason: string }[] }).versions[0]!.reason).toBe(`Before restoring version ${res.savedVersion}`);

      await host.fetch(`/api/plans/${id}/ops`, json({ opId: "del-1", clientId: "c", op: { kind: "deleteTask", taskId: "T2" } }), ALEX);
      const trash = (await (await host.fetch(`/api/plans/${id}/trash`, {}, ALEX)).json()) as { items: { taskId: string; title: string; by: string }[] };
      expect(trash.items).toMatchObject([{ taskId: "T2", title: "Pack books", by: "Alex" }]);
      await host.fetch(`/api/plans/${id}/ops`, json({ opId: "res-1", clientId: "c", op: { kind: "restoreTask", taskId: "T2" } }), ALEX);
      expect(((await (await host.fetch(`/api/plans/${id}/trash`, {}, ALEX)).json()) as { items: unknown[] }).items).toEqual([]);
      expect((await get()).plan.phases[0]!.tasks.map((t) => t.id)).toEqual(["T1", "T2"]);

      // Refusals: clients can't send a whole-plan replacement, other workspaces see nothing, bad input is explained.
      expect((await host.fetch(`/api/plans/${id}/ops`, json({ opId: "x", clientId: "c", op: { kind: "replacePlan", plan: before } }), ALEX)).status).toBe(400);
      expect((await host.fetch(`/api/plans/${id}/update`, json({ ops: [{ kind: "replacePlan", plan: before }] }), ALEX)).status).toBe(400);
      expect((await host.fetch(`/api/plans/${id}/update`, json({ ops: [] }), ALEX)).status).toBe(400);
      expect((await host.fetch(`/api/plans/${id}/update`, json({ ops }), SAM)).status).toBe(404);
      expect((await host.fetch(`/api/plans/${id}/versions`, {}, SAM)).status).toBe(404);
      expect((await host.fetch(`/api/plans/${id}/trash`, {}, SAM)).status).toBe(404);
      expect((await host.fetch(`/api/plans/${id}/versions/99/restore`, json({}), ALEX)).status).toBe(404);
    });

    it("keeps everything across a restart, and migrations run once", async () => {
      await host.restart();
      expect((await host.fetch("/api/health")).status).toBe(200);
      const plan = (await (await host.fetch(`/api/plans/${planId}`, {}, ALEX)).json()) as { version: number };
      expect(plan.version).toBe(13);
      const next = (await (await host.fetch(`/api/plans/${planId}/ops`, json({ opId: "after-restart", clientId: "c1", op: { kind: "setStatus", taskId: "T3", status: "progress" } }), ALEX)).json()) as { version: number };
      expect(next.version).toBe(14);
      const replay = (await (await host.fetch(`/api/plans/${planId}/ops`, json({ opId: "op-1", clientId: "c1", op: { kind: "setStatus", taskId: "T1", status: "done" } }), ALEX)).json()) as { status: string };
      expect(replay.status).toBe("duplicate"); // remembered edits survive the restart
    }, 60_000);
  });

  describe(`Test sign-in is off by default: ${hostName}`, () => {
    it("ignores the test header unless the test flag is set", async () => {
      const h = await factory.start({ testAuth: false });
      try {
        expect((await h.fetch("/api/me", {}, ALEX)).status).toBe(401);
      } finally {
        await h.stop();
      }
    }, 60_000);
  });
}
