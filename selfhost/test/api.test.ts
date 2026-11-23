import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiContract, TODAY, type HostFactory, type TestHost } from "../../server/test/contract";
import { testConfig, testHttp } from "../../server/test/hostConfig";
import { signInContract } from "../../server/test/signin.contract";
import { createSelfHost } from "../src/host";

const clock = { today: () => TODAY, now: () => Date.parse(`${TODAY}T12:00:00Z`) };

const factory: HostFactory = {
  async start({ testAuth, fake }): Promise<TestHost> {
    const dataDir = mkdtempSync(join(tmpdir(), "selfhost-"));
    const make = () => createSelfHost({ dataDir, clock, config: testConfig(fake), http: testHttp(fake), testAuth });
    let server = make();
    return {
      fetch(path, init = {}, user, cookie) {
        const headers = new Headers(init.headers);
        if (user) headers.set("x-test-user", user);
        if (cookie) headers.set("cookie", cookie);
        return Promise.resolve(server.app.fetch(new Request(`https://plans.test${path}`, { ...init, headers, redirect: "manual" })));
      },
      async restart() {
        server.close();
        server = make();
      },
      async stop() {
        server.close();
        rmSync(dataDir, { recursive: true, force: true });
      },
    };
  },
};

apiContract("self-hosted (Node + SQLite)", factory);
signInContract("self-hosted (Node + SQLite)", factory);
