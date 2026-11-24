/**
 * Comments, the Commenter role and the activity log. Written once, run on both hosts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@ezplan/shared";
import type { HostFactory, TestHost } from "./contract";
import { LiveClient } from "./live.contract";
import { PUBLIC_URL } from "./signin.contract";

const ALEX = "u-alex|Alex|alex@example.com";
const SAM = "u-sam|Sam Okoye|sam@example.com";
const KIM = "u-kim|Kim|kim@example.com";
const PLAN = "---\nezplan: 1\ntitle: Gala\nstart: 2027-01-04\n---\n## P1: Venue\n- [ ] T1: Book venue (2d) @Alex\n- [ ] T2: Set budget (1d) @Sam";

export function collabContract(hostName: string, factory: HostFactory) {
  describe(`Comments, commenters and activity: ${hostName}`, () => {
    let host: TestHost;
    let id = "";
    const req = async (method: string, path: string, body: unknown, user: string) => {
      const r = await host.fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, user);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const comments = (taskId: string, user = ALEX) => req("GET", `/api/plans/${id}/tasks/${taskId}/comments`, undefined, user);
    const say = (taskId: string, body: string, user: string) => req("POST", `/api/plans/${id}/tasks/${taskId}/comments`, { body }, user);
    const join = async (email: string, role: string, user: string) => {
      const link = (await req("POST", `/api/plans/${id}/invites`, { email, role }, ALEX)).body.link as string;
      await req("POST", `/api/invites/${link.split("/invite/")[1]}/accept`, {}, user);
    };

    beforeAll(async () => {
      host = await factory.start({ testAuth: true });
      id = (await req("POST", "/api/plans", { text: PLAN }, ALEX)).body.id;
      await join("sam@example.com", "commenter", SAM);
      await join("kim@example.com", "viewer", KIM);
    }, 60_000);
    afterAll(async () => { await host?.stop(); });

    it("commenters comment but can't change the plan by any route; viewers can't comment", async () => {
      expect((await req("GET", `/api/plans/${id}`, undefined, SAM)).body.role).toBe("commenter");
      expect((await say("T1", "Can we see the hall first?", SAM)).status).toBe(201);
      expect((await req("POST", `/api/plans/${id}/ops`, { opId: "s1", clientId: "s", op: { kind: "setStatus", taskId: "T1", status: "done" } }, SAM)).status).toBe(403);
      expect((await req("POST", `/api/plans/${id}/update`, { ops: [{ kind: "setPlanField", field: "goal", value: "x" }] }, SAM)).status).toBe(403);
      expect((await req("PUT", `/api/plans/${id}/people/Sam`, { hoursPerWeek: 10 }, SAM)).status).toBe(403);
      expect((await req("POST", `/api/plans/${id}/invites`, { email: "x@example.com", role: "viewer" }, SAM)).status).toBe(403);
      const live = await host.live!(`/api/plans/${id}/live`, { user: SAM, origin: PUBLIC_URL });
      if (!(live instanceof LiveClient)) throw new Error("refused");
      live.send({ t: "hello" });
      await live.next((m) => m.t === "welcome");
      live.send({ t: "edit", opId: "s2", clientId: "s", op: { kind: "setStatus", taskId: "T1", status: "done" } });
      expect(await live.next((m) => m.t === "ack" && m.opId === "s2")).toMatchObject({ status: "rejected" });
      live.close();

      expect((await say("T1", "hi", KIM)).status).toBe(403);
      expect((await comments("T1", KIM)).body.canComment).toBe(false);
      expect((await comments("T1", KIM)).body.comments).toHaveLength(1); // viewers still read them
    });

    it("comments: plain text, mentions of people on the plan, edit and delete rules, screening, live", async () => {
      const a = await host.live!(`/api/plans/${id}/live`, { user: ALEX, origin: PUBLIC_URL });
      if (!(a instanceof LiveClient)) throw new Error("refused");
      a.send({ t: "hello" });
      await a.next((m) => m.t === "welcome");
      const posted = await say("T2", "<b>@Sam Okoye</b> can you check with @Alex? cc nobody@example.com", ALEX);
      expect(posted.status).toBe(201);
      expect(posted.body.mentions.sort()).toEqual(["Alex", "Sam Okoye"]);
      expect(await a.next<Extract<ServerMessage, { t: "comments" }>>((m) => m.t === "comments")).toMatchObject({ taskId: "T2", count: 1 });
      a.close();

      const list = (await comments("T2", SAM)).body;
      expect(list.people).toEqual(expect.arrayContaining(["Alex", "Kim"]));
      expect(list.people).not.toContain("Sam Okoye"); // not suggested to themselves
      expect(list.comments[0]).toMatchObject({ author: "Alex", body: "<b>@Sam Okoye</b> can you check with @Alex? cc nobody@example.com", mine: false, canEdit: false, canDelete: false });
      const cid = list.comments[0].id;
      expect((await req("PATCH", `/api/plans/${id}/tasks/T2/comments/${cid}`, { body: "mine now" }, SAM)).status).toBe(403);
      expect((await req("PATCH", `/api/plans/${id}/tasks/T2/comments/${cid}`, { body: "Edited" }, ALEX)).status).toBe(200);
      expect((await comments("T2")).body.comments[0]).toMatchObject({ body: "Edited", editedAt: expect.any(Number), canEdit: true });

      const sams = (await say("T2", "Done checking", SAM)).body.id;
      expect((await req("DELETE", `/api/plans/${id}/tasks/T2/comments/${sams}`, undefined, KIM)).status).toBe(403);
      expect((await req("DELETE", `/api/plans/${id}/tasks/T2/comments/${sams}`, undefined, ALEX)).status).toBe(200); // the plan's manager can
      expect((await comments("T2")).body.comments[1]).toMatchObject({ deleted: true, body: null });
      expect((await req("GET", `/api/plans/${id}/comment-counts`, undefined, KIM)).body.counts).toEqual({ T1: 1, T2: 1 });

      expect((await say("T2", "   ", ALEX)).status).toBe(400);
      expect((await say("T2", "x".repeat(2001), ALEX)).status).toBe(400);
      expect((await say("T2", "how to build a bomb at the venue", ALEX)).status).toBe(422);
      expect((await say("T99", "hello", ALEX)).status).toBe(404);
      expect((await say("T1", "hello", "u-z|Zed|z@example.com")).status).toBe(404);
    });

    it("activity is written by the server from who actually did it, and quick repeats collapse", async () => {
      const op = (opId: string, o: unknown, user: string) => req("POST", `/api/plans/${id}/ops`, { opId, clientId: "c", op: o, actor: { name: "Someone else" } }, user);
      await op("a1", { kind: "setStatus", taskId: "T1", status: "progress" }, ALEX);
      await op("a2", { kind: "setStatus", taskId: "T1", status: "done" }, ALEX);
      await op("a3", { kind: "setField", taskId: "T2", field: "owner", value: "Kim" }, ALEX);
      await op("a4", { kind: "setStatus", taskId: "T2", status: "done" }, ALEX);
      await op("a5", { kind: "setStatus", taskId: "T2", status: "done" }, ALEX); // no change: no line
      const items = (await req("GET", `/api/plans/${id}/activity`, undefined, KIM)).body.items as { summary: string; actor: string }[];
      const lines = items.map((i) => i.summary);
      expect(lines.slice(0, 3)).toEqual(["Alex marked Set budget done", "Alex gave Set budget to Kim", "Alex marked Book venue done"]);
      expect(lines).not.toContain("Alex set Book venue to in progress"); // collapsed into "done"
      expect(lines).toContain("Sam Okoye commented on Book venue");
      expect(lines).toContain("Sam Okoye joined the plan as a Commenter");
      expect(items.every((i) => i.actor !== "Someone else")).toBe(true);

      await req("PUT", `/api/plans/${id}/members/u-kim`, { role: "commenter" }, ALEX);
      expect((await req("GET", `/api/plans/${id}/activity`, undefined, ALEX)).body.items[0].summary).toBe("Alex made Kim a Commenter");
      const ai = await req("POST", `/api/plans/${id}/update`, { ops: [{ kind: "setPlanField", field: "goal", value: "Raise $50k" }, { kind: "setPlanField", field: "doneWhen", value: "Held" }] }, ALEX);
      expect(ai.status).toBe(200);
      expect((await req("GET", `/api/plans/${id}/activity`, undefined, ALEX)).body.items[0].summary).toBe("Alex applied 2 changes from an AI assistant");
      expect((await req("GET", `/api/plans/${id}/activity`, undefined, "u-z|Zed|z@example.com")).status).toBe(404);
    });
  });
}
