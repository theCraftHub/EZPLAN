import { defineConfig } from "vitest/config";

// Performance measurements, run on demand: npm run bench
export default defineConfig({ test: { include: ["shared/bench/**/*.test.ts"] } });
