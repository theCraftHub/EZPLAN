# Week-one technical spikes (Phase 1a)

The two riskiest pieces of the build were tested first, before anything depends on them.

## 1. Offline + live editing sync

**Question:** can several people edit the same plan at once, some of them offline, and always end up with the same plan without losing work?

**Approach** (`shared/src/ops.ts`): the server's plan room is the single authority. Clients send small operations (set status, edit a field, add, move, delete). The server applies them in arrival order, numbers them and broadcasts them. Each client keeps the last confirmed plan plus its own pending edits, which it re-applies on top. So edits appear instantly and everyone converges on the server's version.

| Rule | Behavior |
|---|---|
| Two people edit the same field | The edit that reaches the server last wins; everyone sees the same result |
| Two people edit different fields | Both edits survive |
| Someone deletes a task another person edited offline | The task is restored from Trash and flagged for review |
| A dropped connection re-sends edits | Each edit is applied once (operation IDs) |
| "Done by" | Set by the server from the signed-in person; a client can't fake it |

**Result:** 7 tests pass, including **200 randomized rounds** of three people making 25 edits each with random offline periods: every client always ends with exactly the server's plan. **Verdict: go.** The approach is simple enough to run inside one Durable Object per plan.

**Follow-ups for 1b:** persist pending edits in IndexedDB so they survive closing the app; show "restored for review" in the UI; record each operation in the activity log.

## 2. Timeline at 2,000 tasks

**Question:** can the timeline stay smooth with 2,000 tasks, on desktop and on a phone, including "what-if" previews while dragging?

**Approach** (`app/spikes/timeline/`): schedule with the shared engine, then draw only the rows in view (about 50 at a time) with reused elements. Measured with Playwright on desktop Chromium and on an emulated iPhone 13 with the CPU slowed 4x (`scripts/measure-timeline-spike.cjs`; run `npm run spike:timeline -w app`).

| Measurement | Desktop | Phone (4x slower CPU) | Target |
|---|---|---|---|
| Schedule 2,000 tasks | 29 ms | 82 ms | |
| First draw | 2 ms | 5 ms | |
| Scrolling frame time (average / 95th percentile) | 16.7 / 17.0 ms | 17.1 / 22.2 ms | ~16.7 ms (60 fps) |
| What-if: change one task, reschedule all, redraw (median / worst) | 18 / 22 ms | 68 / 114 ms | under 100 ms |

Before this spike, scheduling 2,000 tasks took **5.6 seconds** (day-by-day date stepping and repeated list scans). Caching working days and using sets brought the full parse + schedule + check + export to **about 40 ms** in Node (`npm run bench`).

**Verdict: go, with one fix for phones.** Scrolling is smooth everywhere (60 fps on average, occasional ~45 fps frames on a slow phone). What-if previews meet the target on desktop and in the typical phone case; the worst phone case (114 ms) is slightly over. Fixes planned for 1b:
1. **Incremental rescheduling:** recompute only the changed task and everything after it, not all 2,000.
2. Run scheduling in a **Web Worker** so dragging never blocks the screen.
3. While dragging on a phone, update at most every animation frame and settle on release.

**Not yet measured:** a real phone (only an emulated one), and drawing dependency arrows (will also be limited to rows in view).
