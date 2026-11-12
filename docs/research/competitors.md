# Competitor research: project management apps

_Last updated 2026-11-12. Prices come from 2026 comparison articles and vendor pricing docs found via web search. Vendor pricing pages could not be fetched directly from the build environment, so **verify each figure on the vendor's page before making pricing decisions**. Sources disagree in places; ranges are shown where they do._

## 1. Pricing at a glance

| Tool | Free plan | Entry paid tier (per user / month) | Higher tiers | Notable pricing design |
|---|---|---|---|---|
| **Todoist** | Yes | ~$4 | Business ~$8 to $10 | Personal-first, cheapest |
| **Trello** | Yes | Standard $5 annual / $6 monthly | Premium, Enterprise | Timeline / Gantt only on higher tiers |
| **ClickUp** | Yes, unlimited members | Unlimited $7 annual / $10 monthly | Business $12 annual / $19 monthly | Very generous free tier |
| **Linear** | Yes | ~$8 to $10 | Business, Enterprise | Minimal, developer-focused |
| **Monday.com** | ~2 seats | Basic ~$9, Standard ~$12 | Pro ~$19 | **3-seat minimum** on paid plans (a solo user pays for 3) |
| **Smartsheet** | Trial only | Pro ~$7 to $9 | Business ~$19 to $25 | Spreadsheet-style planning |
| **Notion** | Yes | Plus ~$10 | Business ~$15 to $20 | AI historically a ~$8/user add-on |
| **Wrike** | Yes | Team ~$10 | Business ~$25 | Enterprise reporting focus |
| **Asana** | Small teams | Starter $10.99 annual / $13.49 monthly | Advanced, Enterprise | **5 AI requests / user / month (max 50 per account), then $0.50 per request** in prepaid packs |
| **TeamGantt** | n/a | Priced **per project**, not per user (e.g. Business includes 5 projects, +$24 per extra project) | | Unique per-project model |

**Patterns**
- A freemium entry point is the norm. The paid core band is **$5 to $11 per user per month**.
- Annual billing discount of ~15 to 20%.
- Timeline/Gantt, reporting, workload and automations are the usual paywall features.
- AI is either bundled with **monthly caps** (Asana) or sold as an **add-on / credit pack** (Notion, Asana packs).
- Biggest user complaints: **price creep** (key features locked to higher tiers), **complexity** (Jira, ClickUp), and seat minimums (Monday).

## 2. Design approaches

| Tool | Look and feel | What works | What to avoid |
|---|---|---|---|
| Monday.com | Bold color-coded status columns | Non-technical users read status instantly | Visual noise when everything is colored |
| Asana | Clean lists, calm whitespace | Easy scanning, clear ownership | Many clicks to reach settings |
| Linear | Minimal, fast, keyboard-first | Feels instant, calm | Too developer-specific for other industries |
| Trello | Cards on boards | Instantly understandable | Weak for dates and dependencies |
| ClickUp | Everything everywhere | Power and flexibility | Widely called overwhelming |
| Smartsheet / MS Project | Spreadsheet + Gantt | Serious scheduling (critical path, baselines) | Intimidating for casual users |
| Notion | Docs-first | Flexible, pretty | Weak portfolio / workload features |

**Direction for EZPLAN:** Linear's calm + Monday's clear status color, mobile-first, plain language. Show the serious scheduling power (critical path, baseline) visually without the spreadsheet feel.

## 3. Features adopted into EZPLAN (phase 1)

Milestones, baseline vs actual, AI status reports, task notes, assignees, workload view, real-time collaboration, project dashboard + all-projects dashboard, portfolio (Active / Completed / Archived), read-only share links, due-date reminders.

Deliberately skipped for now (complexity users complain about): custom fields everywhere, automation builders, time tracking and invoicing.

## 4. EZPLAN's angle

1. **Idea to an AI-checked, good-looking plan in ~2 minutes**: the customer's own Claude writes the plan, EZPLAN checks and visualizes it.
2. **No lock-in**: the `.ezplan` file is plain text that keeps tracking in any app.
3. **Simple, fair pricing**: no seat minimums and clear AI caps. Unit economics (`docs/finance/ezplan-unit-economics.xlsx`) show a ~$6 to $8 per user floor for a healthy margin, which fits inside the market band.

## Sources
- [PricePulse: PM pricing guide 2026](https://www.getpricepulse.com/blog/project-management-pricing-guide-2026.html)
- [StructFlows: ClickUp vs Notion vs Asana vs Monday 2026](https://www.structflows.com/resources/project-management/clickup-vs-notion-vs-asana-vs-monday/)
- [BizTechScout: Asana vs Monday vs ClickUp vs Jira vs Trello 2026](https://biztechscout.com/en/article/best-project-management-tools-2026)
- [Stork: monday.com alternatives 2026](https://www.stork.ai/blog/monday-com-alternatives-2026)
- [CostBench: PM software pricing 2026](https://www.costbench.com/software/project-management/)
- [Toolradar: PM software cost benchmarks](https://toolradar.com/benchmarks/project-management-software-cost)
- [Toolradar: best AI PM tools](https://toolradar.com/guides/best-ai-project-management-tools)
- [dev.to: 7 best AI PM tools 2026](https://dev.to/aristoaistack/7-best-ai-project-management-tools-2026-ranked-1afl)
- [GetApp: Gantt / task scheduling reviews](https://www.getapp.com/project-management-planning-software/gantt-chart/f/task-scheduling)
- [GetApp: customizable templates reviews](https://www.getapp.com/project-management-planning-software/project-planning/f/customizable-templates/)
- [Teamwork: PM tool comparison](https://www.teamwork.com/project-management-software/)
