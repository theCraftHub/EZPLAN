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
import { apiContract, TODAY, type TestHost } from "../../server/test/contract";

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

apiContract("cloud (Workers + D1 + Durable Objects)", {
  async start({ testAuth }): Promise<TestHost> {
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
        bindings: testAuth ? { TEST_AUTH: "1", TEST_TODAY: TODAY } : { TEST_TODAY: TODAY },
        d1Persist: join(dir, "d1"),
        r2Persist: join(dir, "r2"),
        durableObjectsPersist: join(dir, "do"),
      });
    let mf = make();
    await mf.ready;
    return {
      async fetch(path, init = {}, user) {
        const headers = new Headers(init.headers);
        if (user) headers.set("x-test-user", user);
        const res = await mf.dispatchFetch(`http://local${path}`, { ...init, headers } as Parameters<Miniflare["dispatchFetch"]>[1]);
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
});
