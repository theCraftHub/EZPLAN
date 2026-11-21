/**
 * Self-hosted entry point. Settings come from environment variables:
 *   DATA_DIR  folder for the database and files (default ./data; a volume in Docker)
 *   PORT      HTTP port (default 8080)
 */
import { serve } from "@hono/node-server";
import { createSelfHost } from "./host";

const port = Number(process.env.PORT ?? 8080);
const { app, close } = createSelfHost({ dataDir: process.env.DATA_DIR ?? "./data", testAuth: process.env.TEST_AUTH });
const server = serve({ fetch: app.fetch, port }, (info) => console.log(`Listening on port ${info.port}`));

const stop = () => {
  server.close(() => {
    close();
    process.exit(0);
  });
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
