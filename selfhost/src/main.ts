/**
 * Self-hosted entry point. Settings come from environment variables:
 *   DATA_DIR  folder for the database and files (default ./data; a volume in Docker)
 *   PORT      HTTP port (default 8080)
 *   STATIC_DIR the built website (default: app/dist next to this install)
 *   PUBLIC_URL, OIDC_PROVIDERS, ALLOWED_EMAILS, SECURE_COOKIES: see server/src/config.ts
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicEngine, configFromEnv, testAuthEnabled } from "@rakuplan/server";
import { createSelfHost } from "./host";
import { startServer } from "./server";

const port = Number(process.env.PORT ?? 8080);
const { app, rooms, close } = createSelfHost({
  dataDir: process.env.DATA_DIR ?? "./data",
  config: configFromEnv(process.env),
  testAuth: testAuthEnabled(process.env.TEST_AUTH),
  testAi: testAuthEnabled(process.env.TEST_AI),
  // The built-in AI, only when a key is set (never stored in the repository).
  ...(process.env.ANTHROPIC_API_KEY ? { ai: new AnthropicEngine({ apiKey: process.env.ANTHROPIC_API_KEY, ...(process.env.AI_MODEL ? { model: process.env.AI_MODEL } : {}), ...(process.env.AI_REPORT_MODEL ? { reportModel: process.env.AI_REPORT_MODEL } : {}) }) } : {}),
  staticDir: process.env.STATIC_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "dist"),
});
const server = startServer({ app, rooms, port, trustProxy: process.env.TRUST_PROXY === "1", onListen: (p) => console.log(`Listening on port ${p}`) });

const stop = () => {
  void server.close().then(() => {
    close();
    process.exit(0);
  });
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
