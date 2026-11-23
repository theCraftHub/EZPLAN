import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiContract, TODAY, type HostFactory, type TestHost } from "../../server/test/contract";
import { testConfig, testHttp } from "../../server/test/hostConfig";
import { LiveClient, liveContract } from "../../server/test/live.contract";
import { sharingContract } from "../../server/test/sharing.contract";
import { aiContract } from "../../server/test/ai.contract";
import { signInContract } from "../../server/test/signin.contract";
import { WebSocket } from "ws";
import { createSelfHost } from "../src/host";
import { startServer } from "../src/server";

const clock = { today: () => TODAY, now: () => Date.parse(`${TODAY}T12:00:00Z`) };

const factory: HostFactory = {
  async start({ testAuth, fake, testAi }): Promise<TestHost> {
    const dataDir = mkdtempSync(join(tmpdir(), "selfhost-"));
    const make = () => createSelfHost({ dataDir, clock, config: testConfig(fake), http: testHttp(fake), testAuth, ...(testAi ? { testAi } : {}) });
    let server = make();
    let http: ReturnType<typeof startServer> | null = null;
    const listening = async () => {
      if (!http) {
        http = startServer({ app: server.app, rooms: server.rooms, port: 0, hostname: "127.0.0.1" });
        await new Promise<void>((r) => (http!.server.listening ? r() : http!.server.once("listening", () => r())));
      }
      return http.port();
    };
    return {
      async live(path, { user, origin }) {
        const port = await listening();
        const headers: Record<string, string> = {};
        if (user) headers["x-test-user"] = user;
        if (origin) headers.origin = origin;
        const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
        return new Promise((resolve, reject) => {
          ws.once("unexpected-response", (_req, res) => resolve({ status: res.statusCode ?? 0 }));
          ws.once("error", reject);
          ws.once("open", () =>
            resolve(
              new LiveClient({
                send: (t) => ws.send(t),
                close: () => ws.close(),
                onMessage: (fn) => ws.on("message", (d) => fn(d.toString())),
                onClose: (fn) => ws.on("close", (code) => fn(code)),
              }),
            ),
          );
        });
      },
      fetch(path, init = {}, user, cookie) {
        const headers = new Headers(init.headers);
        if (user) headers.set("x-test-user", user);
        if (cookie) headers.set("cookie", cookie);
        return Promise.resolve(server.app.fetch(new Request(`https://plans.test${path}`, { ...init, headers, redirect: "manual" })));
      },
      async restart() {
        await http?.close();
        http = null;
        server.close();
        server = make();
      },
      async stop() {
        await http?.close();
        server.close();
        rmSync(dataDir, { recursive: true, force: true });
      },
    };
  },
};

apiContract("self-hosted (Node + SQLite)", factory);
signInContract("self-hosted (Node + SQLite)", factory);
liveContract("self-hosted (Node + SQLite)", factory);
sharingContract("self-hosted (Node + SQLite)", factory);
aiContract("self-hosted (Node + SQLite)", factory);
