# EZPLAN: build plan

## Context
Repo `thecrafthub/ezplan`, branch `claude/project-mgmt-markdown-parser-6ikcpy` (remote still empty; see Status). EZPLAN is a **website** (phone-first, desktop too) that turns any project description into a clear, good-looking, AI-checked plan that people track together. Target users: **any industry** (events, construction, marketing, software, research...), so plain language and visual clarity are requirements. **Built privately (owner only) until fully functional**, then a tester program (bugs, feature requests, customer-led direction), then public as a **monthly subscription**.

After competitor reviews (Asana, Monday, ClickUp, Notion, Smartsheet, Trello, MS Project/Planner, TeamGantt, Todoist, Linear, Wrike), the product includes: a complete AI-free planner (3b), AI Plan Check + status reports, an AI-neutral "write/update your plan with your own AI" round trip (2, 2b), real-time team collaboration, a PM-grade desktop workspace (1b), portfolio of all projects, two complete plans (Personal and Business, no feature tiers), an IT admin console built to win IT (5c), self-serve business onboarding with automatic sales routing (5d), bring-your-own-AI (4b), platform-wide moderation and injection defense (4c), and a maintenance/operations system (11).

**Status (Nov 13)**
| | |
|---|---|
| Done (Phase 0, first pass) | Competitor research doc, unit-economics spreadsheet (+ Enterprise sheet), 10 clickable mockup screens (published design canvas), README. 4 commits, **local only**. |
| Blocked | **GitHub push fails (403):** the Claude GitHub App isn't installed on the repo. Needed before 1a (CI, automated updates, backups of the code). |
| Next | Phase 0 rework (mockups + finance model + research doc catch up with decisions made since), owner approval, then 1a. |
| Reviews | Two full reviews done; fixes are in place, open decisions and risks are in **section 13**. |

## How it works for a user
1. **Get prompt** → paste into **any AI assistant or agent the customer uses** (Claude, ChatGPT, Gemini, Copilot, an in-house agent...) with their project notes → it replies in EZPLAN format. The site never assumes which AI; Claude is only used internally by EZPLAN (Plan Check, status reports, later in-app generation).
2. **Paste/upload** → EZPLAN builds the plan → **AI Plan Check** runs automatically (aligned with the goal? makes sense?) with fixes to accept/reject.
   - No AI? Start from a template, a past project, an import from another tool, or a blank plan (3b). Everything except the AI check works the same.
3. **Invite the team**, assign tasks, track live together on the checklist, timeline, and dashboards.
4. When plans change, **"Update with my AI"** hands the current plan to their assistant and merges the reply back without touching progress (2b).
5. **Share** a read-only link with clients, get **reminders**, generate **status reports**, **export** a `.ezplan` file that keeps tracking anywhere.
6. Every project lives in the **portfolio**, separated by state (Active / Completed / Archived). Any project can be reused as a starting point.

---

