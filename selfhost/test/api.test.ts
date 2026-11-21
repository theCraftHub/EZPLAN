import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiContract, TODAY, type TestHost } from "../../server/test/contract";
import { createSelfHost } from "../src/host";

const clock = { today: () => TODAY, now: () => Date.parse(`${TODAY}T12:00:00Z`) };

apiContract("self-hosted (Node + SQLite)", {
  async start({ testAuth }): Promise<TestHost> {
    const dataDir = mkdtempSync(join(tmpdir(), "selfhost-"));
    let server = createSelfHost({ dataDir, clock, ...(testAuth ? { testAuth: "1" } : {}) });
    return {
      fetch(path, init = {}, user) {
        const headers = new Headers(init.headers);
        if (user) headers.set("x-test-user", user);
        return Promise.resolve(server.app.fetch(new Request(`http://local${path}`, { ...init, headers })));
      },
      async restart() {
        server.close();
        server = createSelfHost({ dataDir, clock, ...(testAuth ? { testAuth: "1" } : {}) });
      },
      async stop() {
        server.close();
        rmSync(dataDir, { recursive: true, force: true });
      },
    };
  },
});
