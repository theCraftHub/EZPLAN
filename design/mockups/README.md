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
| Desktop IT admin console | Admin.dc.html |
| Desktop Team schedule (people × days, availability under the work, drag preview, what-if) | TeamDesktop.dc.html |

The Team schedule and Availability boards use the kitchen remodel sample. Every date, finish date and what-if in them is real output of the scheduling engine (`levelPlan` in `shared/src/level.ts`): Jordan full time with 3h Tuesday meetings, Priya 20 h a week and off Jan 12 to 13.