## 1. Look and feel of the user's plan (all industries)
Plain language, no code-looking UI. One glance answers "where are we, what's next, are we on track, who's overloaded?"
- **Project dashboard** (each plan's home; the phone version of the desktop Overview in 1b): name, goal, "done when", progress ring, health chip (one set used everywhere: **On track / At risk / Off track / On hold / Complete**, auto-suggested from dates and pace, overridable in a status update), start → finish vs baseline finish, next milestone, overdue count, Plan Check badge + summary, "Up next" tasks, burn-up chart (done vs baseline), team workload snapshot, latest status report.
- **Checklist view**: color-coded phase cards with progress bars. Task rows show status pill (icon + text + color, colorblind-safe), owner avatar, due date, duration chip, "waits on" chip, notes indicator, and for finished tasks a **"Done by Ana · Dec 2"** tag (mockups updated to show this, including Home's "My tasks"). Tap to change status; live cursors/avatars show who's here.
- **Timeline view**: Gantt with phase bands, milestone diamonds, today line, critical path highlight, **baseline ghost bars** showing slippage, week/month zoom, phone scroll/pinch.
- **Workload view**: people × weeks heatmap (hours planned vs capacity), red when overloaded, tap a cell to see the tasks.
- **All-projects dashboard (Home)**: cards for every active project (progress, status, next milestone, overdue, verdict), totals, "My tasks today/this week" across projects, team workload across projects.
- **Portfolio**: **all** projects in one place, with tabs/filters **Active / Completed / Archived** (plus search, owner, date, industry tag). Active cards show live progress + status; completed cards show final stats (planned vs actual duration, on-time %, Plan Check score). A project moves to Completed automatically when all tasks are done (or manually), and can be reopened. "Start new project from this one" works on any project: it copies the structure, clears progress and dates, and runs a Plan Check. The Home dashboard is the at-a-glance view of the Active part of the portfolio.
- **Design system**: Tailwind + tokens, Radix UI primitives, Lucide icons, system fonts, light/dark, WCAG AA, 44px tap targets, keyboard nav, reduced motion. Charts follow the dataviz skill (validated colorblind-safe palette, consistent light/dark).
- **Phase 0 = clickable mockups** for approval before backend work; the full list of screens is in the phase 0 row of section 9. (Already-built mockups predate later decisions: New plan copy still says "Claude", Desktop and Admin screens are first drafts; all three get reworked.)

## 1b. Desktop project workspace (built for real project management)
Inspired by MS Project / Smartsheet (grid + Gantt), Monday / Wrike (dashboards), Asana / Linear (status updates, milestones) and PM practice (RAID logs). Layout: **left** plan outline (phases/tasks tree, search, filters) · **center** switchable views · **right** task detail drawer · top bar with project health, view switcher, share/export, presentation mode.

**Views (center)**
| View | What a project manager gets |
|---|---|
| **Overview dashboard** | KPI row: % complete, **schedule variance** (days vs baseline), **forecast finish**, **budget variance**, overdue, open risks/issues, Plan Check score. Milestone strip (diamonds with on-time/late status). Critical path list with slack. Two-week lookahead. Team workload snapshot. Budget chart (planned vs actual). Burn-up vs baseline. Latest status update. Recent activity. **Customizable widgets** (add/remove/rearrange; saved per user, company default per workspace). |
| **Grid + Gantt (split)** | Spreadsheet-style table on the left (ID, task, owner, status, start, finish, duration, % done, predecessors, cost, baseline variance, tags; resizable/hideable columns, inline editing, bulk edit, sort/group) synced with the Gantt on the right (drag bars, draw dependencies, baseline ghosts, critical path, slack, today line, zoom day→quarter, what-if). |
| **Board** | Columns by status, owner or phase, drag to move. |
| **Calendar** | Month/week with tasks and milestones. |
| **Workload** | People × weeks capacity heatmap with drag-to-reassign. |
| **RAID log** | Register of **Risks** (likelihood × impact, owner, mitigation, linked tasks), **Assumptions**, **Issues** (severity, owner, due), **Decisions** (who, when, why). Risk heat map. Items link to tasks and show on the dashboard. Plan Check risk flags can be promoted into the RAID log with one click. |
| **Status updates** | Weekly (or milestone-triggered) updates with a **red/amber/green** rating, auto-filled from data (done, slipped, next, risks, forecast; AI polish optional), edited, then posted to the project, emailed to stakeholders and kept in a history timeline. Reminder to the PM when an update is due. |
| **Changes** | Change log of scope/date/budget changes vs baseline (who, when, why), approvals for changes when the project requires them. |

**Deeper research → design decisions (sources in `docs/research/competitors.md`)**
| What others do / what users complain about | EZPLAN decision |
|---|---|
| Asana's Overview tab is the project hub: brief, key resources, milestones, chronological status updates; health = on track / at risk / off track / on hold / complete; updates roll up to portfolios | Overview gets a **project brief + key resources** (links, docs) block, a **status history panel**, and the full health set incl. **On hold** and **Complete**; updates roll up to the portfolio dashboard |
| Linear: project updates auto-include a summary of what changed since the last update (issues done, milestone progress, target-date and lead changes); gray "no update" marker when an update is missing; progress graph predicts finish vs target date | Status updates **auto-fill "what changed since last update"** (tasks done, milestone %, date/owner/scope changes); **"update overdue" gray marker** on project and portfolio; forecast-vs-target graph on the dashboard |
| Smartsheet: all four dependency types with lag + critical path, but **only one baseline per sheet, and baselines don't show in dashboards, reports or print**; resource management is a separate paid add-on (~$19/user) | **Multiple baselines**, shown in dashboards, PDF and print; **workload/resource view included** for everyone |
| Microsoft Planner: critical path, baselines, lead/lag, portfolios only in the $30/user Plan 3; Timeline is a lightweight Gantt; AI needs a paid Copilot add-on | All of these included in EZPLAN Business (and Personal where relevant); full Gantt; AI-free features complete without any AI add-on |
| Common complaints: Gantt "falls apart" when a task shifts, slows down past ~200 linked tasks; no portfolio Gantt (Wrike); PDF export and printing big Gantts are painful; budget reports gated | **Performance target: smooth Gantt at 2,000+ tasks** (virtualized rendering, incremental rescheduling); every reschedule previewed (what-if) so nothing "jumps"; **portfolio timeline across projects**; **fit-to-page and multi-page poster PDF/print** of the Gantt; budget reports included |
| Users ask for a **single-page status report** (owner, color-coded milestone chart, issues, risks, budget vs actual), **dashboards they can send** to stakeholders like reports, and an exec view for big screens | **One-page status report** export (PDF/link) with exactly those blocks; **scheduled dashboard emails/PDFs** to stakeholders + live share link; **presentation / TV mode** |
| monday.com: drag-and-drop dashboards (30 to 50+ widgets, incl. workload "battery"), non-technical users build them in minutes; ClickUp has the widest choice of dashboard cards | **Widget library**: KPI number, progress ring, milestone strip, burn-up/forecast, budget vs actual, cost by phase, workload battery/heatmap, RAID heat map, overdue list, two-week lookahead, latest status update, activity feed, Plan Check, custom chart (group by any field), text/notes, link embed. **Dashboard templates by role**: Project manager, Executive, Team member, Client |
| Asana's ChatGPT app can **create** projects from a chat, but **updating an existing plan from a chat is a gap**, and these integrations are tied to one AI vendor's app | EZPLAN's **"Update with my AI"** (section 2b) works with **any** assistant by copy/paste or via MCP/API, and preserves progress: a differentiator to highlight in marketing |

**Task detail drawer (right):** description, subtasks, dependencies (with type/lag), dates and constraints, estimate vs logged time, cost planned vs actual, approvals, comments and @mentions, links/files, activity history ("Done by", edits), linked risks/issues.

**Also on desktop:** keyboard shortcuts everywhere, command bar (Ctrl/Cmd+K), multi-project **portfolio dashboard** (all projects' health, milestones, resource conflicts across projects), **presentation mode** for stakeholder meetings (clean full-screen dashboard + timeline), printable/PDF stakeholder report.

## 2. The EZPLAN format (AI output and `.ezplan` files)
```markdown
---
ezplan: 1
id: 7f3a
title: Spring Charity Gala
goal: Host a 200-guest fundraising dinner raising $50k.
done_when: Event held, $50k raised, thank-you notes sent.
start: 2026-12-01
team: Sam <sam@co.com>, Ana <ana@co.com>
baseline_set: 2026-12-01
---

## P1: Venue and budget
> Lock the basics before anything else.

- [x] T1: Set budget (2d) @Sam done: 2026-12-02 by Ana
- [/] T2: Book venue (1w) @Ana due: 2026-12-10 depends: T1
  planned: 2026-12-03 → 2026-12-09
  notes: Two venues hold the date; deposit due Friday.
  - [x] Shortlist 3 venues
  - [ ] Sign contract
- [ ] M1: Venue confirmed (milestone) depends: T2
```
- Status `[ ]` to do, `[/]` in progress, `[x]` done, `[-]` skipped. `@Owner`, `due:`, `depends:`, estimates `h/d/w`, `(milestone)`, `planned:` = baseline dates, `notes:` lines, `done:` dates.
- **Completion attribution:** `done: <date> by <Name>` records who marked the task complete, which can differ from the owner (`@Sam` owns it, Ana ticked it). Same for skipped: `skipped: <date> by <Name>`. Moving a task back out of Done clears it.
- Everything needed for tracking lives in the file, so it round-trips: export, edit anywhere, re-import.
- **Format coverage for later features (spec v1 must reserve these so files stay compatible):** `!priority`, `#tags`, `cost: planned/actual` (with front-matter `currency:`), dependency types/lag (`depends: T1 SS+2d`), constraints (`start_after:`, `finish_by:`), `recurring:`, `approval: <Name>`, multiple baselines (`baseline "Original": start → finish`), and an optional `## RAID` section (risks, assumptions, issues, decisions). Comments, time logs and activity stay **app-only** (too noisy for a portable file); the export says so in a footer comment. Unknown keys from newer versions are preserved, not dropped.
- **Get prompt** (`shared/prompts.ts`): industry-neutral and **AI-neutral** (plain instructions any assistant follows, no vendor-specific syntax), includes spec + example. Helper prompts: Re-plan / What's next / Break down. Site copy says "your AI assistant", never a vendor name; no default or featured AI. Also published as a plain spec page (`/format`) so agent builders can target the format directly.
- **AI-neutral parsing:** the parser tolerates the ways different AIs format output: code fences or none, `*`/`-`/`+`/numbered bullets, `[X]`/`[ ]`/`☐`/`✅` checkboxes, smart quotes, bold/italic task titles, extra intro/outro chatter, CRLF line endings, "T1." vs "T1:", estimates like "2 days"/"2d"/"16 hrs", tables converted when obvious. Anything it can't read is shown with a friendly line-level fix hint.

## 2b. Update the plan via your AI (round trip)
For when new features, steps, ideas or goals came up in the user's original AI chat (any assistant or agent).
1. In an existing plan: **"Update with my AI"** button → EZPLAN builds an **update prompt** containing: the current plan in EZPLAN format with stable IDs, current status of every task (done / in progress / skipped, done dates), schedule and forecast, open risks, the plan's version tag (`based_on: v42`), and clear instructions: *incorporate the new information from this conversation; keep every existing ID; don't change progress; give new items new IDs; mark removals explicitly; reply with the full updated plan in EZPLAN format plus a short "what changed and why" list*.
   - Options before copying: "Include what changed since [date]", **"Hide names and emails"** (owners replaced by roles like "Owner A" for privacy; mapped back on return). Business admins can set a policy (allow / require redaction / disallow sending plan content to external AI).
2. User pastes it into their AI chat (where the new ideas live) → gets the reply.
3. User pastes/uploads the reply → EZPLAN matches tasks **by ID** and shows a **change preview**: added phases/tasks, edited fields (estimate, dates, owner, dependencies, goal, "done when"), moved tasks, removals, plus the AI's "what changed and why". Accept all, or accept/reject per change.
4. **Safe merge rules:**
   - Progress and history always come from EZPLAN: statuses, "Done by", dates done, comments, time logs and approvals can't be changed by the reply (a status change in the reply is shown as a suggestion only).
   - Tasks missing from the reply are **kept** by default ("3 tasks weren't in the reply: keep / remove").
   - Removals require confirmation. Done tasks can't be removed, only archived.
   - If the plan changed in EZPLAN since the prompt was generated (version tag), a 3-way merge keeps both sides and highlights conflicts.
   - A new baseline is offered ("Save the old plan as baseline 'Before update Nov 12'?") so the change shows on the timeline.
5. After applying: schedule recalculates, free Plan Check (and AI check if on) re-runs, a change-log entry is recorded (who applied what, from which update), and teammates see the update live.
- Same pipeline as every import: validate → sanitize → moderate → preview → save (section 4c), and the parser also accepts a shorter **change-list format** (`ezplan-update: 1` with add/edit/move/remove lines) for agents that prefer patches.
- Also available through the connector/API (phase 3): an agent can fetch the update prompt/context and submit the reply directly, still landing in the preview for a human to accept.
- **Phasing:** 1a (basic round trip with preview + safe merge); 1b (live teammates, redaction option, conflict merge); 1c (admin policy, change-list format).

## 3. Parsing, checks, scheduling (`shared/`)
- `parse.ts` strict + tolerant modes, friendly line errors, strips any AI's fences/chatter. `export.ts` (`.ezplan`, `.ics`). `schema.ts` (zod).
- `checks.ts` free instant checks (IDs, loops, estimates, empty phases, unknown owners).
- `schedule.ts`: dates, critical path, baseline variance, suggested health (On track / At risk / Off track), workload per person/week (estimate hours spread over scheduled working days, capacity default 40h/week, editable per member).

## 3b. Planning without AI (a complete planner on its own)
Principle: **every core planning job works with AI turned off**: free plan, a company that disables AI, a failed BYOK key, offline, or a customer who doesn't want AI. AI only adds judgment and nicer wording on top. These features cost ~nothing to run (no per-use AI cost), so they're never capped, and they're included in both Personal and Business.

**Creating plans without AI**
- Blank plan, **industry starter templates** (event, renovation, product launch, hiring, research, move, wedding, construction job, marketing campaign), "start from a past project", personal and company **template libraries**.
- **Imports from other tools** (migration path to win customers): CSV/Excel with column mapping and saved presets for Asana, Trello, Monday.com, Smartsheet, ClickUp exports, plus MS Project XML; `.ezplan`/`.md` checklists.
- **Quick-add with plain-text shortcuts** (deterministic, no AI): typing `Book venue 3d @Ana due Fri after T1 #venue !high` creates the task with estimate, owner, due date, dependency, tag and priority. Works on phone.
- Full editor: drag to reorder tasks and phases, indent for subtasks, multi-select bulk edit (owner, dates, status, tags), undo/redo, keyboard shortcuts.

**Scheduling engine (`shared/schedule.ts`, deterministic)**
- Auto-schedule from estimates + dependencies; dependency types finish-to-start, start-to-start, finish-to-finish, with lag/lead ("+2d").
- Constraints: "start no earlier than", "must finish by", fixed-date tasks, deadlines with warnings.
- **Working calendars**: workdays, company and country holidays, per-person time off and part-time capacity.
- Critical path + **slack/float** ("can slip 3 days without delaying the finish").
- **What-if mode**: drag a task or change an estimate on the timeline, see the ripple (new finish date, affected people) highlighted, then Apply or Cancel.
- **Multiple baselines** (e.g. "Original", "After scope change") and comparison.
- **Rule-based re-plan**: shift remaining work from a new start date, re-level workload across people with spare capacity, or compress to hit a deadline by showing which tasks to overlap. All previewed before applying.

**Free Plan Check (always runs, instant)**
- Completeness: goal, "done when", owners, estimates, dates, milestones present.
- Structure: dependency loops, orphan tasks, empty phases, tasks scheduled after the deadline, milestones without predecessors.
- Risk flags: unassigned critical-path tasks, one person owning most of the critical path, overloaded weeks, very long tasks without subtasks ("consider breaking this down"), many tasks due the same day, tasks waiting on overdue work.
- A deterministic **health score** with plain-language fixes. The AI check, when on, adds judgment on top (alignment with the goal, missing steps).

**Tracking and forecasting (no AI)**
- Status auto-flags from dates (late, at risk), progress roll-ups weighted by estimate, burn-up vs baseline.
- **Forecast finish date from actual pace** ("At the current pace you'll finish Mar 20, 6 days late").
- **"What's next" ranking**: unblocked tasks ordered by critical path, due date, priority, owner availability.
- **Template status report**: an automatic weekly summary (done this week, slipped, coming up, blockers, milestones, forecast) built from data. AI, when on, only polishes the wording.
- **Budget and cost tracking**: planned vs actual cost per task and phase, totals and variance (essential for events and construction).
- **Simple time logging**: hours logged vs estimate, feeding better estimates on future projects ("your team's renovation tasks run 20% over").

**Collaboration and workflow**
- Comments with @mentions, watchers, activity feed per task and project.
- **Approvals/sign-off**: a task can require approval from a named person before it counts as Done (logged with "Approved by").
- **Recurring tasks** for ongoing work (weekly check-ins, monthly reports).
- Priorities, tags/labels, links on tasks (file attachments later, sized against storage costs).
- Rule-based notifications and reminders (due soon, overdue, assigned to you, mentioned, approval needed).

**Views and outputs**
- Checklist, Timeline, **Calendar view** (month/week, good for non-technical users), Workload, Dashboards; an optional **Board view** (columns by status, owner or phase) for people used to Trello.
- Filters, search, saved views, "My work" across all projects.
- Exports without AI: printable **one-page client summary / PDF**, timeline image, CSV, `.ezplan`, `.ics`, plus a **live calendar feed URL** (subscribe in Google/Outlook/Apple calendar).
- Optional notifications into **Slack / Microsoft Teams** channels via webhooks.
- **Full offline editing** on phone and desktop, synced when back online.

**Phasing**
- **1a:** editor + quick-add, templates + start from past project, scheduling (finish-to-start, workdays, critical path, slack), free Plan Check + health score, status flags + forecast, "What's next" ranking, template status report, calendar view, printable summary.
- **1b:** time off + part-time capacity + holidays, rule-based re-leveling, comments/mentions/watchers/activity, approvals, recurring tasks, template libraries, offline editing.
- **1c:** imports from other tools, budget/cost tracking, time logging, what-if mode, multiple baselines, extra dependency types + constraints, live calendar feed, Slack/Teams webhooks, Board view.

## 4. AI features (Claude via `@anthropic-ai/sdk`, metered per user)
| Feature | Model | Approx. cost |
|---|---|---|
| Plan Check (auto on every plan / plan change) | `claude-haiku-5-5`; "Deep check" `claude-sonnet-5-5` | $0.001 to $0.005 / $0.02 to $0.05 |
| Status report (one tap: progress, slips vs baseline, risks, next steps; editable, shareable, saved in history) | `claude-haiku-5-5` (Deep option) | ~$0.001 to $0.005 |
- `messages.parse` + `zodOutputFormat`, effort `medium`, `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) on Sonnet/Opus, refusal/max_tokens/typed errors handled. `usage` table + monthly **fair-use caps per person** (not feature tiers; packs available; lifted for BYOK); free deterministic checks always shown.
- **Engine abstraction from day one (1a):** every AI call goes through `worker/src/ai/engine.ts` (`review`, `report`, `moderate`, later `generate`) with one adapter (Anthropic) at first, so BYOK in phase 2 only adds adapters and nothing is rewritten.

## 4b. Bring your own AI (BYOK)
- **Business (optional, included):** managed **only in the IT admin console → AI settings** (see 5c) by Owners/Admins; employees never handle keys. Also offered as an optional OOBE step ("Which AI should EZPLAN use?", skippable). Default stays EZPLAN's built-in AI. Supported at launch: Anthropic, Microsoft Azure OpenAI, Amazon Bedrock, Google Vertex AI, plus any OpenAI-compatible endpoint (self-hosted, "best effort"). Fair-use caps lifted for that company, no price discount. If their key fails, AI features **pause with a clear admin message** (no silent fallback to our AI, which could break their data rules); everything non-AI keeps working.
- **Personal (paid add-on, monthly fee, placeholder ~$2 to $3/mo):** same provider list, caps lifted. The fee covers support, key handling and moderation costs (moderation for Personal always runs on EZPLAN's own classifier, see 4c).
- **Adapters:** built on the 1a engine interface (section 4). Our default adapter uses `@anthropic-ai/sdk`; others use their official SDKs. Providers without schema-constrained output get JSON mode + zod validation + one retry. A provider is labeled "verified" only after passing our fixture evaluation (same sample projects, scored Plan Checks).
- **Key security:** keys encrypted at rest (envelope encryption: per-org data key, master key in Cloudflare secrets), write-only (never displayed after saving), "Test key" button, key add/change/remove in the audit log, failure and expiry alerts to admins (ties into section 11 monitoring), outbound calls only to the configured provider endpoint.
- **Phasing:** Business BYOK with phase 2 (in-app AI), Personal BYOK add-on at launch (phase 4).

## 4c. Moderation and prompt-injection defense (whole platform, from phase 1a)
Goal: nobody can use EZPLAN (our AI, their own AI, or plans written elsewhere) to build or share harmful plans, and text inside plans can never take control of our systems.

**Policy**
- Acceptable Use Policy + Terms (no plans for violence, weapons, terrorism/extremism, child exploitation, fraud/scams, hacking/malware, illegal drugs/trafficking, harassment/doxxing, self-harm encouragement, evading law enforcement). Shown at signup and linked in the app.

**Content screening (every plan, any source)**
- Runs on import, paste, file upload, connector/API import, and on edits (only the changed text, to keep cost tiny), plus on AI outputs we show or share (status reports, revised plans).
- Two layers: (1) instant free checks (keyword/pattern lists, known-bad hashes); (2) an AI classifier with a structured verdict (`allow | review | block`, category, reason) using `claude-haiku-5-5` (~$0.001 per check). A refusal (`stop_reason: "refusal"`) from any of our AI calls is also treated as a moderation signal.
- **BYOK can't be used to switch moderation off** (a customer-controlled AI endpoint could simply answer "allow"):
  - Our free checks always run on our side, for everyone.
  - **Personal BYOK:** the AI classifier is always EZPLAN's own.
  - **Business BYOK:** content that stays **inside the company** is classified through their provider (so their data rules hold), and the company is contractually responsible for its members' use. Anything that **leaves the company** (share links, public pages, emails or invites to outsiders, guests' views) is always classified by EZPLAN's own classifier first; this is stated in the DPA, and a company that can't accept it turns external sharing off by policy.
- Stricter screening for anything visible to others: share links, public pages, emails, invites.
- **Privacy note:** Trust & Safety review of a flagged excerpt is the one disclosed exception to "staff can't see customer data" (stated in Terms and DPA); reviewers see only the excerpt and category, not the whole plan.

**`.ezplan` file imports (every entry point, one shared pipeline)**
- Entry points covered: upload button, drag and drop, paste, desktop "open with EZPLAN" (`file_handlers` / `launchQueue`), Android share target, re-import/merge of an existing plan, bulk/zip import, connector/API import, `.ezplan.md` and plain `.md`. All go through `shared/importPipeline.ts`: **validate → sanitize → parse → moderate → preview → save**. Nothing is stored or shown to others before it passes.
- **File safety:** size limit (e.g. 1 MB per file; zip max 100 files / 20 MB uncompressed, zip-bomb ratio check), text/UTF-8 only (binary rejected), line, task and nesting limits (no denial-of-service via huge or deeply nested files), only known front-matter keys accepted with length limits, HTML/script tags, `data:`/`javascript:` links and zero-width/control characters stripped or flagged.
- **No trust in file claims:**
  - Front-matter `id` can only update a plan **the importer can already edit**; otherwise it's saved as a new plan (a file can't overwrite someone else's plan).
  - `team:` emails and `@Owner` names never auto-invite or grant access; they become **suggestions the user confirms**.
  - `done: … by <Name>` and dates from a file are shown as **"from file"** unless they match an existing verified event; the audit log records the import itself, so files can't forge "Done by" history or impersonate a teammate.
- **Preview before save:** opening a `.ezplan` file (especially one received from someone else) shows a read-only preview with the moderation result and any warnings ("this file contains instructions aimed at AI assistants; they were removed") before the user saves it.
- **Injection-safe:** imported notes/titles go through the same injection detection and are always treated as data by our AI (see below).
- **Export side:** exports escape content so a downloaded file can't attack whoever opens it next. CSV exports (chargeback, audit, people) neutralize spreadsheet formula injection (cells starting with `=`, `+`, `-`, `@` are prefixed).

**Enforcement**
- `block`: import refused with a plain explanation and AUP link. `review`: plan saved privately but sharing/export/AI paused until reviewed. Repeat or severe: account suspended.
- Severe categories (e.g. child sexual abuse material, credible threats of violence): immediate block, evidence preserved, reported as legally required (e.g. NCMEC in the US). Runbook in `docs/runbooks/`.
- **Trust & Safety queue** in the owner admin (`/admin/ops/safety`): flagged items (only the flagged excerpt stored), decision buttons, appeal handling. Business org admins see moderation events about their users in their audit log.
- Appeals: user can request review from the block message; outcome emailed.

**Abuse prevention**
- Cloudflare **Turnstile** (free CAPTCHA) on signup, login, share-link and public endpoints.
- Per-account and per-IP rate limits on imports, AI calls, invites, share links and emails (spam protection), with alerts on spikes (section 11).

**Prompt-injection defense (our AI must never be steered by plan text)**
- **Plan text is data, never instructions:** wrapped in clearly delimited data blocks with a random per-request marker; system prompt states that everything inside is untrusted content to evaluate, not obey.
- **Least privilege:** our AI calls have **no tools, no internet, no access to other plans, users or orgs**: only the single plan being checked. Worst case of a successful injection = a wrong review of the attacker's own plan.
- **Structured outputs only:** responses must match a strict schema; anything else is discarded. AI-suggested plan changes are parsed by our own parser, shown as a diff, and **never applied without the user accepting**.
- **Output safety:** all user and AI text rendered as plain text (no raw HTML or scripts), links shown with their real domain and limited to http/https, emails escape content, `.ezplan` exports can't carry executable content.
- **Injection detection:** free pattern checks + the moderation classifier flag text aimed at AIs ("ignore previous instructions", hidden/zero-width characters, fake system messages); flagged text is neutralized in what we send to the AI and noted in the review.
- **Connector/API:** scoped per user, can only create/update that user's own plans, same moderation path, rate limited; tool responses never include secrets or other users' data.
- **Ongoing:** an injection + harmful-plan test set runs in CI against Plan Check, reports and moderation (for our default model and each "verified" BYOK provider).

## 5. Teams and real-time collaboration
- **One roles model, three levels** (replaces separate role lists elsewhere): **organization roles** (Owner, Admin, Department admin, Helpdesk, Billing admin, Auditor, Member, Guest; Business only), **workspace roles** (Manager, Editor, Viewer), **project roles** (Owner, Editor, Commenter, Viewer; used for Personal collaborators and guests). Effective permission = the highest grant, except Guests never exceed project scope. One `permissions.ts` checks everything, server-side.
- **Workspaces**: `workspaces`, `members(workspace role, weekly_capacity_hours)`. Plans belong to a workspace (Personal accounts get one private workspace automatically). Invite by email (while the build is private, any invitee, e.g. the owner's own test accounts, must also be on the Cloudflare Access list; README explains).
- **Live editing**: one Durable Object per plan (`PlanRoom`, SQLite storage, WebSocket hibernation; free plan). Clients send small operations (set status, edit field, add/move/delete task, set owner, notes). The room applies them with per-field last-write-wins + version numbers and broadcasts to everyone. Presence avatars, "Ana is editing T2" hints. Offline edits queue and replay on reconnect.
- **Nothing is lost by accident:** deletes are soft (tasks and projects go to a **Trash**, restorable for 30 days); an offline edit to a task someone else deleted restores it and flags it for review; an automatic **plan version** is saved before every bulk change (import, AI update, re-plan, bulk edit) and can be restored from **Version history**.
- The room writes debounced snapshots to D1 for dashboards, portfolio, search, reminders. An activity log ("Sam completed T1") feeds dashboards and status reports.
- **Assignees** map to members; "My tasks" filters everywhere.
- **Who completed it:** every status change to Done (or Skipped) stores `completed_by` (user id + display name) and `completed_at`, set **server-side by the PlanRoom from the authenticated user**, never trusted from the client. Shown on the task row ("Done by Ana · Dec 2"), in the activity log, status reports, share links and exports. Reverting a task clears both fields (the activity log keeps the history).
- **Edits from outside EZPLAN:** if a re-imported `.ezplan` file has a task ticked `[x]` with no `by`, it is attributed to the person who imported it, labeled "via file import". A `by <Name>` already in the file is kept and matched to a member when possible.

## 5b. Organizations and IT administration (company-wide licenses)
Goal: a 200-person company's IT team can run EZPLAN for all employees without contacting us.
- **Data model (built in phase 1b, so nothing needs migrating later):** `organizations` (company account: name, verified domains, plan, seat count, policies) → `workspaces` (teams/departments) → `members`. Every person has an **immutable user id**; email is just an attribute, so emails can change without losing history, task ownership, or "Done by" tags. Roles follow the single model in section 5.
- **Admin console** (`/admin`): fully specified in **section 5c** (people, bulk changes, offboarding, licenses, domains, policies, audit log, AI settings). Rules that apply across it:
  - **Seats and sync:** if directory sync brings in more people than there are seats, the extra people are created **unlicensed** (they can't sign in yet) and admins are alerted; an admin can turn on "add seats automatically" (prorated) to avoid this.
  - **Guests are for outsiders only:** anyone whose email is on the company's verified domain can't be added as a free Guest (prevents buying 5 seats and adding 195 "guests"); guests are limited to the projects they're invited to and expire by policy.
  - **Directory is the source of truth when sync is on:** name, email and department are read-only in the console for synced users (changed in the company directory instead); manual edits apply only to manually added users.
  - **Domain capture never takes personal work:** when a company verifies a domain, existing personal accounts on that domain are asked to either join the company (choosing which projects to bring) or switch their personal account to another email. Personal projects are never moved without the user's consent.
  - **Email change:** the old address keeps working until the new one is verified; everything stays linked to the same user id.
- **Enterprise identity (at public launch), two tracks behind the same `getUser()` seam, chosen per organization (`organizations.identity_provider`):**
  - **Direct (default, $0 per company), built by us:**
    - **Sign in with Microsoft**: one multi-tenant Microsoft Entra app (OpenID Connect, `organizations` endpoint, verified with `jose` like the private-build login). A company's IT admin grants one-time admin consent; employees then sign in with work accounts. The org is matched by Entra tenant id + verified domain. We complete **Microsoft publisher verification** (some companies block unverified apps).
    - **Sign in with Google**: Google OIDC, company matched by the Workspace `hd` (hosted domain) claim + verified domain.
    - **Automatic employee sync via our own SCIM 2.0 endpoint** (`/scim/v2/Users`, `/scim/v2/Groups`, per-org bearer token generated in the admin console): Entra, Okta, JumpCloud and OneLogin push hires, leavers (deactivate + transfer flow), and email/name/department changes. Entra provisioning requires the customer to have Entra ID P1 (confirmed by Microsoft's licensing docs: included in Microsoft 365 Business Premium, E3, E5, E7, F1, F3 and EMS E3/E5; not listed for Business Basic/Standard, which use the Graph fallback below).
    - **Fallback sync without P1**: scheduled Microsoft Graph read of the company's users (admin-consented `User.Read.All`) via a Cron Trigger, with the same add/deactivate/update logic.
    - **Google Workspace sync**: scheduled read of the company's users through Google's Directory API (admin-consented, read-only). Assumption to verify when built: Google only pushes automatic provisioning to apps in its own catalog, so a scheduled read is the dependable route until EZPLAN is listed there.
    - Scheduled syncs run at least hourly, plus a **"Sync now"** button; because they aren't instant, the offboarding wizard and "sign out everywhere" remain the immediate way to cut off a leaver.
    - **Sign in with any OIDC company identity system** (Okta, JumpCloud, OneLogin, Auth0, Keycloak, etc.): the same OpenID Connect code with a per-company configuration (issuer URL, client ID/secret entered in the setup wizard, with step-by-step guides per provider). Still $0 per company.
    - Ordinary individual accounts (no company) use email one-time codes (sent via Resend) plus Sign in with Microsoft/Google, replacing the private build's Cloudflare Access login.
  - **WorkOS (only for companies whose sign-in needs SAML or an identity system we don't support directly):** e.g. Microsoft ADFS, Ping, SAML-only setups. WorkOS SSO + Directory Sync (~$125 + ~$125 per company per month), with its self-serve IT setup portal. **Company size never triggers it**: a 2,000-seat Microsoft company uses the free direct track. Those companies are routed to specialized pricing (5d) so the quote covers the WorkOS cost. WorkOS events map onto the same org/user/deactivate logic as our SCIM endpoint, so both tracks behave identically in EZPLAN.
- **Pricing shape this implies** (finalized with real data): **Personal** (free with usage limits + one Personal price, all personal features) and **Business** (one per-seat price, all business features: admin console, domains, CSV, audit log, Microsoft/Google sign-in, SCIM sync, API), plus two optional extras for Business: the self-serve **Enterprise Security** add-on (SIEM streaming, legal hold, IP allowlist, extended retention, approval workflows for support access, SOC 2 trust pack) and a quoted **Custom sign-in (SAML)** connection. See 5c.
- **Build timing:** org data model, roles, admin console core in **phase 1b**, tested by the owner with test companies. Domain verification and policies in **1c**. Company sign-in, sync and billing in **phase 4**.

## 5c. Admin console built to win IT admins
**Why IT would pick EZPLAN:** competitors lock the essentials behind top tiers (Asana: SSO, SCIM and the Audit Log API are Enterprise / Enterprise+). Their consoles are slow, one-user-at-a-time and unforgiving. EZPLAN's promise to IT: **everything in bulk, previewed before it happens, undoable, automated from your directory, provable in an audit, and all included in EZPLAN Business.**

### Design principles
1. **Zero-touch by default:** directory sync, domain capture and group mapping mean IT rarely opens the console.
2. **Bulk first:** every action works on 1 or 1,000 people (select-all with filters, CSV, or API).
3. **Preview, then undo:** every bulk change shows a dry run ("47 people will be moved, 3 skipped because…"), and most changes can be undone for 24 hours.
4. **Plain-language impact:** every setting says what it does to users ("Employees will no longer be able to create public links. 12 existing links will be turned off.").
5. **Fast:** a search-everything command bar (Ctrl/Cmd+K: people, groups, projects, settings, audit events), keyboard shortcuts, saved filtered views, works on a phone for urgent actions (deactivate someone at 11pm).
6. **Provable:** immutable audit log for everything, exportable and streamable to the company's security tools.

### Screens
| Screen | What IT gets |
|---|---|
| **Overview** | Health at a glance: seats used / available / reclaimable, sync status, sign-in status, open alerts, **Security checklist** with a score (domain verified, sign-in method enforced, sync on, guests restricted, public links policy, 2+ admins, admin MFA), adoption (weekly active users by department), pending approvals |
| **Setup wizard** | Guided first-day setup with progress bar and time estimates: verify domain (copy-paste DNS record + "check now") → connect Microsoft / Google / Okta (step-by-step screenshots, "test connection") → map directory groups to workspaces and roles → choose seat rules → set policies → invite or sync everyone. Can be handed to a colleague via a secure setup link. |
| **People** | Fast table (filters: department, role, status, last active, seat, source = directory/manual/guest; saved views). Bulk actions: assign/unassign seat, change role, move workspace, resend invite, deactivate, export. Per-person panel: profile, email change, role, workspaces, projects owned, open tasks, sessions, recent activity, "sign out everywhere". |
| **Bulk import and changes** | CSV import with column auto-matching, row-by-row validation and dry run; **domain migration** (company rebrand: change every `@old.com` to `@new.com` in one previewed step, history preserved); bulk update by CSV (departments, managers, roles). |
| **Offboarding** | Wizard and directory-triggered: deactivate (or schedule for their last day) → sign out all sessions → transfer open tasks and owned projects (default: their manager from the directory, or pick per project) → turn off share links they created → optional data export → seat freed. Handles leavers in bulk. "Orphaned projects" report catches anything left behind. |
| **Groups and access** | Directory groups (Entra/Google/Okta) mapped to EZPLAN workspaces and roles, e.g. "Entra group *Construction-PMs* → workspace *Field Ops* as Editor". Changes in the directory flow in automatically. Manual groups for companies without sync. |
| **Roles and delegation** | Built-in roles: Owner, Admin, **Department admin** (manages only their workspaces), **Helpdesk** (view people, resend invites, sign users out, no settings/billing), Billing admin, Auditor (read-only audit log and reports), Member, Guest. Custom roles later. |
| **Licenses and billing** | Seats purchased / assigned / available, **auto-reclaim inactive seats** (e.g. no sign-in for 60 days → notify, then free the seat; configurable), seat forecast, true-up preview, **cost by department** for internal chargeback (CSV), invoices, PO numbers, payment method or invoice billing. |
| **Guests** | All outside collaborators in one list: who invited them, which projects, last active, **expiry dates** (auto-remove after N days), approve/deny guest invites per policy. |
| **Security and policies** | Sign-in method required (work account only / SSO only), session length and idle timeout, admin MFA requirement for non-SSO logins, public share links on/off/approval, guest rules, AI features on/off and monthly caps per person or department, data retention for completed/archived projects, file export restrictions, **IP allowlist** (Enterprise Security add-on). Every policy shows its impact before saving. |
| **Audit log** | Immutable, tamper-evident (hash-chained) log of sign-ins (incl. failed), admin actions, permission changes, exports, policy changes, sync events, support access. Search and filters, saved queries, CSV export, 1 year retention. Enterprise Security add-on: longer retention and **streaming to the company's SIEM** (HTTPS webhook / Splunk / Microsoft Sentinel / Datadog formats). |
| **Data and compliance** | Full organization export (JSON + `.ezplan` files + CSV), per-user export and deletion (GDPR/CCPA requests), **legal hold** (Enterprise Security add-on: prevent deletion for named users/projects), project ownership report, downloadable **trust pack** for procurement (security overview, data processing agreement, list of subprocessors, uptime history, later SOC 2 report). |
| **Support access** | **Baseline for every customer (Personal and Business):** EZPLAN staff can't see customer data unless the customer grants **time-limited** access (e.g. 2 hours, specific project); every access is logged (in the audit log for Business) and revocable. The Enterprise Security add-on adds approval workflows for grants and stricter controls. |
| **AI settings** | The only place a business sets AI: **EZPLAN built-in AI** (default) or **"Use our own AI"** (Anthropic, Azure OpenAI, Bedrock, Vertex, OpenAI-compatible). Add/replace key (write-only, encrypted, "Test key"), choose model per feature (Plan Check, status reports, generation) from the provider's verified list, see provider status and last error, AI on/off per workspace or department, usage by department, key change history (audit log), expiry/failure alerts to admins. Restricted to Owner/Admin roles (Department admins can only toggle AI for their workspaces); employees never see or enter keys. |
| **Integrations and API** | Admin REST API with scoped API keys (OpenAPI docs, examples for PowerShell and curl) for user management, reports and audit export; **webhooks** for events (user added/removed, project completed, policy changed). |
| **Notifications** | Weekly admin digest email (new users, leavers, seats, sync problems, security checklist changes). Instant alerts: sync failing, seats almost full, unusual activity (mass export, many deletions, many failed sign-ins). |

### Two complete plans, not commingled (decision: capture the market)
Competitors stack tiers and lock features behind upgrades. EZPLAN has **two separate products, each with every feature its audience needs, no upsell ladder inside either**:

| | **EZPLAN Personal** | **EZPLAN Business** |
|---|---|---|
| For | Individuals, freelancers, households, informal groups | Companies and organizations of any size |
| Account | Personal account (email code, Sign in with Microsoft/Google) | Company organization owned by the business, people managed by its admins |
| Included, ungated | Everything for running your own projects: unlimited projects, checklist, timeline, milestones, baseline, notes, dashboards, portfolio, workload (for you and people you invite), AI Plan Check + status reports (fair-use caps), `.ezplan` export/import, `.ics`, share links, reminders, inviting collaborators to your projects, "Done by" | **Everything in Personal** for every employee, **plus every business feature**: organization + workspaces, the full admin console (setup wizard, bulk actions with dry run/undo, CSV + domain migration, offboarding wizard, groups and roles incl. Department admin / Helpdesk / Auditor, guests with expiry, policies, audit log UI + CSV 1 year, seat reclaim, chargeback, admin digest and alerts), Microsoft/Google company sign-in, **SCIM directory sync + group mapping**, Admin API + webhooks, invoice/PO billing |
| What users never see | No admin console, seats, policies or IT settings: a clean personal app | Personal-only clutter stays out; employees just see their projects |
| Price shape | Free with small usage limits, plus one Personal price (all features) | One per-seat price (all business features) |

- **Moving between them:** a personal user can move projects into their company's organization (or export/import `.ezplan`). An employee's work account and personal account stay separate (work data belongs to the company; personal projects stay private).
- **Free Personal** has the same features as paid Personal with small quantity limits (active projects, AI checks per month); it is not a reduced feature set. **Collaborators** invited to a Personal project join free with project-level access; the limit on how many is an open decision (section 13).
- **Only two things are separate for Business**, because they cost us per company or serve formal compliance:
  - **Enterprise Security add-on (self-serve, listed price):** audit streaming to SIEM, legal hold, IP allowlist, extended audit retention (beyond 1 year), approval workflows for support access, trust pack with SOC 2 report (when available), security questionnaire help.
  - **Custom sign-in (SAML) connection (quoted by sales):** for companies whose identity system needs SAML or isn't supported directly; the quote covers the WorkOS cost (5b, 5d). This is the only thing that routes a company to "specialized pricing".
- **Usage limits are not feature gates:** AI checks/reports keep fair-use monthly caps per person because each use costs us money (finance model TierCaps). Higher caps can be bought as packs; every feature stays available.

### Build timing
- **1b:** Overview (seats, adoption), People with bulk actions + dry run + undo, CSV import, email change, offboarding wizard + orphaned projects, roles incl. Department admin / Helpdesk / Auditor, licenses + seat reclaim, audit log UI (hash-chained, CSV), command bar.
- **1c:** Setup wizard, domain verification + capture + join approvals, policies with impact previews, guests with expiry, session management, admin digest + instant alerts, security checklist score, domain migration.
- **4 (launch):** Directory group mapping, Microsoft/Google/Okta connections in the wizard, Admin API + webhooks, SIEM streaming, legal hold, support access grants, chargeback + invoices/PO, trust pack, IP allowlist.

### Mockups (Phase 0 rework before 1a)
Replace the single admin screen with a full admin prototype: **Overview with security checklist**, **Setup wizard**, **People with bulk select + dry-run preview + undo toast**, **Offboarding wizard**, **Groups mapping**, **Audit log with filters + SIEM stream setup**, **Security and policies with impact preview**, **Licenses with seat reclaim and department chargeback**, plus a **phone view** of urgent admin actions.

## 5d. Business onboarding (OOBE) with automatic pricing routing
Goal: a company goes from "Start EZPLAN for my business" to employees working in their first project in **under 30 minutes, without talking to anyone**, unless they need specialized setup, in which case EZPLAN detects it and routes them to sales automatically.

**Step by step (resumable, progress saved, can be handed to an IT colleague with a secure link)**
1. **About your company:** name, work email (becomes the Owner), industry, number of employees who'll use EZPLAN.
2. **Verify your domain:** copy-paste DNS TXT record + "Check now" (or confirm via Microsoft/Google admin sign-in, which also proves the domain).
3. **How your employees sign in: a few short, plain-language questions** (one per screen, each with a one-line "What does this mean?" explanation and a picture where useful). Detection pre-fills answers, but the user always **confirms** them; nothing is decided silently.
   - **Q1. "How do your employees sign in to their work email and computers today?"**
     - "With Microsoft (Outlook, Teams, Microsoft 365)" · "With Google (Gmail, Google Workspace)" · "With a separate sign-in service (for example Okta or JumpCloud)" · "We don't have a company sign-in, everyone uses their own email and password" · "I'm not sure".
     - If detected from the domain: *"It looks like your company uses Microsoft 365. Is that right?"* [Yes] [No, choose another].
   - **Q2 (only if "a separate sign-in service"): "Which sign-in service does your company use?"** Okta · JumpCloud · OneLogin · Ping Identity · Microsoft ADFS (an older Microsoft server your IT team runs) · Something else (type the name) · I'm not sure.
   - **Q3 (only for services that support both): "How does your IT team usually connect new apps to {Okta}?"**
     - "With OpenID Connect (OIDC)" · "With SAML" · "I'm not sure, I'll ask IT".
     - Helper text: *"These are two common ways apps connect to company sign-in. OIDC works with EZPLAN at no extra cost. SAML needs a custom setup. If you're not sure, your IT team will know; you can send them this question."*
     - **"Send these questions to my IT person"** button: emails a short secure link with only the sign-in questions; the wizard waits at this step and resumes when IT answers.
   - **Plain summary screen before moving on**, e.g.:
     - *"Your employees will sign in with their Microsoft work accounts. Included in your plan at no extra cost."* [Looks right] [Change my answers]
     - *"Your sign-in service (Microsoft ADFS) uses SAML, which needs a custom setup. Your business qualifies for specialized pricing."* [Looks right] [Change my answers]
   - **"I'm not sure" never sends anyone to sales.** They can continue with email sign-in now and connect company sign-in later from the admin console.
4. **Pricing (automatic from the confirmed answers):**
   - **Self-serve (everyone except SAML/unsupported sign-in, at any company size):** seat price, monthly vs annual, total, card checkout (Stripe) or a **14-day free trial** without a card. Enterprise Security add-on and invoice/PO billing are **self-serve options** at checkout (listed prices), not sales triggers. A small "Need a custom contract? Contact us" link exists but never blocks checkout.
   - **Specialized pricing (only when sign-in needs SAML or an unsupported identity system):** *"Your sign-in setup needs a custom connection, so your business qualifies for specialized pricing. Our team will send a tailored quote, usually within one business day."* Buttons: **Book a call** / **Request a quote**, plus **"Start a free trial now"** using email sign-in so they're never blocked while waiting.
5. **Connect sign-in** (Microsoft/Google admin consent click-through, or OIDC details for Okta/JumpCloud/OneLogin with provider-specific guides, "Test with my account").
6. **Bring your people:** the wizard offers only what fits their answers: automatic sync pushed by their directory (SCIM token + step-by-step for Entra, Okta, JumpCloud, OneLogin, with screenshots), scheduled sync (Microsoft Graph or Google Directory), CSV upload, or invite links. Map directory groups to workspaces and roles (with suggested defaults: one workspace per department).
7. **Choose your AI (optional):** EZPLAN built-in AI (default) or connect the company's own AI provider (same as admin console → AI settings).
8. **Set your rules:** recommended policy presets ("Standard", "Strict", "Open") with plain-language impact; editable later.
9. **First project in 2 minutes:** pick an industry starter or import a `.ezplan`/AI reply, so admins see value immediately.
10. **Go live:** preview and send the welcome email to employees (or let sync add them silently), a printable/shareable "How to start" one-pager, and an admin tour of the console.

**Personal first run (separate, under 2 minutes, no IT questions):** sign up → "What are you planning?" → choose *Use my AI assistant* (Get prompt), *Start from a template*, or *Import a file* → land in the first plan with a 4-step coach-mark tour (check off a task, open the timeline, Plan Check, share/export). Skippable, resumable from Help.

**After setup:** onboarding checklist stays on the admin Overview until done (security checklist score), day-3 and day-14 check-in emails, trial-ending reminders, adoption tips.

**Sales side (owner admin `/admin/ops/sales`)**
- Every "specialized pricing" company becomes a **lead** automatically: company, domain, seats, detected identity system, triggers that fired, trial usage, notes. Instant email + phone alert to the owner (section 11 channels).
- **Quote builder:** set a custom per-seat price, the Custom sign-in (SAML) connection fee, optional Enterprise Security add-on, term, billing method → sends a Stripe quote/invoice; on acceptance, the org's plan, seats and WorkOS connection are switched on automatically (WorkOS self-serve setup portal link sent to their IT).
- Pipeline view: new → contacted → quoted → won/lost, with reasons, feeding the finance model's Actuals.

**Phasing:** OOBE steps 1, 2, 6 (CSV/invites), 8, 9 in **1b** (step 7 AI choice arrives with BYOK in phase 2), tested by the owner with test companies; detection, pricing routing, trial, checkout, sales leads + quote builder, and sync/SSO steps at **launch (4)**. Mockups of the full OOBE (including the "specialized pricing" screen) in **phase 0 rework**.

## 6. Sharing, reminders, export
- **Read-only share link** `/s/<random token>`: live view of the dashboard/checklist/timeline, no login, revocable, optional expiry, `noindex`.
- **Due-date reminders**: daily Cron Trigger. Per-user setting: daily digest / weekly summary / off, time zone, which projects. Content: due today, overdue, starting soon, milestones this week. Sent via **Resend** (free 100/day, ~3,000/month; requires a **verified custom domain**). In-app bell notifications too.
- **Export**: `project.ezplan` (desktop double-click opens EZPLAN once installed; manifest `file_handlers` + `launchQueue`, verified for desktop Chrome/Edge) or `project.ezplan.md` (opens in any app). Android share target, iPhone Open button. "Install EZPLAN to open .ezplan files" prompt after download. `.ics` calendar export (stable UIDs). Re-import of a known `id` offers "Update existing / Save as copy". **Rule that resolves file vs AI trust:** re-importing **your own tracker file** (boxes ticked in Notes, etc.) is a user edit, so status changes **apply after the preview**, credited to the importer "via file import" (attribution claims in the file stay "from file"); an **AI update reply** (2b) can never change progress, only suggest it.

## 7. Accounts, data, hosting
- **Stack:** TypeScript everywhere. App: React + Vite + Tailwind + Radix UI, installable PWA (`vite-plugin-pwa`), IndexedDB for offline. Server: one Cloudflare Worker (Hono router) + D1 (database) + Durable Objects (live editing) + R2 (backups, exports) + Cron Triggers. Shared logic (format, parser, scheduler, checks, permissions) lives in one package used by both app and Worker, so the phone, the server and the tests always agree.
- **Repo layout:** `shared/` (format, parser, import pipeline, scheduler, checks, permissions, prompts) · `app/` (website) · `worker/` (API, live rooms, AI engine, moderation, cron) · `docs/` (research, finance, operations, runbooks, legal drafts) · `design/mockups/` · `scripts/`.
- One Worker serves the site + `/api/*` + `/ws/plan/:id`. **Custom domain** (~$10/yr) now, needed for reminder email. **Workers Paid ($5/month)** when free limits are reached, and at the latest before phase 5 (it also extends database point-in-time recovery from 7 to 30 days).
- **Sessions are stored server-side** (a `sessions` table; the cookie only holds a session id), so "sign out everywhere", deactivation and offboarding take effect immediately.
- Login: Cloudflare **Access for SaaS (OIDC)**, `/login` → email code → `/callback` → session cookie. During the private build the Access email list is just the owner (plus owner-controlled test accounts). `getUser()` is the single auth seam, swapped for built-in accounts in phase 4.
- D1 (grows by phase): `users`, `sessions`, `invites`, `organizations`, `domains`, `workspaces`, `members`, `plans` (metadata incl. `state`, `health`, snapshot, review), `plan_versions`, `trash`, `notifications`, `feedback`, `baselines`, `raid_items`, `status_updates`, `changes`, `comments`, `time_logs`, `activity`, `share_links`, `reminder_prefs`, `templates`, `usage`, `moderation_events`, `audit_log` (hash-chained), `ai_providers` (encrypted keys), `scim_tokens`, `credentials`, `leads`. Phone offline cache (IndexedDB).
- **Basics the plan was missing (added):** Terms, Privacy Policy and AUP pages + cookie notice (1a); account data export and deletion for Personal users (1c); **product analytics** with a privacy-friendly tool (Cloudflare Web Analytics for pages, first-party event table for funnels like OOBE drop-off; no ad trackers) (1a); **sales tax/VAT** via Stripe Tax at checkout (4); **currency per project** for budgets and **date/number formats by locale**; UI strings i18n-ready from day one (English only at launch).
- **Help and support (was missing):** in-app Help ("?" menu: searchable guides, the tours, keyboard shortcuts, what's new), a public help center built from `docs/help/` (also the source for the IT setup guides), a contact form that creates a support ticket by email, and a separate security contact address. Support replies are part of the monthly maintenance time (section 11).
- Private-build running cost: Cloudflare $0 to $5/month, domain ~$10/yr, Resend $0, AI a fraction of a cent to a few cents per check/report, capped per user.

## 8. Business model and finances (revisitable)
- **Market research** `docs/research/competitors.md`: pricing table (Todoist ~$4, Trello $5, ClickUp $7, Linear ~$8 to $10, Monday ~$9 with a 3-seat minimum, Smartsheet ~$7 to $9, Notion ~$10, Wrike ~$10, Asana $10.99 with 5 AI requests then $0.50 each, TeamGantt per project), design patterns, what to borrow and what to avoid, sources + dates. Vendor pricing pages were unreachable from the build environment, so figures come from 2026 comparison articles and are marked "verify before pricing decisions".
- **Finance model** `docs/finance/ezplan-unit-economics.xlsx` (built with the xlsx skill, every number a formula off one Assumptions sheet, sources + "last checked" dates):
  - Assumptions: prices (Cloudflare base/overage, D1/DO, Resend tiers, Stripe 2.9% + $0.30 + Billing 0.7%, Claude per-model token prices), usage per user type (light/typical/heavy: plans, checks, deep checks, reports, in-app generations, emails, requests), free:paid ratio, conversion, churn, annual vs monthly mix, fixed costs.
  - Outputs: cost per free user, cost per paid user (phase 1 vs with in-app AI), gross margin at candidate prices, **minimum price for target margin** (default 80%), break-even subscriber count, scenarios at 100 / 1k / 10k / 100k users, and how many AI uses a plan can include before margin drops below target (sets the fair-use caps).
  - Current results (Nov 14, placeholders): Personal at $10 → 87% margin, minimum price for 80% ≈ $5.85; Business seat at $15 → 93% margin, minimum ≈ $3.21; fixed costs incl. insurance and one-time legal/entity spread over 12 months ≈ $442/month; Business customers: 25 seats 82%, 200 seats 94%, 1,000 seats with SAML 94%.
  - **Model changes (done Nov 14; all six below are in the workbook, new Plans sheet):**
    1. Split Assumptions into a **Personal plan** (price, free:paid ratio, usage, collaborator cost) and a **Business plan** (seat price, no free users carried, free guests' cost, usage).
    2. Replace the WorkOS seat threshold with a **"needs SAML" share of companies**: identity cost $0 on the direct track, SSO + SCIM cost only for SAML companies, offset by the quoted connection fee.
    3. Add the **Enterprise Security add-on** (price, uptake %) and the **Personal BYOK add-on** (price, uptake %).
    4. Add **moderation cost** per import/edit, and set AI cost to $0 for BYOK companies (except the outbound-sharing checks we always run).
    5. Add **one-time costs** (legal, entity, insurance, app stores) and **support time**.
    6. Show margins per plan with every feature included, and the fair-use caps that keep each plan at the target margin.
- **Real numbers feed the model**: the `usage` table already logs tokens + cost per call. Add an owner-only **Admin > Economics** page: actual AI $ per user per month (p50/p90/max), requests, emails, active users, and a CSV export that drops into the spreadsheet's "Actuals" sheet.
- **Pricing direction (decided at launch with real data)**: **two complete plans, no feature tiers inside either**. **Personal:** free with small usage limits (e.g. a few active projects, a few AI checks per month) + one Personal price with every personal feature (~$8/mo annual, ~$10 monthly, placeholder). **Business:** one per-seat price with every business feature (placeholder ~$12 to $15/seat). Optional **Enterprise Security** add-on for Business, priced per seat or per company to cover WorkOS and compliance work. AI fair-use caps per person with add-on packs. Annual billing encouraged (Stripe fees drop from ~7% to ~3.5%).

## 9. Phases
Size is relative effort (S, M, L, XL), not a calendar promise. **1b and 4 are the largest.** Where other sections say "launch (phase 4)" they mean phase 4 below; the public launch itself is phase 6.

**Phase 0 rework (before 1a), in two approval gates so design doesn't block the build:**
- **Gate A (approve before 1a):** phone screens updated (AI-neutral "your AI assistant" wording, health labels, free Plan Check score, quick-add, calendar), the **"Update with my AI"** flow with change preview (2b), the **desktop project workspace** (1b: overview with widgets, grid + Gantt, RAID log, status updates, task drawer), Personal first run.
- **Gate B (approve before 1b):** the full **IT admin prototype** (5c list) and the **business onboarding** flow incl. the sign-in questions and the "specialized pricing" screen (5d).
- Alongside: finance model changes (section 8 list), and the research doc gains sections on project views, dashboards, status updates, scheduling depth, user complaints, AI import/update and admin consoles, with sources.

| # | Phase | Size | Contents |
|---|---|---|---|
| 1a | **Solo core** (owner uses it daily) | L | Format spec v1 + AI-neutral prompts, import pipeline (validate → sanitize → parse → moderate → preview), parser/free checks/scheduling basics (2, 3, 3b-1a list), editor + quick-add, templates + start from past project, phone dashboard / checklist / timeline / calendar, free + AI Plan Check, "Update with my AI" basic round trip (2b), `.ezplan` export/import, printable summary, Trash + version history, private-build login with server-side sessions, AI engine interface (one adapter), draft Terms/Privacy/AUP pages, analytics, in-app Help skeleton; moderation + injection defenses + Turnstile + rate limits + Trust & Safety queue (4c); maintenance basics (11). **First week: two technical spikes** (offline + live editing sync; timeline speed at 2,000 tasks) so the riskiest pieces are proven before 1b depends on them |
| 1b | **Teams + orgs** (owner tests with test companies) | XL | Roles model, organizations, workspaces, invites, assignees, "Done by", live collaboration, offline editing, workload + re-leveling + time off/holidays, Home + portfolio, **desktop workspace** (Overview + widgets, grid + Gantt, RAID log, status updates with history, task drawer), comments/approvals/recurring, admin console core (5c-1b list), OOBE basics (5d-1b list), Operations page |
| 1c | **Reach + depth** | L | Share links, reminders + digests, AI status reports, `.ics` + live calendar feed, one-page status report + scheduled dashboard emails, presentation mode, budgets/cost, time logging, what-if, multiple baselines, dependency types + constraints, imports from other tools, Board view, Slack/Teams webhooks, admin 1c list (setup wizard, domains, policies, guests, digest), 2b redaction/policy + change-list format, Personal data export/deletion, help center content |
| 2 | **In-app AI** | M | Generate plans + Re-plan / What's next / Break down inside the site; **Business BYOK** adapters (Anthropic, Azure OpenAI, Bedrock, Vertex, OpenAI-compatible) with encrypted keys, per-provider verification, and the moderation split from 4c |
| 3 | **Connector** (optional; can move after launch without blocking anything) | S to M | "Export to EZPLAN" directly from chat, built as a **standard MCP server** so it works with any AI app or agent that supports MCP connectors (e.g. Claude, ChatGPT and others), not one vendor; plus a simple REST import endpoint (`POST /api/import` with a personal API key) for custom agents. OAuth via `@cloudflare/workers-oauth-provider` built on our **`getUser()` seam** (not tied to Cloudflare Access), so it keeps working when the private-build login is replaced in phase 4 |
| 4 | **Commercial readiness** (accounts, company sign-in, billing) | XL | Built-in accounts (email codes + Sign in with Microsoft/Google), company sign-in (Microsoft, Google, any OIDC) + our SCIM endpoint + Graph/Google scheduled sync, Microsoft publisher verification, WorkOS for SAML companies, full OOBE with the sign-in questions + specialized-pricing routing + sales leads/quotes, Personal first run, Stripe subscriptions + seat billing + invoices + Stripe Tax, **Personal and Business plans, Enterprise Security add-on, Personal BYOK add-on**, admin phase-4 list (5c), in-app feedback tools for testers, landing/pricing pages. **Needs the business entity first** (Stripe and Microsoft verification require it). Native apps (Capacitor iOS/Android, Tauri desktop: Apple $99/yr, Google $25) are the last item and a candidate to follow launch (section 13) |
| 5 | **Tester program** (only once the owner judges it fully functional) | ongoing | Invite testers (personal users and a few real companies); **in-app feedback**: bug report button (auto-attaches page, browser, recent errors), feature request board with voting, short surveys; tester-only release channel; weekly triage of reports into the backlog; fix-and-ship loop until launch criteria are met |
| 6 | **Public launch** | S | Open sign-ups, pricing live, legal pages final (lawyer-reviewed), status page public, marketing site |

No outside users (testers or customers) get access before phase 5. Phases 1a to 4 are built and tested by the owner (with owner-controlled test accounts and test companies).

**"Fully functional" gate (phase 4 → 5), so the decision is concrete:** every verification suite in section 12 passes; the owner has run at least 3 real projects end to end (one solo, one team with test accounts, one as a test company through onboarding and the admin console); restore and rollback drills done; no known data-loss or security bugs and no open "blocks a core flow" bugs; legal items marked "before phase 5" in section 14 complete; help center covers every core flow; the owner signs off.

## 10. Owner setup (README gives copy-paste steps)
Accounts the owner creates, by when (I can't sign in to these from here; each gets step-by-step instructions):
| When | Accounts and setup |
|---|---|
| **Now** | Fix GitHub access (install the Claude GitHub App on the repo). |
| **Before 1a** | Cloudflare (free) + custom domain; Anthropic API key (pay-as-you-go); Sentry (free); UptimeRobot (free) + phone app; Resend (free) + domain DNS records. Then: `wrangler login`, create D1 (production + staging) and the R2 backup bucket, Durable Objects binding, Cloudflare Access for SaaS OIDC app with the owner's email, Turnstile site key, `wrangler secret put` for `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET`, `ACCESS_TOKEN_URL`, `ACCESS_AUTHORIZATION_URL`, `ACCESS_JWKS_URL`, `COOKIE_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `SENTRY_DSN`, `TURNSTILE_SECRET`, then `wrangler deploy`. |
| **Before phase 4** | Business entity + bank account (section 14); Stripe; Microsoft Entra app registration + partner account for publisher verification; Google Cloud OAuth client; WorkOS (free until a SAML customer signs); test tenants (a free Microsoft 365 developer tenant, a Google Workspace trial, an Okta developer account). |
| **Before phase 5/6** | Lawyer review, insurance, Apple Developer and Google Play accounts (if native apps ship at launch), DMCA agent registration. |

## 11. Maintenance and operations
Goal: EZPLAN stays up and secure with ~3 to 6 hours/month of routine work (estimate), problems page the owner before customers notice, and a hired contractor can take over from the docs alone.

**Who and how:** the owner handles alerts at first; **urgent = phone push/SMS, non-urgent = email**. Everything is written so a future contractor can run it.

### Tools (free tiers during the private build and tester program)
| Need | Tool | Why |
|---|---|---|
| Uptime + urgent phone alerts + public status page | **UptimeRobot** free (50 monitors, 5-min checks, status page, phone app push) | Runs outside Cloudflare, so it still alerts if our Worker is down. Better Stack's free plan is "personal projects" only. |
| Error tracking | **Sentry** free (~5k errors/month), `@sentry/cloudflare` in Worker + browser SDK in the app | Stack traces, which user/org was affected, release tagging |
| Logs + metrics | Cloudflare Workers Logs + **Workers Analytics Engine** (custom metrics: logins, sync results, AI calls, errors) | Built in, no extra service |
| Scheduled health checks | A **Cron Trigger** in our Worker (every 15 min + daily) | Checks credentials, syncs, AI spend, email bounces; sends alerts |
| Alert delivery | Email via **Resend**; urgent alerts also via UptimeRobot's heartbeat monitor (our cron pings it, a missed or "fail" ping pages the phone) | Phone push/SMS without a paid paging service |
| Backups | **D1 Time Travel** (automatic, 7 days free / 30 days paid, no extra cost) + **nightly export to R2** kept 90 days | Restore any minute of the last 7 days (30 once on Workers Paid), or any night of the last 90 |
| Releases | GitHub Actions CI + `wrangler versions deploy` gradual rollout + `wrangler rollback` | One-command undo of a bad release |
| Dependency updates | **Renovate** (or Dependabot), grouped weekly pull requests | Updates arrive pre-tested by CI |

### What is monitored and how you hear about it
| Check | Frequency | Alert |
|---|---|---|
| Site, API, sign-in page, SCIM endpoint reachable | 5 min (UptimeRobot) | **Phone** after 2 failures |
| Error rate spike (5xx, failed logins, failed saves) | 15 min (cron + Analytics Engine) | **Phone** if over threshold, email summary |
| Credential expiry (see inventory) | Daily | **Email** at 30/14/7 days, **phone** at 3 days |
| Company sync health (each org: last success, failures) | Each sync + daily | Email to us + the company's IT admin after 2 failed syncs; **phone** if many orgs fail at once (a platform issue) |
| AI spend vs daily budget, per-user anomalies (abuse) | Hourly | **Email** at 80% of daily budget, **phone** at 100% (and new AI calls switch to free deterministic checks only) |
| Claude API errors / refusal spike / model deprecation notice | 15 min + monthly review | **Email**; Plan Check degrades gracefully to free checks |
| Email delivery (bounces, spam complaints, DMARC) | Daily | **Email** if bounce rate > 5% |
| Backups: last nightly export succeeded | Daily | **Email** on failure |
| Durable Object / real-time errors, WebSocket disconnect spikes | 15 min | **Email** |
| Cloudflare / Anthropic / Resend / Stripe billing thresholds | Vendor billing alerts | **Email** |

### Credential and renewal inventory (`docs/operations/credentials.md`, names and expiry dates only, never secret values)
Microsoft app **certificate** (preferred over a secret; renew before expiry, up to 24 months), Google OAuth client, WorkOS API key, Anthropic API key, Resend API key + domain DNS (SPF/DKIM/DMARC), Stripe keys + webhook secret, Cloudflare API tokens (least privilege, per purpose), `COOKIE_ENCRYPTION_KEY` (yearly rotation with overlap), per-company SCIM tokens (shown in the admin console with "last used" and rotate button), custom domain renewal (auto-renew on), Apple Developer ($99/yr) and other yearly renewals. The daily cron reads the expiry dates from a D1 `credentials` table and alerts.

### Owner Operations page (`/admin/ops`, owner only)
One screen: system status, error rate, last deploy (with rollback instructions), credential expiry countdowns, company sync table (org, track Direct/WorkOS, last sync, status, last error), AI spend today/month vs budget, email bounce rate, last backup, open alerts. Links to the matching runbook for each red item.

### Customer-facing
- Public **status page** (UptimeRobot) linked from the app footer and help.
- Company IT admins see their own **sync status, last error, "test connection"** and SCIM token rotation in the admin console, so most issues are self-fixed.
- **Planned maintenance** notice: in-app banner + email to org admins 48 hours ahead (rare; Cloudflare deploys don't need downtime).
- Changelog page for notable changes.

### Runbooks (`docs/runbooks/`, step-by-step, phone-friendly, contractor-ready)
Site down · Sign-in broken (Microsoft/Google/WorkOS) · Credential expiring or expired · A company's sync failing · Many syncs failing · AI errors or cost spike · Email not delivering · Bad release (rollback) · Restore data (Time Travel / R2 export) · Security incident (suspected breach: rotate keys, revoke sessions, notify customers) · Customer data export/deletion request · Offboarding a customer company. Each: symptoms, first 5 minutes, fix steps with copy-paste commands, how to confirm it's fixed, who to tell.

### Routine schedule
| When | What | Time (estimate) |
|---|---|---|
| Automatic, always | Monitors, cron checks, backups, alerts | 0 |
| Weekly | Glance at Operations page, merge Renovate PRs after CI passes | ~15 to 30 min |
| Monthly | Review platform changelogs (Cloudflare, Anthropic model deprecations, Microsoft Entra/Graph, Google Workspace, WorkOS, Stripe, Resend), check costs vs finance model, update Actuals sheet | ~1 to 2 hrs |
| Quarterly | **Restore drill** (restore staging from backup), **rollback drill**, access review (who has admin on Cloudflare/GitHub/Anthropic/Stripe, 2FA on all), rotate Cloudflare API tokens | ~2 to 3 hrs |
| Yearly | Security review (token checks, org isolation, SCIM auth, dependency audit), rotate encryption key, renew certificates/domains, re-check vendor prices in the finance model | ~1 to 2 days |
| Later (enterprise demand) | SOC 2 readiness (policies, evidence collection tool, auditor) | Separate budget |

### Contractor handoff kit (`docs/operations/README.md`)
Architecture map (one diagram), list of every vendor account and what it's for, how to grant/revoke a contractor's access (separate logins with least privilege, never shared passwords), where alerts go and how to add the contractor to them, the runbooks, the routine schedule above, and a first-week checklist.

### Built in phases
- **1a:** Sentry, UptimeRobot monitors + phone app, D1 Time Travel + nightly R2 export, staging environment, CI + gradual deploy + rollback, AI daily budget alert, credentials table + expiry cron, runbook skeletons, contractor handoff README.
- **1b:** Operations page, real-time (Durable Object) metrics, org-level health.
- **1c:** Email deliverability monitoring, status page linked in app, maintenance-notice banner.
- **4 (launch):** Company sync health + IT admin "test connection", Microsoft certificate monitoring, SCIM validator and Okta tests in CI, WorkOS health, Stripe webhook monitoring, full runbooks, quarterly drills begin.

**Support:** the contact form creates email tickets; target first reply within 1 business day; common answers feed the help center. Counted in the monthly time once testers arrive (expect it to grow with users; a part-time support contractor is the first hire to consider).

**Cost:** $0 extra during the private build (free tiers above). Paid upgrades only when outgrown (e.g. Sentry Team ~$26 to $29/month, faster uptime checks), added to the finance model's fixed costs when needed.

## 12. Verification
- **Finance model**: recalculates cleanly (formula check, no errors), scenario totals hand-checked for one case, changing one assumption flows through all outputs.
- **Design**: mockup screenshots (phone + desktop, light + dark, contrast checks), your approval before 1a.
- **Moderation + injection**: a red-team set (harmful plans across every AUP category, borderline-but-fine plans like "security audit of our own office" or "event fireworks permit", injection attempts in titles/notes/hidden characters) runs in CI: harmful → block/review, legitimate → allow (track false positives), injections never change Plan Check verdicts or reach outputs; `.ezplan` attack fixtures (oversized, zip bomb, binary disguised as text, script tags, `javascript:` links, zero-width characters, forged `id` targeting another user's plan, forged `done: … by` attribution, `team:` emails trying to self-invite, formula-injection cells) are each rejected or neutralized through every entry point (upload, paste, file handler, share target, zip, API); rendered output has no executable HTML; connector/API can't touch other users' plans; rate limits and Turnstile verified in staging.
- **BYOK**: each provider adapter passes the fixture evaluation before "verified"; keys never appear in logs, API responses or the UI after saving; key failure pauses AI with the right admin message and no fallback; **a fake provider that answers "allow" to everything still can't get harmful content into a share link, an outside email or a Personal account** (our own classifier runs there); internal-only content for BYOK companies goes to their provider.
- **Data safety**: deleted tasks/projects restore from Trash within 30 days; a version is saved before every import, AI update, re-plan and bulk edit, and restoring it brings back the exact earlier plan; an offline edit to a deleted task restores and flags it.
- **Seats, guests, domains**: sync beyond the seat count creates unlicensed users and alerts admins; a same-domain email can't be added as a Guest; synced users' directory fields are read-only; domain capture never moves a personal project without that user's consent.
- **AI-neutral prompt**: run the Get prompt through several assistants on the same 5 sample projects (event, renovation, launch, research, hiring). I can produce the Claude replies; **the owner pastes the prompt into ChatGPT, Gemini and Copilot and sends back the replies** (I can't sign in to those). Save each raw reply as a parser fixture; every reply must import with no errors (warnings allowed), and the prompt is tuned until they do.
- **Update via your AI (2b)**: replies from several assistants to the update prompt (using fixture plans with progress) produce correct previews; IDs preserved; statuses/"Done by"/comments never changed by a reply; missing tasks kept unless confirmed; done tasks can't be deleted; redacted names map back correctly; a plan edited after the prompt was generated merges with conflicts highlighted; change log and optional new baseline recorded; moderation/injection checks run on the reply.
- **Desktop workspace (1b)**: Gantt stays smooth (60 fps scroll, under 100 ms reschedule preview) with a 2,000-task fixture; multiple baselines appear in dashboard, PDF and print; one-page status report and scheduled dashboard emails render correctly; "update overdue" marker appears after the set interval; grid edits and Gantt drags stay in sync; schedule/budget variance and forecast KPIs match the engine; RAID items link to tasks and appear on the dashboard; status update auto-fill matches data and the RAG history is kept; widgets save per user; presentation mode and PDF report render; keyboard-only operation works.
- **AI-free planner (3b)**: with AI switched off org-wide, every core flow still works end to end (create from template, quick-add, schedule, re-plan, track, forecast, report, export); scheduling engine tests (dependency types with lag, holidays/time off, constraints, critical path + slack, re-leveling, what-if preview equals applied result); free Plan Check rule fixtures; forecast math; imports from Asana/Trello/Monday/Smartsheet/ClickUp CSV samples and MS Project XML; quick-add syntax cases; offline edits sync without loss.
- **Unit (vitest)**: parser fixtures (all statuses, owners, due, milestones, baseline, notes, plus the multi-assistant replies and formatting variants), round-trip keeps all tracking, hand-edited files re-import, checks, schedule/critical path/variance/workload math, `.ics` validity.
- **AI**: mocked tests for Plan Check + status reports (verdicts, fixes diff, refusal, limits, usage rows), plus one live run once an API key is available.
- **Org admin**: only Owners/Admins reach `/admin`; CSV import of 200 rows (valid, duplicates, bad emails reported per row); email change keeps user id, ownership and "Done by" tags; deactivation blocks sign-in at once, frees the seat, and the transfer moves open tasks/projects; seat limit enforced (can't assign beyond purchased); every admin action appears in the audit log; one company's admin can never see or change another company's users.
- **Business onboarding (5d)**: detection fixtures (a Microsoft 365 domain → Microsoft, Google MX → Google, unknown → asks); routing rules (any seat count with Microsoft / Google / OIDC sign-in → self-serve price; SAML or unsupported sign-in → specialized pricing; "I'm not sure" → email sign-in, never sales; Enterprise Security add-on and invoice billing purchasable self-serve; card checkout and no-card trial both work); wording test: 5 non-technical people answer the sign-in questions correctly for a described company without help; "Send to my IT person" link resumes the wizard; every specialized case creates a lead and alerts the owner; accepting a quote switches plan/seats/WorkOS on; a test company completes the whole OOBE in under 30 minutes on phone and desktop; drop-off per step is tracked.
- **Admin console (5c)**: bulk actions on 1,000 users finish with a correct dry-run preview and can be undone within 24 hours; domain migration of 200 users keeps every user id and history; offboarding transfers all tasks/projects and leaves the orphaned-projects report empty; Department admins and Helpdesk can't act outside their scope; audit log hash chain detects tampering; seat reclaim notifies then frees seats on schedule; every policy change shows the correct impact count; support access expires on time and is logged; a test IT admin completes the setup wizard on a fresh test tenant in under 30 minutes.
- **Company identity (launch)**: Microsoft and Google sign-in against test tenants (wrong-tenant / unverified-domain users rejected); SCIM endpoint passes Microsoft's SCIM validator and Okta's SCIM tests (create, update email, deactivate, groups), with per-org tokens that can't touch another org; Graph fallback sync with a mocked Graph API; WorkOS webhooks produce the same results as SCIM.
- **Worker (`@cloudflare/vitest-pool-workers`)**: auth 401s, workspace roles (viewer can't edit), users can't see other workspaces, share link read-only + revocation, reminder cron builds the right digest (email sender mocked).
- **Real-time**: two simulated clients edit the same plan (concurrent status/field edits converge, offline replay, presence). Completion attribution: marking done records the authenticated user (a client-sent name is ignored), reverting clears it, the activity log keeps both events, `done: … by …` survives export → re-import, and a ticked box without `by` gets the importer + "via file import".
- **Maintenance**: in staging, simulate each alert and confirm it arrives on the right channel (stop the Worker → phone; credential dated 3 days out → phone, 30 days → email; force 2 failed syncs → email to us + org admin; AI spend over budget → phone + Plan Check falls back to free checks). Restore drill: restore staging D1 to an earlier time and from an R2 export. Rollback drill: deploy a broken version to 10%, roll back with one command. A second person follows two runbooks without help.
- **End-to-end (Playwright, iPhone + desktop)**: prompt → paste → check → invite second user → live edit seen by both → timeline/workload/dashboards render → share link → export → re-import.
- Commit and push to the branch after each sub-phase; no PR unless asked.

## 12b. Next steps after Gate A approval (Nov 14)
1. **GitHub:** retry `git push -u origin claude/project-mgmt-markdown-parser-6ikcpy` (9 local commits). If it still returns 403, re-attach the repo with push access and check the GitHub access documentation page; report exactly which step fails. Keep the backup bundle until the push succeeds.
2. **Finance model, whole dollars** (`scripts/build_finance_model.py` → `docs/finance/ezplan-unit-economics.xlsx`):
   - Replace "annual discount %" with whole-dollar inputs: Personal annual price per month ($8), Business annual price per month ($12); the revenue factor is computed from monthly/annual prices and the annual share.
   - Personal BYOK add-on $3; Enterprise Security add-on $3/seat and SAML connection fee $300 stay whole.
   - Candidate price rows on the Pricing sheet use whole dollars only ($5 to $15).
   - "Minimum price for target margin" also shows the **next whole dollar up** (ROUNDUP), labeled as the minimum price you could actually charge.
   - A **price check** cell on Assumptions turns red ("Use whole dollars") if any price input has cents (MOD(price,1)<>0).
   - Rebuild, recalc with zero errors, hand-check one Personal and one Business revenue figure, send the workbook.
3. **Plan copy in repo:** sync `docs/PLAN.md` with this file; commit.
4. **Start Phase 1a** (owner-only build): scaffold repo (`shared/`, `app/`, `worker/`), format spec v1 + parser + tests first, then the two week-one spikes (offline + live editing sync; timeline at 2,000 tasks). Everything runs locally (Wrangler's local mode, Vitest, Playwright), so 1a work starts before Cloudflare/Anthropic accounts exist; deploying needs the "Before 1a" accounts in section 10.
5. **Gate B mockups** (IT admin prototype + business onboarding) built alongside 1a, for approval before 1b.

## 13. Review: open decisions and risks (Nov 13)
**Fixed in the second review:**
- **Moderation loophole closed:** a customer's own AI could have been used to wave everything through; EZPLAN's own classifier now always covers Personal accounts and anything leaving a company (4c).
- **Pricing contradiction removed:** custom SAML sign-in was both a self-serve add-on and a sales-only quote; it is now a separate quoted connection, and Enterprise Security is purely self-serve (5c).
- **One admin spec:** the older admin summary in 5b (with a different role list) was replaced by rules that were missing: seats vs sync, guests limited to outsiders, directory as source of truth, consent-based domain capture.
- **Google Workspace sync** corrected to a scheduled read (assumption to verify), with "Sync now" and immediate offboarding as the safety net.
- **Phase order:** the AI engine interface moves to 1a; phase 4 renamed "Commercial readiness" (public launch is phase 6); mockup approval split into two gates; relative sizes and a concrete "fully functional" gate added; the two riskiest technical pieces get early spikes.
- **Added what was missing:** Trash and version history, server-side sessions (needed for "sign out everywhere"), help center and support, Personal first run, tech stack and repo layout, an owner account checklist by phase, one consolidated finance to-do list.
- **Corrections:** backups are 7 days point-in-time on the free plan (30 on paid); vendor prices are unverified; other assistants' replies must be collected by the owner; the business entity is needed before phase 4 (Stripe, Microsoft), not phase 5.

**Fixed in the first review:** one health-status set everywhere; AI-neutral wording in format/parser sections; "tiers" wording removed (fair-use caps, Personal + Business plans, Enterprise Security add-on); one roles model; file re-import vs AI-reply trust rule; support access default-deny for everyone; stale finance numbers updated; D1 table list; phase table now includes every section (1b workspace, 2b, 3b, 5c, 5d); connector auth no longer tied to beta login; missing basics added (Terms/Privacy, analytics, Stripe Tax, currency/locale, Personal data export/deletion); format spec reserves fields for later features.

**Decided (Nov 14):**
- **Gate A mockups approved.** Phase 1a may start; Gate B (admin + business onboarding) must be approved before 1b.
- **Whole-dollar prices only:** every subscription price, add-on and AI pack the customer sees is a whole dollar amount, monthly and annual. Annual billing is set as a whole-dollar **monthly-equivalent price** (e.g. Personal $10 monthly / $8 per month billed annually = $96/year; Business $15 / $12 = $144/year) instead of a discount percentage that can create cents. Personal BYOK add-on placeholder becomes **$3** (was $2.50).

**Decided (earlier):**
- **Specialized pricing only for SAML / unsupported sign-in** (never by company size); sign-in questions split into short plain-language steps with a confirmation summary (5d); direct track extended to any OIDC provider (Okta, JumpCloud, OneLogin...).
- **No outside access until fully functional:** private build through phase 4, then the tester program (phase 5), then public launch (phase 6).

**Open decisions (yours; none block Phase 0 rework or 1a):**
1. **What may follow the public launch instead of preceding it.** The plan has grown to a very large first release. Candidates that the core product doesn't depend on: native app-store apps (the installable website already works on phones), the connector (phase 3), imports from MS Project XML, Slack/Teams notifications, SIEM streaming and legal hold (until a customer asks), custom dashboard chart widget, change-list update format. Recommendation: build everything else first and decide on these at the phase 4 gate.
2. **Legal approach:** lawyer package vs. template service plus lawyer review (section 14). Needed before phase 4 for the entity, before phase 5 for the documents.
3. **Free Personal limits:** active projects, AI checks per month, and how many free collaborators a Personal project can have; set from the finance model.
4. **Prices (whole dollars):** Personal $10 monthly / $8 annual-per-month, Business seat $15 / $12, Personal BYOK add-on $3, Enterprise Security add-on $3/seat, SAML connection fee $300/company: all placeholders to confirm with real usage data.
5. **Launch region:** worldwide, or US (and Canada) first to narrow which privacy laws apply (section 14b); decide with the lawyer.

**Risks to watch:**
- **Scope/time:** this is a large product for one owner + me. Offline editing with live collaboration, and timeline speed at 2,000 tasks, are the hardest engineering pieces; both get a spike in the first week of 1a.
- **GitHub push still blocked (403):** 4 commits are local only, this session's container is temporary, and CI/automated updates in section 11 need GitHub access. Must be fixed before 1a.
- **Single point of failure:** one owner holds every account. The contractor handoff kit (section 11) and a password manager with an emergency contact reduce this.
- **Moderation false positives** on legitimate plans (security audits, fireworks permits, pharmacy projects): tracked in the red-team set; appeals path exists.
- **AI-neutral parsing** depends on how well other assistants follow the prompt; the multi-assistant fixture test is the safeguard.
- **Microsoft P1 requirement** means Business Basic/Standard customers rely on scheduled Graph sync (slower, not instant offboarding); document clearly for IT.
- **Legal:** see section 14; the entity is needed before phase 4, the documents before testers (phase 5), because testers are real people whose data we hold.

## 14. Legal checklist
Plain-language purpose of each item is explained to the owner in chat; this is the to-do list. Not legal advice; a lawyer confirms.

| Item | Why | When |
|---|---|---|
| Business entity (e.g. LLC) + business bank account | Separates personal assets from the business if something goes wrong; required for Stripe, Apple and Microsoft publisher verification | **Before phase 4** |
| Name / trademark search for "EZPLAN" | Avoid being forced to rename after launch | Before phase 5 |
| Terms of Service | The contract with users: what we provide, limits of liability, account suspension rights, subscriptions/refunds | Before phase 5 (tester version), final at 6 |
| Privacy Policy + cookie notice | Required by law when collecting personal data (GDPR in EU/UK, CCPA/CPRA and other US state laws) | Before phase 5 |
| Acceptable Use Policy + moderation/appeals process | Lets us block harmful plans and suspend accounts fairly and consistently | Before phase 5 |
| Data Processing Agreement (DPA) + subprocessor list (Cloudflare, Anthropic, Resend, Stripe, Sentry, WorkOS, UptimeRobot) | Businesses legally must have one with vendors that handle their employees' data; enterprise IT will ask for it | Before business testers |
| Illegal-content reporting duties (e.g. US law requires online services to report child sexual abuse material to NCMEC) | Legal obligation once we host user content; built into the severe-content runbook | Before phase 5 |
| Subscription auto-renewal and cancellation rules | Several US states and other countries require clear renewal terms and easy cancellation | Phase 6 |
| Sales tax / VAT registration (Stripe Tax helps calculate) | Software subscriptions are taxable in many places | Phase 6 |
| Accessibility statement (WCAG AA already planned) | Reduces legal risk (ADA in US, European Accessibility Act) | Phase 6 |
| Tester agreement (short beta terms: confidentiality, "may have bugs") | Sets expectations and protects unreleased features | Phase 5 |
| Insurance (cyber liability, errors and omissions) | Covers costs if there's a data breach or a customer claims loss | Quotes before phase 5, in force by phase 6 |

**Legal budget** (rough, from lawyers' public price pages, not independent surveys): ~$1,000 to $1,500 per document, ~$2,500 to $2,750 for a Terms + Privacy + DPA bundle from a solo SaaS lawyer; entity formation fees vary by state; insurance premiums unknown until quoted. All go into the finance model's one-time and fixed costs. I draft first versions of the documents (`docs/legal/`) for the lawyer to correct.

### 14b. Minimizing liability (built into the business and the product)
Not legal advice; the lawyer review confirms which apply and how.

**1. Business shield**
- Operate only through the LLC (or corporation): contracts, Stripe, vendor accounts, domain and bank account in the company's name; **never mix personal and business money** (mixing can let a court reach personal assets).
- **Insurance:** cyber liability (breach costs: notification, forensics, claims) + tech errors & omissions (claims that the software caused a loss).
- Check vendors' terms (Cloudflare, Stripe, Anthropic, Resend, WorkOS) and sign their DPAs so their security commitments back ours.

**2. Contract protections (Terms, AUP, Business agreement)**
- **Limitation of liability** (e.g. capped at fees paid in the last 12 months) and **"as is" warranty disclaimer**.
- **"Planning tool, not professional advice":** plans, Plan Checks and AI suggestions are suggestions; users are responsible for permits, safety, legal, financial and medical decisions. Shown in Terms *and* in the product (see 3).
- Users own and are responsible for their content, and **indemnify** EZPLAN for content that breaks the AUP or the law.
- Dispute terms (governing law, venue; arbitration/class-action waiver where enforceable, lawyer decides).
- **No uptime promise for Personal**; Business SLA only if sold, with service credits as the sole remedy.
- Age requirement (e.g. 16+ or 18+; never directed at children under 13, which avoids US COPPA obligations).
- Sanctions/export clause (Stripe already blocks sanctioned regions).

**3. Product design that lowers risk**
- **AI is advisory only:** every AI change needs user acceptance (already planned); Plan Check and status reports carry a short note, *"Suggestions only: check permits, safety and legal requirements for your project"*; our AI prompts tell the model not to give regulated (legal, medical, financial, safety-certification) advice, only planning structure.
- **Sensitive-data guardrails:** Terms forbid storing payment card numbers, government ID numbers, health records or children's data; free pattern checks **warn and offer to remove** card numbers / ID numbers typed into plans.
- **Payments:** Stripe-hosted checkout, so card data never touches our servers (smallest possible payment-security scope).
- **Public exposure kept small:** share links `noindex`, optional expiry, revocable; Business admins can disable them; **"Report abuse"** button on every public page.
- **Consistent, documented moderation** following the AUP (good-faith moderation is generally protected for platforms in the US, Section 230); keep decision records.
- **Copyright takedowns:** publish a takedown/contact process and register a DMCA designated agent with the US Copyright Office (low fee) to qualify for the copyright safe harbor for user content.
- **Honest marketing:** no guarantees ("bank-grade", "100% secure", "AI guarantees your plan works"); claims must match what's built.

**4. Collect less, keep less (the biggest technical lever)**
- Only collect what's needed: name, email, plan content. No phone numbers, addresses or birthdays; no file uploads at first (links only).
- **Short retention by default:** raw AI request/response text not stored (only results + token counts); moderation stores only the flagged excerpt; logs and Sentry scrub personal data and expire (e.g. 30 days); inactive free accounts deleted after a long notice period; deleted data purged from backups on their normal expiry (R2 90 days).
- Encryption in transit and at rest, least-privilege access, 2FA on all vendor accounts, audit log (sections 4b, 5c, 11): good security is the best defense if a breach is ever alleged.
- **Breach response runbook** with notification timelines (e.g. GDPR requires notifying the regulator within 72 hours of a qualifying breach; US states have their own rules).
- **Optional scope choice at launch:** starting US-only (or US + Canada) narrows which privacy laws apply; trade-off is a smaller market. Decide with the lawyer.

**5. Phasing:** data minimization, retention defaults, AI disclaimers and sensitive-data warnings are **built in from 1a** (cheapest when done first). Entity **before phase 4**. Insurance quotes, lawyer-reviewed Terms/Privacy/AUP/DPA, report-abuse button, breach runbook: **before phase 5**. DMCA agent, insurance in force, SLA terms: **before phase 6**.
