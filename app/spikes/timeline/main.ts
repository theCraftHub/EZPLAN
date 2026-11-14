/**
 * Spike: can a phone/desktop browser show a 2,000-task timeline smoothly?
 * Approach: schedule with the shared engine, then render only the rows in view
 * (virtualized), absolutely positioned. Metrics are exposed on window for Playwright.
 */
import { parsePlan, schedulePlan, type Plan, type Schedule } from "@ezplan/shared";

const N = 2000;
const ROW = 28;
const DAY_PX = 8;
const LABEL = 200;

function makePlan(): Plan {
  const lines: string[] = ["---", "ezplan: 1", "title: Big plan", "start: 2026-12-01", "---"];
  for (let p = 0; p < 20; p++) {
    lines.push(`## P${p + 1}: Phase ${p + 1}`);
    for (let i = 0; i < N / 20; i++) {
      const id = p * (N / 20) + i + 1;
      const dep = i > 0 ? ` depends: T${id - 1}` : p > 0 ? ` depends: T${p * (N / 20)}` : "";
      lines.push(`- [ ] T${id}: Task ${id} (${(id % 5) + 1}d) @P${id % 9}${dep}`);
      if (id % 3 === 0) lines.push(`  planned: 2026-12-01 → 2026-12-02`);
    }
  }
  return parsePlan(lines.join("\n")).plan;
}

const view = document.getElementById("view")!;
const inner = document.getElementById("inner")!;
const info = document.getElementById("info")!;
const plan = makePlan();
const tasks = plan.phases.flatMap((p) => p.tasks);
let schedule: Schedule;

function computeSchedule(): number {
  const t0 = performance.now();
  schedule = schedulePlan(plan, { today: "2026-12-08" });
  return performance.now() - t0;
}

const pool: HTMLDivElement[] = [];
function render(): void {
  const first = Math.max(0, Math.floor(view.scrollTop / ROW) - 10);
  const count = Math.ceil(view.clientHeight / ROW) + 20;
  while (pool.length < count) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = '<span class="label"></span><span class="ghost"></span><span class="bar"></span>';
    inner.appendChild(row);
    pool.push(row);
  }
  for (let k = 0; k < pool.length; k++) {
    const row = pool[k]!;
    const i = first + k;
    const t = tasks[i];
    if (!t || k >= count) {
      row.style.display = "none";
      continue;
    }
    const s = schedule.tasks.get(t.id)!;
    row.style.display = "flex";
    row.style.top = `${i * ROW}px`;
    row.style.width = `${LABEL + schedule.totalDays * DAY_PX + 40}px`;
    (row.children[0] as HTMLElement).textContent = `${t.id} ${t.title}`;
    const ghost = row.children[1] as HTMLElement;
    ghost.style.display = t.planned ? "block" : "none";
    if (t.planned) {
      ghost.style.left = `${LABEL}px`;
      ghost.style.width = `${2 * DAY_PX}px`;
    }
    const bar = row.children[2] as HTMLElement;
    bar.style.left = `${LABEL + s.startOffset * DAY_PX}px`;
    bar.style.width = `${Math.max(4, s.durationDays * DAY_PX)}px`;
    bar.classList.toggle("crit", s.critical);
  }
}

const scheduleMs = computeSchedule();
const t0 = performance.now();
inner.style.height = `${tasks.length * ROW}px`;
inner.style.width = `${LABEL + schedule!.totalDays * DAY_PX + 40}px`;
render();
const renderMs = performance.now() - t0;
view.addEventListener("scroll", () => render(), { passive: true });
info.textContent = `${tasks.length} tasks · schedule ${scheduleMs.toFixed(1)} ms · first render ${renderMs.toFixed(1)} ms`;

declare global {
  interface Window {
    __metrics: Record<string, number>;
    __whatIf: (i: number) => number;
    __scrollTest: (steps: number) => Promise<{ avg: number; p95: number; max: number }>;
  }
}
window.__metrics = { tasks: tasks.length, scheduleMs, renderMs };

/** Simulates dragging a task: change its estimate, reschedule everything, redraw. */
window.__whatIf = (i: number) => {
  const t = tasks[i]!;
  const s = performance.now();
  t.estimate = { amount: ((t.estimate?.amount ?? 1) % 7) + 1, unit: "d" };
  computeSchedule();
  render();
  return performance.now() - s;
};

window.__scrollTest = (steps: number) =>
  new Promise((resolve) => {
    const frames: number[] = [];
    let last = performance.now();
    let k = 0;
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      view.scrollTop += ROW * 3;
      view.scrollLeft = (k * 13) % 600;
      if (++k < steps) requestAnimationFrame(tick);
      else {
        frames.shift();
        frames.sort((a, b) => a - b);
        resolve({
          avg: frames.reduce((a, b) => a + b, 0) / frames.length,
          p95: frames[Math.floor(frames.length * 0.95)]!,
          max: frames[frames.length - 1]!,
        });
      }
    };
    requestAnimationFrame(tick);
  });
