# Plan header redesign (view picker + slim sticky bar)

Date: 2026-11-28. Owner picked approach "G plus H" in conversation.

## Why
The owner finds the visuals messy and wants a streamlined workflow on every platform. On a phone
the plan header (back link, title, status, "Live", 8 equal action buttons in 4 rows, 8 tabs)
pushes the plan's content past the middle of the first screen, and the tab strip cuts off Grid,
Team, Risks and Activity. On desktop the buttons take two rows above the tabs. Everything has the
same weight, so nothing reads as "do this next".

## Goals
- The plan's content starts right under one compact header row, on phone and desktop alike.
- No view is cut off or hidden off-screen; every view and action is at most two taps away.
- The few actions people use most stay one tap away and visible.
- While scrolling, a slim bar keeps the view picker and actions handy.

## Non-goals (this round)
- The Overview's 13 cards and their priority (next project, after this one).
- The master plan page header and Home (may adopt the same pattern later).
- Removing or changing any feature or route.

## Anti-goals
- Hiding daily actions behind menus people never open.
- Layout that jumps or reflows while scrolling.
- Anything that gets worse for keyboard or screen-reader users.

## Approaches considered
- A. One scrolling row of all actions: saves space, but hides most actions off-screen on phones and
  stacks two sideways-scrolling strips.
- B. One main action + "More": cleanest, but Share and Report go behind a tap.
- C. Top 3 actions + "More", tabs still scroll: good, but tabs still get cut off.
- D. Actions moved into the views where they belong: clean header, more to learn.
- E. Phone bottom toolbar: best thumb reach, but phone and desktop differ.
- F. One searchable "Actions" button: scales, hides everything.
- **G + H (chosen):** a view picker replaces the 8 tabs, the top actions sit beside it, the rest go in
  "More"; when scrolled, a slim sticky bar with the same controls appears. Same structure on every
  platform; nothing cut off.

## Design
**Full header (top of the plan page, both platforms):**
```
←  Kitchen Remodel   ● On track · Live
[▦ Checklist ▾]                 [✨ Update with AI] [👥 Share] [📄 Report] [⋯ More]
```
- Row 1: back arrow (icon button named "All plans") to the left of the title; the health chip and a
  small connection indicator ("Live", "Offline", "Reconnecting") on the same line. The offline and
  archived notices stay as they are below.
- Row 2: the view picker on the left, actions on the right.
  - Phone: `[▦ Checklist ▾]  [✨] [👥] [⋯]` (Update and Share are icon-only up to 500px wide, with
    accessible names and tooltips kept; Report goes into More). Below 421px the picker shows
    "History" and "Update" for those two pages, so the whole name fits.
  - Desktop: full labels and Report visible, as sketched above.
- **View picker:** a button showing the current view's icon and name. It opens a menu listing all 8
  views (Overview, Checklist, Board, Timeline, Grid, Team, Risks, Activity), each with an icon and a
  few words ("Board: cards by status"), the current one marked. Choosing one navigates to the same
  URLs as today. Arrow keys, Enter, Escape and type-ahead work; it is announced as the plan's views.
- **More menu**, grouped: Share and report (Status report on phones, Present, Print summary),
  File (Download plan file, Add to calendar), and History and Trash. Items keep today's names.
- Views reached only from More (report, history, share, print, update) still show the picker with
  that page's name, so people always know where they are and how to get back.

**Slim sticky bar (H):**
```
← Kitchen Remodel ●   [▦ Checklist ▾]   [✨] [👥] [⋯]
```
- Appears once the full header has scrolled out of view (watched with an IntersectionObserver),
  fixed at the top on desktop and just under the app's dark top bar on phones.
- Same controls as row 2, icon-only with accessible names and tooltips; title truncated.
- It is a separate bar that fades in (no motion with "reduce motion"), so the page never reflows.
- Hidden when printing and in presentation mode.

**Build notes (my calls, the builder may refine):**
- Menus use `@radix-ui/react-dropdown-menu` (same family as the dialogs already used) for focus,
  keyboard and screen-reader behavior.
- One `PlanHeader` component renders both rows and the slim bar from one list of views and one list
  of actions, so they never drift apart.
- Touch targets stay at least 44 px; colors use the existing tokens (light and dark).
- Browser tests that click tabs or header links move to the picker and More menu; a new test covers
  the picker (mouse, keyboard), More, and the slim bar appearing on scroll, on phone and desktop.
- Screenshots of every plan view on phone and desktop, light and one dark, checked before commit.

## Left to the builder
Exact spacing, the icons chosen per view, tooltip wording, and the scroll threshold.
