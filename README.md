# EZPLAN

Turn any project description into a clear, good-looking, AI-checked plan your team can track together, on phone or desktop.

**Status:** Phase 0 (design + business). Private beta to follow.

## How it works
1. **Get prompt**: copy EZPLAN's prompt and paste it into your own Claude with your project notes.
2. **Paste the reply** into EZPLAN. It builds the plan and runs an **AI Plan Check** (is it aligned with the goal, does it make sense?).
3. **Track** it with your team: checklist, timeline, workload, dashboards.
4. **Export** a `.ezplan` file that keeps tracking in any app.

## Repo map
| Path | What |
|---|---|
| `docs/research/competitors.md` | Competitor pricing + design research |
| `docs/finance/ezplan-unit-economics.xlsx` | Unit economics model (edit blue cells on Assumptions) |
| `scripts/build_finance_model.py` | Regenerates the finance model template |
| `docs/PLAN.md` | The full approved build plan |
| `design/mockups/` | Clickable UI mockups for review |

## Roadmap
| Phase | Contents |
|---|---|
| 0 | Mockups, competitor research, finance model |
| 1a | Solo core: format + parser, dashboards, checklist, timeline, AI Plan Check, export/import, login |
| 1b | Teams: workspaces, assignees, live collaboration, workload, portfolio |
| 1c | Share links, reminders, AI status reports, calendar export |
| 2 | In-app AI generation + helpers |
| 3 | Optional Claude connector |
| 4 | Public launch: accounts, subscriptions, native apps |
