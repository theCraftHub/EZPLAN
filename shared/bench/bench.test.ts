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

it("bench: person-aware scheduling, 2,000 tasks, 20 people", async () => {
  const { levelPlan } = await import("../src");
  const lines = Array.from({ length: 2000 }, (_, i) => `- [ ] T${i + 1}: Task ${i + 1} (${1 + (i % 4)}d) @P${i % 20}${i >= 20 ? ` depends: T${i + 1 - 20}` : ""}${i % 50 === 0 ? " !high" : ""}`);
  const p = parsePlan(`---\nezplan: 1\ntitle: B\nstart: 2026-12-01\n---\n## P1: W\n${lines.join("\n")}`).plan;
  const people = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`P${i}`, { hoursPerWeek: 20 + i, timeOff: [{ start: "2027-01-04", end: "2027-01-08" }] }]));
  const t = performance.now();
  const s = levelPlan(p, { people });
  process.stdout.write(JSON.stringify({ levelMs: (performance.now() - t).toFixed(1), finish: s.finish }) + "\n");
});
