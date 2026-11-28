# Plan Header (view picker + slim sticky bar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plan page's 8 action buttons and 8 tabs with a compact two-row header (view picker, top actions, More menu) and a slim sticky bar that appears on scroll.

**Architecture:** One `PlanHeader` component renders the full header and the slim bar from shared lists of views (`planNav.ts`) and actions, so they never drift. Menus use Radix DropdownMenu. Routes and pages are unchanged; only how you reach them changes.

**Tech Stack:** React 18, Tailwind, `@radix-ui/react-dropdown-menu`, lucide-react, Playwright (phone + desktop projects).

**Spec:** `docs/superpowers/specs/2026-11-28-plan-header-design.md`

## Global Constraints
- Same structure on phone and desktop; phone row 2 = `[view ▾] [Update] [Share] [⋯]`, desktop adds `[Report]` and full labels.
- Visible labels may shorten on phones, accessible names stay: "Update with my AI", "Share", "Status report", "More plan actions", "Plan view: <name>".
- Every view and action reachable in at most two taps; nothing cut off or scrolled off-screen.
- Touch targets at least 44 px; existing color tokens; light and dark.
- No route, page or feature removed; the brand name only in `shared/src/brand.ts`.
- Never use em dashes in UI copy.
- Commit only when `npm run check` and `npm run e2e -- --trace off` are both clean.

## Review Focus
- Every existing test waits on `getByRole("status").filter({ hasText: /^Live/ })`: the connection indicator must stay a `role="status"` whose text starts with "Live" / "Offline" / "Connecting…". (Task 2 test.)
- Viewers and commenters: no Update action, More still offers Download, Calendar, Print, Present, History; "View only" / "Can comment" still shown. (Task 2 test.)
- A 120-character plan title on a phone: no horizontal page scroll, title wraps in the full header and truncates in the slim bar. (Task 2 and Task 3 tests.)
- Plans inside a master plan: the back arrow goes to the master and is named after it; the "Part of the master plan" chip stays. (Task 2 test.)
- The slim bar must not duplicate controls for assistive tech or tests while hidden: it is `inert` and `aria-hidden` until shown. (Task 3 test.)

---

### Task 1: View list and menu dependency

**Files:**
- Create: `app/src/pages/plan/planNav.ts`
- Modify: `app/package.json` (add `@radix-ui/react-dropdown-menu`, then `npm install`)
- Test: `app/test/planNav.test.ts`

**Interfaces:**
- Produces: `export type PlanView = "" | "checklist" | "board" | "timeline" | "grid" | "team" | "risks" | "activity"`;
  `export const PLAN_VIEWS: { view: PlanView; label: string; hint: string; Icon: LucideIcon }[]` in this order with these labels and hints:
  Overview "Status at a glance", Checklist "Tasks by phase", Board "Cards by status", Timeline "Dates on a chart", Grid "Edit tasks in a table", Team "Who does what, when", Risks "Risks and issues", Activity "What changed";
  `export const OTHER_PAGES: Record<string, string>` = `{ update: "Update with my AI", report: "Status report", history: "History and Trash", share: "Share", print: "Print summary" }`;
  `export function viewName(view: string): string` (label from either list; "Overview" for "").

- [ ] **Step 1: Write the failing test** `app/test/planNav.test.ts`: `PLAN_VIEWS.map(v => v.view)` equals `["", "checklist", "board", "timeline", "grid", "team", "risks", "activity"]`; every view and every `OTHER_PAGES` key appears in the plan route list in `app/src/App.tsx` (read the file, match the array on the `/p/` route line); `viewName("")` is "Overview", `viewName("report")` is "Status report", no label or hint contains "—".
- [ ] **Step 2:** `npx vitest run app/test/planNav.test.ts` fails (module missing).
- [ ] **Step 3:** Add the dependency, write `planNav.ts`.
- [ ] **Step 4:** Test passes; `npx tsc -p app --noEmit` clean.
- [ ] **Step 5:** Commit "Plan header: view list and menu dependency".

### Task 2: PlanHeader (title row, picker, actions, More)

**Files:**
- Create: `app/src/pages/plan/PlanHeader.tsx`
- Modify: `app/src/pages/plan/PlanPage.tsx` (header block and `TABS` replaced by `<PlanHeader …/>`)
- Modify: `app/e2e/helpers.ts` (add helpers), and the specs that click tabs or header buttons: ai, baseline-status, board, calendars, comments, daily, grid, portfolio, risks, screens-h, share-links, sharing, speed
- Test: `app/e2e/plan-header.spec.ts`

