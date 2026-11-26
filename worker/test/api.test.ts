/**
 * Runs the shared API contract against the real Workers runtime (Miniflare): the bundled worker
 * with a D1 database, an R2 bucket and the PlanRoom Durable Object, all stored on disk so a
 * restart keeps them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { apiContract, TODAY, type HostFactory, type TestHost } from "../../server/test/contract";
import { testEnv, testHttp } from "../../server/test/hostConfig";
import { LiveClient, liveContract } from "../../server/test/live.contract";
import { sharingContract } from "../../server/test/sharing.contract";
import { aiContract } from "../../server/test/ai.contract";
import { aiAdminContract } from "../../server/test/aiAdmin.contract";
import { collabContract } from "../../server/test/collab.contract";
import { notifyContract } from "../../server/test/notify.contract";
import { supportContract } from "../../server/test/support.contract";
import { statusContract } from "../../server/test/status.contract";
import { mastersContract } from "../../server/test/masters.contract";
import { orgsContract } from "../../server/test/orgs.contract";
import { signInContract } from "../../server/test/signin.contract";

let bundled: Promise<string> | null = null;
function bundle(): Promise<string> {
  bundled ??= build({
    entryPoints: [join(import.meta.dirname, "..", "src", "index.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    conditions: ["workerd", "worker", "browser"],
    target: "es2022",
    logLevel: "silent",
  }).then((r) => r.outputFiles[0]!.text);
  return bundled;
}

const factory: HostFactory = {
  async start({ testAuth, fake, testAi }): Promise<TestHost> {
    const script = await bundle();
    const dir = mkdtempSync(join(tmpdir(), "worker-"));
    const make = () =>
      new Miniflare({
        modules: true,
        script,
        compatibilityDate: "2026-07-01",
        d1Databases: { DB: "plans" },
        r2Buckets: ["FILES"],
        durableObjects: { PLAN_ROOM: { className: "PlanRoom", useSQLite: true } },
        bindings: { ...testEnv(fake), TEST_CLOCK: "1", TEST_TODAY: TODAY, ...(testAuth ? { TEST_AUTH: "1" } : {}), ...(testAi ? { TEST_AI: "1" } : {}) },
        // Outbound requests (sign-in provider) go to the stand-in provider, never the internet.
        outboundService: (req: unknown) => testHttp(fake)(req as Request) as never,
        d1Persist: join(dir, "d1"),
        r2Persist: join(dir, "r2"),
        durableObjectsPersist: join(dir, "do"),
      });
    let mf = make();
    await mf.ready;
    return {
      async sql(statement, params = []) { return (await (await mf.getD1Database("DB")).prepare(statement).bind(...params).all()).results as Record<string, any>[]; },
      async live(path, { user, origin }) {
        const headers: Record<string, string> = { upgrade: "websocket" };
        if (user) headers["x-test-user"] = user;
        if (origin) headers.origin = origin;
        const res = await mf.dispatchFetch(`https://plans.test${path}`, { headers });
        const ws = res.webSocket;
        if (res.status !== 101 || !ws) return { status: res.status };
        ws.accept();
        return new LiveClient({
          send: (t) => ws.send(t),
          close: () => ws.close(),
          onMessage: (fn) => ws.addEventListener("message", (e) => fn(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer))),
          onClose: (fn) => ws.addEventListener("close", (e) => fn((e as CloseEvent).code)),
        });
      },
      async fetch(path, init = {}, user, cookie) {
        const headers = new Headers(init.headers);
        if (user) headers.set("x-test-user", user);
        if (cookie) headers.set("cookie", cookie);
        const res = await mf.dispatchFetch(`https://plans.test${path}`, { ...init, headers, redirect: "manual" } as Parameters<Miniflare["dispatchFetch"]>[1]);
        return res as unknown as Response;
      },
      async restart() {
        await mf.dispose();
        mf = make();
        await mf.ready;
      },
      async stop() {
        await mf.dispose();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  },
};

apiContract("cloud (Workers + D1 + Durable Objects)", factory);
signInContract("cloud (Workers + D1 + Durable Objects)", factory);
liveContract("cloud (Workers + D1 + Durable Objects)", factory);
sharingContract("cloud (Workers + D1 + Durable Objects)", factory);
aiContract("cloud (Workers + D1 + Durable Objects)", factory);
aiAdminContract("cloud (Workers + D1 + Durable Objects)", factory);
collabContract("cloud (Workers + D1 + Durable Objects)", factory);
notifyContract("cloud (Workers + D1 + Durable Objects)", factory);
supportContract("cloud (Workers + D1 + Durable Objects)", factory);
statusContract("cloud (Workers + D1 + Durable Objects)", factory);
mastersContract("cloud (Workers + D1 + Durable Objects)", factory);
orgsContract("cloud (Workers + D1 + Durable Objects)", factory);
