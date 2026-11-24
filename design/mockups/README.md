# EZPLAN mockups

Clickable design mockups (Phase 0), published as a design canvas: https://claude.ai/artifact/2oxB1WmPNDAys16AYAbUdf

Files are `.dc.html` design components (one per screen) plus `canvas.json` (layout). Sample data uses a charity gala to show the all-industries look.

| Screen | File |
|---|---|
| Home (all projects) | Main.dc.html |
| Project dashboard | Project.dc.html |
| Checklist | Checklist.dc.html |
| Timeline | Timeline.dc.html |
| Team schedule (phone: week strip, day and person views, move/reassign sheet with best options) | Workload.dc.html |
| Availability (phone: step at import + My availability with hours, workdays, time off, calendar) | Availability.dc.html |
| Portfolio | Portfolio.dc.html |
| New plan + Plan Check | NewPlan.dc.html |
| Update with my AI (round trip + change preview) | UpdateAI.dc.html |
| Calendar | Calendar.dc.html |
| Personal first run | FirstRun.dc.html |
| Desktop project workspace (overview, grid + Gantt, RAID, status updates, task drawer) | Desktop.dc.html |
| Desktop Team schedule (people × days, availability under the work, drag preview, what-if) | TeamDesktop.dc.html |
| **Gate B:** IT admin console, one side panel with every section. Manage: Overview with security checklist, People with bulk dry run + undo, Offboarding wizard, Groups mapping. Security and billing: Setup wizard, Policies with impact preview incl. company work week, Audit log + SIEM streaming, Licenses with seat reclaim + chargeback, AI spending (cost by person, project and department, each clickable for a breakdown) | AdminConsole.dc.html |
| **Gate B:** IT admin on a phone: every section of the desktop console (same side-panel groups in a "Sections" sheet, same data and steps), person sheet, add people with preview | AdminPhone.dc.html |
| **Gate B:** Business onboarding: company, domain (continue while it verifies), sign-in questions, connect + test sign-in, choose directory groups, second admin + welcome email preview + what employees see, seats that follow the people count, AI, rules, first plan, go live | BusinessOnboarding.dc.html |
| **Master plans:** one plan made of many (Northfield HQ remodel: Reception, Kitchen, Bathrooms 1 to 3, Offices 1 to 3), run by Facilities with IT, HR, Finance and Safety. Overview with "what decides move-in" and what-ifs, all plans on one timeline, Departments (what each owes, people booked across every plan), a plan inside the master with each task's comments and @mentions, Discussion (one thread per plan plus the whole building, messages can point at a task), Activity across all plans filtered by plan and department | MasterDesktop.dc.html |
| **Master plans** on a phone: same views and data | MasterPhone.dc.html |

The Team schedule and Availability boards use the kitchen remodel sample. Every date, finish date and what-if in them is real output of the scheduling engine (`levelPlan` in `shared/src/level.ts`): Jordan full time with 3h Tuesday meetings, Priya 20 h a week and off Jan 12 to 13.

The Gate B boards use a fictional company, Northfield Builders (construction, about 180 people, `northfield.example`, Microsoft 365), with whole-dollar prices from the finance model. Screenshots of key states are in `screenshots/` (`ac-*`/`ad-*` desktop admin, `pa-*` phone admin, `bo-*` onboarding).

The desktop and phone admin boards are built from one shared logic file so they can't drift apart: edit `src/logic.js`, `src/desktop.html` or `src/phone.html` (shared panels in `src/parts/`), then run `python3 src/build.py <folder>` to write both boards.


The master plan boards are built from `src-master/` (one `logic.js` for both sizes, `data.json` from the scheduling engine run on the whole remodel, so one person's hours count across every plan): `python3 src-master/build.py <folder>`. Screenshots: `screenshots/mp-*` (desktop) and `mpp-*` (phone); `*-comments`, `*-discussion` and `*-activity` show the conversation views. The sample is seen as Dana Reyes (Facilities lead); messages from others posted on the sample's today (Mar 8) count as unread.
