# The plan file format (version 1)

> The header key and extensions come from `shared/src/brand.ts`. If the product is ever renamed again, the old key and extensions stay accepted so existing files keep importing.

A `.rakuplan` file is plain text (Markdown). People can read and edit it in any app, AI assistants can write it, and Rakuplan reads it back without losing progress. Files ending in `.rakuplan.md` are the same format.

## Example

```markdown
---
rakuplan: 1
id: 7f3a
title: Spring Charity Gala
goal: Host a 200-guest fundraising dinner raising $50k.
done_when: Event held, $50k raised, thank-you notes sent.
start: 2026-12-01
team: Sam <sam@co.com>, Ana <ana@co.com>
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

## 1. Header (front matter)
Between two `---` lines. `rakuplan: 1` is required; everything else is optional.

| Key | Meaning |
|---|---|
| `rakuplan` | Format version (1) |
| `id` | Plan ID, so a re-imported file updates the same plan |
| `title` | Plan name |
| `goal` | What the project must achieve (the Plan Check measures against it) |
| `done_when` | How you'll know it's finished |
| `start` | Start date, `YYYY-MM-DD` |
| `team` | `Name <email>, Name` (suggestions only: never grants access by itself) |
| `currency` | For budgets, e.g. `USD` |
| `baseline_set` | Date the original plan was saved |
| `based_on` | Version tag in an AI update reply |
| `hours_per_day` | Length of a working day for this plan's estimates, e.g. `7.5`. Written only when it isn't 8 (the workspace's standard week isn't 40 h over 5 days), so "2d" means the same thing in any workspace. Unset = the workspace's setting. |
| `note` | A plan-wide note or assumption; repeat the line for more (`note: Assumption: no permit needed`). "Assumption:" or "Note:" lines written below the tasks are read the same way. |

Unknown keys are kept, so files from newer versions survive a round trip.

## 2. Phases
`## P1: Phase name`, optionally followed by `> one-line description`. `## Phase 1: Name` and plain `## Name` also work.

## 3. Tasks
One list item per task:

```
- [status] ID: Title (estimate) @Owner !priority #tag due: DATE depends: IDS done: DATE by NAME
```

| Part | Written as | Notes |
|---|---|---|
| Status | `[ ]` to do · `[/]` in progress · `[x]` done · `[-]` skipped | Also accepted: `[X]`, `☐`, `✅`, `☑`, `✔` |
| ID | `T1:` task · `M1:` milestone | Missing IDs are added on import |
| Estimate | `(2d)` `(4h)` `(1w)` | Also `(3 days)`, `(16 hrs)`, `(1.5 weeks)`. 1 day = 8 hours, 1 week = 5 days |
| Milestone | `(milestone)` or an `M` ID | |
| Owner | `@Sam` or `@"Ana Lee"` | |
| Priority | `!high` `!medium` `!low` | |
| Tags | `#venue` | |
| Due date | `due: 2026-12-10` | |
| Waits on | `depends: T1, T2 SS+2d, M3 FF -1d` | Types: FS (default, finish-to-start), SS, FF; lag in working days. `after T1` also works |
| Done | `done: 2026-12-02 by Ana` | Who marked it complete (may differ from the owner) |
| Skipped | `skipped: 2026-12-05 by Sam` | |

Indented lines under a task:

| Line | Meaning |
|---|---|
| `planned: 2026-12-03 → 2026-12-09` | Original-plan (baseline) dates. `->` and `to` also work |
| `notes: …` | A note (repeatable) |
| `- [ ] …` | Subtask |
| `some_key: value` | Unknown attribute from a newer version, kept as is |

## 4. What Rakuplan forgives (AI-neutral reading)
- Text before or after the plan (an assistant's "Sure! Here's your plan…") is ignored, with a note.
- A plan inside a ```` ``` ```` code block is found automatically.
- `*`, `+`, `•` and numbered bullets; bold or italic titles; `T1.` or `T1)` IDs; curly quotes; Windows line endings.
- Plain checklists without a header are read in **tolerant mode**: the first `#` heading becomes the title, other headings become phases, list items become tasks.

## 5. Safety
- HTML tags, script content, `javascript:`/`data:` links and hidden characters are removed, with a note.
- Limits: 1,000,000 characters, 20,000 lines, 5,000 tasks per file.
- Nothing in a file can grant access, invite people, or claim someone else's work: team emails and `by` names are suggestions or labeled "from file" (see plan section 4c).

## 6. Not in the file (app only)
Comments, time logs and activity history. Reserved for later versions: costs (`cost:`), constraints (`start_after:`, `finish_by:`), `recurring:`, `approval:`, multiple named baselines and a `## RAID` section.

## 7. Approvals, repeats and master plans (Nov 27)

Task attributes (inline or on their own line under the task):
- `approver: Pat` names who must approve the task before it counts as done. `approved: 2027-01-12 by Pat` records the approval; only the app writes it.
- `repeat: weekly` (also `daily`, `weekdays`, `every 2 weeks`, `monthly`, `quarterly`, `yearly`, `every 3 days`): when the task is done or skipped, the next one is added right after it, due one interval later.

A whole master plan can be one text: the usual header and any whole-building tasks first, then each plan under its own `# Plan: Title` heading. A task in one plan waits on a task in another with the other plan's key, made from its title (`Office 2` → `office-2`), and `master/M1` for the whole-building tasks:

```
---
rakuplan: 1
title: HQ remodel
start: 2027-02-01
---
## P1: Whole building
- [ ] M1: Permit approved (milestone)

# Plan: Reception
## P1: Front
- [ ] T1: Demolish desk (2d) @Kai dept: Facilities depends: master/M1

# Plan: Office 2
## P1: Rooms
- [ ] T1: Walls (3d) @Kai depends: reception/T1
```
