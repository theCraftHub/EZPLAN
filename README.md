# EZPLAN (working name)

> "EZPLAN" is an internal codename: another company uses the name, so the product will be renamed. The name, file extension and domain live in `shared/src/brand.ts`.

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

## Run it on your computer

Needs Node 22 or newer.

```bash
npm ci
npm run build          # builds the website (app/dist) and the self-hosted server (selfhost/dist)
```

Start the self-hosted server (it serves the website and the API on one port). It needs the site's address and at least one sign-in service (any OpenID Connect provider, for example Google or Microsoft):

```bash
PUBLIC_URL=http://localhost:8080 SECURE_COOKIES=0 \
OIDC_PROVIDERS='[{"id":"google","label":"Google","issuer":"https://accounts.google.com","clientId":"...","clientSecret":"..."}]' \
npm start -w selfhost
```

Sharing a plan: open the plan, choose **Share**, and make an invite link for someone's email (Editor or Viewer). Send the link yourself; it works once, for that address, for 7 days. If the server has `ALLOWED_EMAILS` set (the private build), add the person's address there too, or they can't sign in.

Email (optional, off by default): every email the app writes (safety follow-ups for now) is kept in the database outbox until sending is set up. `MAIL_FROM` and `MAIL_REPLY_DOMAIN` set the sender and the domain replies come back to (defaults come from `PUBLIC_URL`); `INBOUND_EMAIL_SECRET` turns on replies by email: your email provider posts received mail as JSON (`{ "from", "to", "text" }`) to `/inbound/email` with the header `Authorization: Bearer <secret>`.

Checks:

```bash
npm run check          # type checks + unit and API tests (both hosts: Node and Cloudflare in Miniflare)
npm run e2e            # browser tests on a phone and a desktop screen, against the real self-hosted build
npm run shots -w app   # saves screenshots of every screen to app/e2e/.results/shots
```

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
