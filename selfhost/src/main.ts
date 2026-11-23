/**
 * Self-hosted entry point. Settings come from environment variables:
 *   DATA_DIR  folder for the database and files (default ./data; a volume in Docker)
 *   PORT      HTTP port (default 8080)
 *   PUBLIC_URL, OIDC_PROVIDERS, ALLOWED_EMAILS, SECURE_COOKIES: see server/src/config.ts
 */
import { configFromEnv, testAuthEnabled } from "@ezplan/server";
import { createSelfHost } from "./host";
import { startServer } from "./server";

const port = Number(process.env.PORT ?? 8080);
const { app, rooms, close } = createSelfHost({
  dataDir: process.env.DATA_DIR ?? "./data",
  config: configFromEnv(process.env),
  testAuth: testAuthEnabled(process.env.TEST_AUTH),
});
const server = startServer({ app, rooms, port, onListen: (p) => console.log(`Listening on port ${p}`) });

const stop = () => {
  void server.close().then(() => {
    close();
    process.exit(0);
  });
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
