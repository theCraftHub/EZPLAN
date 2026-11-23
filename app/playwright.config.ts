import { defineConfig, devices } from "@playwright/test";

const port = 5180;

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.results",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, trace: "off", screenshot: "off" },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    // Builds the site, bundles the test server (the real self-hosted code), and starts it.
    command: "npx vite build --logLevel warn && npx esbuild e2e/server.ts --bundle --platform=node --format=esm --target=node22 --outfile=e2e/.server.mjs --log-level=warning --banner:js=\"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);\" && node e2e/.server.mjs",
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