**Interfaces:**
- Consumes: `PLAN_VIEWS`, `OTHER_PAGES`, `viewName` from Task 1.
- Produces: `export function PlanHeader(p: { id: string; view: string; title: string; health: string; statusUpdate: UpdateState; master: PlanDetail["master"]; status: "live" | "offline" | "connecting"; pending: number; others: { userId: string; name: string }[]; canEdit: boolean; role: string; onPresent: () => void; presentDisabled: boolean })`, plus `function ActionsRow(p: { compact: boolean } & …)` reused by Task 3.
- e2e helpers: `openView(page, label)` (clicks "Plan view: …" button, then the menu item named `label`); `planAction(page, name)` (clicks a visible link/button with that name if present, otherwise opens "More plan actions" and clicks the menu item).

- [ ] **Step 1: Write `app/e2e/plan-header.spec.ts`** (phone and desktop):
  - The plan page has no `navigation` named "Plan views" strip of 8 links; the button "Plan view: Overview" opens a menu with 8 `menuitem`s named after `PLAN_VIEWS` labels; choosing "Board" goes to `/p/<id>/board` and the button reads "Plan view: Board".
  - Keyboard: focus the picker, Enter opens, ArrowDown twice + Enter lands on Board; Escape closes without navigating.
  - "More plan actions" lists Present, Print summary, Download plan file, Add to calendar, History and Trash; on phones also Status report. On desktop "Status report" is a visible link outside the menu.
  - Choosing "History and Trash" from More goes to `/p/<id>/history` and the picker reads "Plan view: History and Trash".
  - `getByRole("status")` text starts with "Live".
  - Viewer (invite as viewer like `sharing.spec.ts`): no "Update with my AI", More still has Download plan file, header shows "View only".
  - Long title (120 chars) on phone: `document.documentElement.scrollWidth <= innerWidth`.
  - Plan inside a master (reuse `masters.spec.ts` setup): the back link is named after the master.
- [ ] **Step 2:** Run `npx playwright test -c app e2e/plan-header.spec --trace off`; expect failures (no picker).
- [ ] **Step 3: Implement `PlanHeader`.** Row 1: back icon link (name "All plans" or the master's title), `h1`, `HealthChip`, `UpdateOverdue`, connection `role="status"` (icon + text, unchanged wording), presence avatars, "View only"/"Can comment"; master chip below when present. Row 2: picker (Radix DropdownMenu, items are links to `/p/<id>/<view>`, current item `aria-current="page"`), spacer, actions (Update link if `canEdit`, Share link, Report link hidden below `lg`), More menu with groups "Share and report" (Status report below `lg` only, Present, Print summary), "File" (Download plan file, Add to calendar as `<a download>`), and History and Trash.
- [ ] **Step 4:** Replace the header in `PlanPage.tsx`; delete `TABS`.
- [ ] **Step 5:** Add the two helpers; update the listed specs to use them (behavior asserted stays the same).
- [ ] **Step 6:** `npm run e2e -- --trace off` all pass; `npx tsc -p app --noEmit` clean.
- [ ] **Step 7:** Commit "Plan header: view picker, top actions and More".

### Task 3: Slim sticky bar

**Files:**
- Modify: `app/src/pages/plan/PlanHeader.tsx`
- Test: `app/e2e/plan-header.spec.ts` (add a test)

**Interfaces:**
- Consumes: `ActionsRow` with `compact: true` (icon-only, `title` tooltips, same accessible names).

- [ ] **Step 1: Add test "slim bar appears on scroll"** (phone and desktop, a 40-task plan): at the top, `getByRole("region", { name: "Plan bar" })` is hidden and has `inert`; after `window.scrollTo(0, 1200)` it is visible, contains "Plan view: <current>", "Share" and "More plan actions"; on phone its top equals the bottom of the app's top bar (±1 px); its title truncates (`scrollWidth > clientWidth` for the 120-char title case); scrolling back to top hides it; `page.emulateMedia({ media: "print" })` hides it.
- [ ] **Step 2:** Run it; expect failure.
- [ ] **Step 3: Implement.** An IntersectionObserver on the full header's row 2 sets `stuck`; the bar is `position: fixed` (`top-0` on `lg`, under the 56 px phone top bar otherwise), `inert`/`aria-hidden` and `opacity-0` when not stuck, fades with `transition-opacity motion-reduce:transition-none`, `print:hidden`, not rendered while presenting.
- [ ] **Step 4:** Test passes; full `npm run check` and `npm run e2e -- --trace off` clean.
- [ ] **Step 5:** Screenshots (`SHOTS=1`) of every plan view, phone and desktop, light and one dark; check against the spec sketches. Add a "Plan header" entry to `docs/PLAN.md`. Commit "Plan header: slim sticky bar" and push.
