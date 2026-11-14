import { it } from "vitest";
import { checkPlan, parsePlan, schedulePlan, exportPlan } from "../src";
it("bench", () => {
  const lines = Array.from({ length: 2000 }, (_, i) => `- [ ] T${i + 1}: Task ${i + 1} (1d) @P${i % 7}${i > 0 ? ` depends: T${i}` : ""}`);
  const text = `---\nezplan: 1\ntitle: B\nstart: 2026-12-01\n---\n## P1: W\n${lines.join("\n")}`;
  let t = performance.now(); const p = parsePlan(text).plan; const tp = performance.now() - t;
  t = performance.now(); const s = schedulePlan(p); const ts = performance.now() - t;
  t = performance.now(); checkPlan(p, { schedule: s }); const tc = performance.now() - t;
  t = performance.now(); exportPlan(p); const te = performance.now() - t;
  process.stdout.write(JSON.stringify({ parseMs: tp.toFixed(1), scheduleMs: ts.toFixed(1), checkMs: tc.toFixed(1), exportMs: te.toFixed(1) }) + "\n");
});
