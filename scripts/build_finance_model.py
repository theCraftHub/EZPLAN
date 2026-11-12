"""Builds docs/finance/ezplan-unit-economics.xlsx.

Every output is a formula driven by the Assumptions sheet, so the workbook can be
opened in Excel / Google Sheets / Numbers and edited directly. Re-run this script
only to regenerate the template from scratch.

    python3 scripts/build_finance_model.py
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

OUT = Path(__file__).resolve().parent.parent / "docs" / "finance" / "ezplan-unit-economics.xlsx"
CHECKED = "2026-11-12"

FONT = "Arial"
BLUE = Font(name=FONT, color="0000FF")
BLACK = Font(name=FONT, color="000000")
GREEN = Font(name=FONT, color="008000")
BOLD = Font(name=FONT, bold=True)
TITLE = Font(name=FONT, bold=True, size=14)
HEAD = Font(name=FONT, bold=True, color="FFFFFF")
HEAD_FILL = PatternFill("solid", fgColor="334155")
SECTION_FILL = PatternFill("solid", fgColor="E2E8F0")
KEY_FILL = PatternFill("solid", fgColor="FFFF00")
THIN = Border(bottom=Side(style="thin", color="CBD5E1"))

USD = '$#,##0.00;($#,##0.00);"-"'
USD4 = '$#,##0.0000;($#,##0.0000);"-"'
USD0 = '$#,##0;($#,##0);"-"'
NUM = '#,##0;(#,##0);"-"'
NUM2 = '#,##0.00;(#,##0.00);"-"'
NUM3 = '#,##0.000;(#,##0.000);"-"'
PCT = '0.0%;(0.0%);"-"'

wb = Workbook()
REF: dict[str, str] = {}  # name -> absolute cross-sheet reference


def ref(sheet: str, col: int, row: int) -> str:
    return f"{sheet}!${get_column_letter(col)}${row}"


def header(ws, row, labels, widths=None):
    for i, label in enumerate(labels, start=1):
        c = ws.cell(row=row, column=i, value=label)
        c.font = HEAD
        c.fill = HEAD_FILL
        c.alignment = Alignment(horizontal="center" if i > 1 else "left", vertical="center", wrap_text=True)
    if widths:
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w


def section(ws, row, text, ncols):
    for col in range(1, ncols + 1):
        ws.cell(row=row, column=col).fill = SECTION_FILL
    ws.cell(row=row, column=1, value=text).font = BOLD


def style_row(ws, row, ncols):
    for col in range(1, ncols + 1):
        ws.cell(row=row, column=col).border = THIN


# ---------------------------------------------------------------- ReadMe
rd = wb.active
rd.title = "ReadMe"
rd.column_dimensions["A"].width = 110
lines = [
    ("EZPLAN unit economics model", TITLE),
    (f"Template built {CHECKED}. Prices were last checked on that date (see Source column on Assumptions).", BLACK),
    ("", BLACK),
    ("HOW TO USE", BOLD),
    ("1. Edit only BLUE numbers on the Assumptions sheet (yellow = the key levers). Everything else recalculates.", BLACK),
    ("2. UnitCosts: what one user of each type costs us per month (AI, Cloudflare, email).", BLACK),
    ("3. Pricing: gross margin at candidate prices, and the MINIMUM price per user to hit the target margin.", BLACK),
    ("4. Scenarios: total monthly profit/loss at 100 / 1k / 10k / 100k total users (free + paid), with real included allowances.", BLACK),
    ("5. TierCaps: how many AI uses a paid tier can include before margin drops below target.", BLACK),
    ("5b. Enterprise: profit per company-wide customer (25 / 200 / 1,000 seats) (direct sign-in below the WorkOS seat threshold, WorkOS above it).", BLACK),
    ("6. Actuals: paste monthly numbers from the app's Admin > Economics CSV export to compare reality with the model.", BLACK),
    ("", BLACK),
    ("COLOR LEGEND", BOLD),
    ("Blue text = input you can change. Black = formula. Green = pulled from another sheet. Yellow fill = key lever.", BLACK),
    ("", BLACK),
    ("KEY DEFINITIONS", BOLD),
    ("List price = the monthly-billed price per user. Annual plans get the annual discount. Annual share = % of payers on annual billing.", BLACK),
    ("Gross margin = (revenue - payment fees - AI - infrastructure - email - cost of free users) / revenue. Fixed costs are excluded from margin and handled in Scenarios / break-even.", BLACK),
    ("Phase 1 = plans written by the customer's own Claude; we pay only for Plan Checks + status reports. Phase 2 adds in-app generation and AI helpers.", BLACK),
    ("", BLACK),
    ("CAVEATS", BOLD),
    ("Vendor prices come from public pricing docs and 2026 comparison articles; vendor pages could not be fetched from the build environment. Re-check before decisions.", BLACK),
    ("Claude costs ignore prompt caching discounts (conservative). Taxes, refunds, chargebacks, support staff and marketing are not included unless added as fixed costs.", BLACK),
]
for i, (text, font) in enumerate(lines, start=1):
    c = rd.cell(row=i, column=1, value=text)
    c.font = font
    c.alignment = Alignment(wrap_text=True, vertical="top")

# ---------------------------------------------------------------- Assumptions
A = "Assumptions"
ws = wb.create_sheet(A)
header(ws, 1, ["Assumption", "Value", "Unit", "Source / note"], [46, 16, 18, 90])
row = 2

SRC_CLAUDE = "Anthropic API pricing (Claude API skill model table, cached 2026-10-06). Haiku price applies to prompts up to 100K tokens."
SRC_CF = "Cloudflare Workers/D1/Durable Objects pricing docs (developers.cloudflare.com), via search " + CHECKED
SRC_RESEND = "resend.com/pricing + Resend docs (via search " + CHECKED + ")"
SRC_STRIPE = "Stripe US standard pricing + Stripe Billing 0.7% (via search " + CHECKED + ")"
SRC_EST = "EZPLAN estimate; replace with Actuals once the app is live"

blocks = [
    ("Claude API prices (per 1M tokens)", [
        ("haiku_in", "Haiku 5.5 input", 0.10, "$ / 1M tokens", SRC_CLAUDE, USD),
        ("haiku_out", "Haiku 5.5 output", 0.50, "$ / 1M tokens", SRC_CLAUDE, USD),
        ("sonnet_in", "Sonnet 5.5 input", 2.00, "$ / 1M tokens", SRC_CLAUDE, USD),
        ("sonnet_out", "Sonnet 5.5 output", 10.00, "$ / 1M tokens", SRC_CLAUDE, USD),
    ]),
    ("Tokens per AI call (input / output incl. thinking)", [
        ("qc_in", "Quick Plan Check (Haiku) input", 6000, "tokens", "Prompt + format spec + plan + free-check findings. " + SRC_EST, NUM),
        ("qc_out", "Quick Plan Check (Haiku) output", 2500, "tokens", SRC_EST, NUM),
        ("dc_in", "Deep Plan Check (Sonnet) input", 6000, "tokens", SRC_EST, NUM),
        ("dc_out", "Deep Plan Check (Sonnet) output", 3000, "tokens", SRC_EST, NUM),
        ("sr_in", "Status report (Haiku) input", 5000, "tokens", SRC_EST, NUM),
        ("sr_out", "Status report (Haiku) output", 2000, "tokens", SRC_EST, NUM),
        ("gen_in", "In-app plan generation (Sonnet) input, phase 2", 6000, "tokens", SRC_EST, NUM),
        ("gen_out", "In-app plan generation (Sonnet) output, phase 2", 8000, "tokens", SRC_EST, NUM),
        ("hp_in", "In-app helper: re-plan / next / break down (Haiku) input, phase 2", 5000, "tokens", SRC_EST, NUM),
        ("hp_out", "In-app helper (Haiku) output, phase 2", 2500, "tokens", SRC_EST, NUM),
    ]),
    ("Cloudflare (Workers Paid plan)", [
        ("cf_base", "Workers Paid base fee", 5.00, "$ / month", SRC_CF, USD),
        ("req_incl", "Worker requests included", 10_000_000, "requests / month", SRC_CF, NUM),
        ("req_rate", "Worker requests overage", 0.30, "$ / 1M requests", SRC_CF, USD),
        ("d1r_incl", "D1 rows read included", 25_000_000_000, "rows / month", SRC_CF, NUM),
        ("d1r_rate", "D1 rows read overage", 0.001, "$ / 1M rows", SRC_CF, USD4),
        ("d1w_incl", "D1 rows written included", 50_000_000, "rows / month", SRC_CF, NUM),
        ("d1w_rate", "D1 rows written overage", 1.00, "$ / 1M rows", SRC_CF, USD),
        ("d1s_incl", "D1 storage included", 5, "GB", SRC_CF, NUM),
        ("d1s_rate", "D1 storage overage", 0.75, "$ / GB-month", SRC_CF, USD),
        ("dor_incl", "Durable Objects requests included", 1_000_000, "requests / month", SRC_CF, NUM),
        ("dor_rate", "Durable Objects requests overage", 0.15, "$ / 1M requests", SRC_CF, USD),
        ("dod_incl", "Durable Objects duration included", 400_000, "GB-s / month", SRC_CF + ". Billed at 128 MB per active object; hibernating sockets are not billed.", NUM),
        ("dod_rate", "Durable Objects duration overage", 12.50, "$ / 1M GB-s", SRC_CF, USD),
    ]),
    ("Email (Resend)", [
        ("em_free", "Free tier emails", 3000, "emails / month", SRC_RESEND + ". Also capped at 100/day.", NUM),
        ("em_pro", "Pro plan price", 20.00, "$ / month", SRC_RESEND, USD),
        ("em_pro_incl", "Pro plan emails included", 50_000, "emails / month", SRC_RESEND, NUM),
        ("em_over", "Pro overage", 0.90, "$ / 1,000 emails", SRC_RESEND, USD),
    ]),
    ("Payments (Stripe)", [
        ("st_pct", "Card fee %", 0.029, "% of charge", SRC_STRIPE, PCT),
        ("st_fix", "Card fee fixed", 0.30, "$ / charge", SRC_STRIPE, USD),
        ("st_bill", "Stripe Billing fee %", 0.007, "% of recurring revenue", SRC_STRIPE, PCT),
    ]),
    ("Fixed costs (monthly)", [
        ("fx_domain", "Domain (~$10/yr)", 10 / 12, "$ / month", "Typical .com renewal; amortized", USD),
        ("fx_apple", "Apple Developer ($99/yr, from launch)", 99 / 12, "$ / month", "Apple Developer Program; amortized", USD),
        ("fx_google", "Google Play ($25 one-time, amortized over 12 months)", 25 / 12, "$ / month", "Google Play Console; set to 0 after year 1", USD),
        ("fx_tools", "Other tools / monitoring / misc", 30.00, "$ / month", "User input: placeholder", USD),
        ("fx_legal", "Accounting / legal / company fees", 0.00, "$ / month", "User input: set when known", USD),
        ("fx_owner", "Owner pay target", 0.00, "$ / month", "User input: set to see the users needed to pay yourself", USD),
    ]),
    ("Business levers", [
        ("price", "List price (monthly billing) per user", 10.00, "$ / user / month", "Key lever. Market band $5 to $11 (see docs/research/competitors.md)", USD),
        ("ann_disc", "Annual plan discount", 0.20, "%", "Market norm ~15-20%", PCT),
        ("ann_share", "Share of payers on annual billing", 0.60, "%", "Estimate", PCT),
        ("free_ratio", "Free users per paying user", 25, "users", "~3-5% free-to-paid conversion means 20-33 free users per payer", NUM),
        ("target_gm", "Target gross margin", 0.80, "%", "SaaS norm 75-85%", PCT),
        ("inapp", "In-app AI enabled (phase 2)? 1 = yes, 0 = no", 1, "flag", "Drives Scenarios + TierCaps", NUM),
        ("mix_l", "Paid users: share light", 0.50, "%", "Estimate", PCT),
        ("mix_t", "Paid users: share typical", 0.35, "%", "Estimate", PCT),
        ("mix_h", "Paid users: share heavy", 0.15, "%", "Estimate; light + typical + heavy should total 100%", PCT),
    ]),
    ("Enterprise (company-wide licenses)", [
        ("ent_price", "Enterprise price per seat (annual contract, per month)", 15.00, "$ / seat / month", "Key lever. Placeholder; market Business/Enterprise tiers ~$12-25", USD),
        ("ent_min", "Minimum seats per Enterprise contract", 25, "seats", "Keeps fixed identity costs a small share of revenue", NUM),
        ("ent_sso", "SSO connection (WorkOS) per company", 125.00, "$ / company / month", "WorkOS pricing via search " + CHECKED + "; volume discounts down to ~$65", USD),
        ("ent_scim", "Directory sync / SCIM (WorkOS) per company", 125.00, "$ / company / month", "WorkOS pricing via search " + CHECKED + "; billed separately from SSO", USD),
        ("ent_support", "Support / account management per company", 50.00, "$ / company / month", "User input: placeholder for support time", USD),
        ("ent_pay", "Invoice / ACH payment fee", 0.008, "% of invoice", "Stripe ACH ~0.8% (capped per payment); conservative, no cap applied", PCT),
        ("ent_id_max", "Max identity cost as share of revenue", 0.05, "%", "Target used to compute the WorkOS seat threshold (see Enterprise sheet)", PCT),
        ("ent_workos_min", "Use WorkOS from this many seats (below: direct Microsoft/Google + own SCIM, $0)", 350, "seats", "Decision: direct for most companies, WorkOS for large-seat companies. Set near the computed threshold on the Enterprise sheet", NUM),
    ]),
]
KEY = {"price", "free_ratio", "target_gm", "inapp", "ann_share", "ent_price"}
for title, items in blocks:
    section(ws, row, title, 4)
    row += 1
    for name, label, value, unit, src, fmt in items:
        ws.cell(row=row, column=1, value=label).font = BLACK
        v = ws.cell(row=row, column=2, value=value)
        v.font = BLUE
        v.number_format = fmt
        if name in KEY:
            v.fill = KEY_FILL
        ws.cell(row=row, column=3, value=unit).font = BLACK
        ws.cell(row=row, column=4, value=src).font = BLACK
        ws.cell(row=row, column=4).alignment = Alignment(wrap_text=True)
        style_row(ws, row, 4)
        REF[name] = ref(A, 2, row)
        row += 1
    row += 1

# mix check
ws.cell(row=row, column=1, value="Check: paid mix total (must be 100%)").font = BOLD
c = ws.cell(row=row, column=2, value=f"={REF['mix_l']}+{REF['mix_t']}+{REF['mix_h']}")
c.number_format = PCT
row += 2

# Usage block (per user per month), columns B..E = Light, Typical, Heavy, Free
section(ws, row, "Usage per user per month", 6)
row += 1
for i, label in enumerate(["Metric", "Light (paid)", "Typical (paid)", "Heavy (paid)", "Free user", "Note"], start=1):
    c = ws.cell(row=row, column=i, value=label)
    c.font = HEAD
    c.fill = HEAD_FILL
ws.column_dimensions["E"].width = 14
ws.column_dimensions["F"].width = 60
row += 1
USAGE = [
    ("u_qc", "Quick Plan Checks", (5, 15, 40, 3), NUM, "Every new plan + re-checks after plan edits"),
    ("u_dc", "Deep Plan Checks", (0, 2, 8, 0), NUM, "Optional Sonnet check"),
    ("u_sr", "Status reports", (1, 4, 12, 0), NUM, "One tap AI summary"),
    ("u_gen", "In-app plan generations (phase 2)", (1, 4, 12, 0), NUM, "Sonnet; free tier excluded"),
    ("u_hp", "In-app helper calls (phase 2)", (2, 10, 40, 0), NUM, "Re-plan / What's next / Break down"),
    ("u_em", "Emails (reminders/digests/invites)", (4, 22, 30, 4), NUM, "Daily digest ~22 workdays"),
    ("u_req", "Worker requests (API + page loads)", (1500, 5000, 15000, 500), NUM, SRC_EST),
    ("u_dor", "Durable Object requests (live edits, WebSocket msgs)", (500, 3000, 12000, 100), NUM, "Incoming WebSocket messages billed 20:1 per third-party calculators; conservative 1:1 here"),
    ("u_dod", "Durable Object duration", (50, 256, 1000, 10), NUM, "GB-s; 0.128 GB x active seconds"),
    ("u_d1r", "D1 rows read", (20000, 80000, 300000, 5000), NUM, SRC_EST),
    ("u_d1w", "D1 rows written", (500, 2000, 8000, 100), NUM, SRC_EST),
    ("u_gb", "Storage", (0.002, 0.01, 0.05, 0.001), NUM3, "GB per user"),
]
USAGE_ROW = {}
for name, label, vals, fmt, note in USAGE:
    ws.cell(row=row, column=1, value=label).font = BLACK
    for j, v in enumerate(vals):
        c = ws.cell(row=row, column=2 + j, value=v)
        c.font = BLUE
        c.number_format = fmt
    ws.cell(row=row, column=6, value=note).font = BLACK
    style_row(ws, row, 6)
    USAGE_ROW[name] = row
    row += 1
ws.freeze_panes = "B2"

# ---------------------------------------------------------------- UnitCosts
U = "UnitCosts"
uc = wb.create_sheet(U)
header(uc, 1, ["Item", "Light (paid)", "Typical (paid)", "Heavy (paid)", "Free user", "Blended paid", "Note"], [46, 15, 15, 15, 15, 15, 60])
r = 2
section(uc, r, "Cost per AI call", 7)
r += 1
CALLS = [
    ("cpc_qc", "Quick Plan Check", "qc", "haiku"),
    ("cpc_dc", "Deep Plan Check", "dc", "sonnet"),
    ("cpc_sr", "Status report", "sr", "haiku"),
    ("cpc_gen", "In-app plan generation", "gen", "sonnet"),
    ("cpc_hp", "In-app helper call", "hp", "haiku"),
]
for name, label, key, model in CALLS:
    uc.cell(row=r, column=1, value=label).font = BLACK
    f = f"=({REF[key + '_in']}*{REF[model + '_in']}+{REF[key + '_out']}*{REF[model + '_out']})/1000000"
    c = uc.cell(row=r, column=2, value=f)
    c.font = GREEN
    c.number_format = USD4
    uc.cell(row=r, column=7, value="$ per call (column B)").font = BLACK
    REF[name] = ref(U, 2, r)
    style_row(uc, r, 7)
    r += 1
r += 1

COLS = [2, 3, 4, 5]  # Light, Typical, Heavy, Free on both sheets


def ucell(name, col):
    """Usage cell on Assumptions for a user-type column."""
    return f"{A}!${get_column_letter(col)}${USAGE_ROW[name]}"


section(uc, r, "Usage per user per month (from Assumptions) + blended paid", 7)
r += 1
UROW = {}
for name, label, _vals, fmt, _note in USAGE:
    uc.cell(row=r, column=1, value=label).font = BLACK
    for col in COLS:
        c = uc.cell(row=r, column=col, value="=" + ucell(name, col))
        c.font = GREEN
        c.number_format = fmt
    c = uc.cell(row=r, column=6, value=f"=B{r}*{REF['mix_l']}+C{r}*{REF['mix_t']}+D{r}*{REF['mix_h']}")
    c.number_format = fmt
    UROW[name] = r
    style_row(uc, r, 7)
    r += 1
r += 1

section(uc, r, "Monthly cost per user ($)", 7)
r += 1


def line(label, formula_for_col, note="", fmt=USD4, bold=False, blended=True):
    global r
    uc.cell(row=r, column=1, value=label).font = BOLD if bold else BLACK
    for col in COLS:
        L = get_column_letter(col)
        c = uc.cell(row=r, column=col, value=formula_for_col(L))
        c.number_format = fmt
        if bold:
            c.font = BOLD
    if blended:
        c = uc.cell(row=r, column=6, value=f"=B{r}*{REF['mix_l']}+C{r}*{REF['mix_t']}+D{r}*{REF['mix_h']}")
        c.number_format = fmt
        if bold:
            c.font = BOLD
    uc.cell(row=r, column=7, value=note).font = BLACK
    style_row(uc, r, 7)
    out = r
    r += 1
    return out


R_AICORE = line("AI: Plan Checks + status reports (phase 1)",
                lambda L: f"={L}{UROW['u_qc']}*{REF['cpc_qc']}+{L}{UROW['u_dc']}*{REF['cpc_dc']}+{L}{UROW['u_sr']}*{REF['cpc_sr']}")
R_AIAPP = line("AI: in-app generation + helpers (phase 2)",
               lambda L: f"={L}{UROW['u_gen']}*{REF['cpc_gen']}+{L}{UROW['u_hp']}*{REF['cpc_hp']}")
R_INFRA = line("Cloudflare (marginal, ignores included allowances)",
               lambda L: (f"={L}{UROW['u_req']}/1000000*{REF['req_rate']}"
                          f"+{L}{UROW['u_dor']}/1000000*{REF['dor_rate']}"
                          f"+{L}{UROW['u_dod']}/1000000*{REF['dod_rate']}"
                          f"+{L}{UROW['u_d1r']}/1000000*{REF['d1r_rate']}"
                          f"+{L}{UROW['u_d1w']}/1000000*{REF['d1w_rate']}"
                          f"+{L}{UROW['u_gb']}*{REF['d1s_rate']}"),
               "Conservative: real bills are lower until included allowances are used up (see Scenarios)")
R_EMAIL = line("Email (marginal at Resend Pro rate)",
               lambda L: f"={L}{UROW['u_em']}*{REF['em_pro']}/{REF['em_pro_incl']}")
R_P1 = line("TOTAL phase 1 (checks + reports)", lambda L: f"={L}{R_AICORE}+{L}{R_INFRA}+{L}{R_EMAIL}", bold=True)
R_P2 = line("TOTAL phase 2 (adds in-app AI)", lambda L: f"={L}{R_P1}+{L}{R_AIAPP}", bold=True)
r += 1

section(uc, r, "Cost per PAYING user including the free users they carry", 7)
r += 1
uc.cell(row=r, column=1, value="Free users carried per payer").font = BLACK
c = uc.cell(row=r, column=6, value=f"={REF['free_ratio']}")
c.font = GREEN
R_FR = r
r += 1
uc.cell(row=r, column=1, value="Free-user subsidy per payer, phase 1").font = BLACK
c = uc.cell(row=r, column=6, value=f"=F{R_FR}*E{R_P1}")
c.number_format = USD4
R_SUB1 = r
r += 1
uc.cell(row=r, column=1, value="Free-user subsidy per payer, phase 2").font = BLACK
c = uc.cell(row=r, column=6, value=f"=F{R_FR}*E{R_P2}")
c.number_format = USD4
uc.cell(row=r, column=7, value="Free users get no in-app AI, so equal to phase 1 unless Free usage is changed").font = BLACK
R_SUB2 = r
r += 1
for label, base_row, sub_row, key in [
    ("Variable cost per payer, phase 1 (blended)", R_P1, R_SUB1, "C_p1"),
    ("Variable cost per payer, phase 2 (blended)", R_P2, R_SUB2, "C_p2"),
]:
    uc.cell(row=r, column=1, value=label).font = BOLD
    c = uc.cell(row=r, column=6, value=f"=F{base_row}+F{sub_row}")
    c.number_format = USD4
    c.font = BOLD
    c.fill = KEY_FILL
    REF[key] = ref(U, 6, r)
    r += 1
for label, base_row, sub_row, key in [
    ("Variable cost per HEAVY payer, phase 1", R_P1, R_SUB1, "Ch_p1"),
    ("Variable cost per HEAVY payer, phase 2", R_P2, R_SUB2, "Ch_p2"),
]:
    uc.cell(row=r, column=1, value=label).font = BLACK
    c = uc.cell(row=r, column=6, value=f"=D{base_row}+F{sub_row}")
    c.number_format = USD4
    REF[key] = ref(U, 6, r)
    r += 1
# expose per-type references for later sheets
REF["free_cost"] = ref(U, 5, R_P1)
REF["infra_email_blend"] = f"({ref(U, 6, R_INFRA)}+{ref(U, 6, R_EMAIL)})"
REF["sub1"] = ref(U, 6, R_SUB1)
REF["aicore_blend"] = ref(U, 6, R_AICORE)
REF["aiapp_blend"] = ref(U, 6, R_AIAPP)
REF["aicore_free"] = ref(U, 5, R_AICORE)
REF["p1_blend"] = ref(U, 6, R_P1)
REF["p2_blend"] = ref(U, 6, R_P2)
for name in UROW:
    REF[name + "_paid"] = ref(U, 6, UROW[name])
    REF[name + "_free"] = ref(U, 5, UROW[name])
uc.freeze_panes = "B2"

# ---------------------------------------------------------------- Pricing
P = "Pricing"
pr = wb.create_sheet(P)
header(pr, 1, ["Metric", "Value", "", "", "", "", "", "Note"], [50, 14, 14, 14, 14, 14, 14, 60])
r = 2
section(pr, r, "Billing mechanics", 8)
r += 1
mech = [
    ("k", "Effective revenue factor (monthly/annual mix after discount)",
     f"=(1-{REF['ann_share']})+{REF['ann_share']}*(1-{REF['ann_disc']})", NUM3, "Revenue per user per month = list price x this"),
    ("f", "Percentage payment fees", f"={REF['st_pct']}+{REF['st_bill']}", PCT, "Card % + Billing %"),
    ("F0", "Fixed payment fee per payer per month", f"={REF['st_fix']}*((1-{REF['ann_share']})+{REF['ann_share']}/12)", USD4, "Annual payers pay the $0.30 once a year"),
    ("fixed_total", "Fixed costs per month (incl. Cloudflare base)",
     f"={REF['cf_base']}+{REF['fx_domain']}+{REF['fx_apple']}+{REF['fx_google']}+{REF['fx_tools']}+{REF['fx_legal']}+{REF['fx_owner']}", USD, "From Assumptions"),
]
for name, label, f, fmt, note in mech:
    pr.cell(row=r, column=1, value=label).font = BLACK
    c = pr.cell(row=r, column=2, value=f)
    c.number_format = fmt
    pr.cell(row=r, column=8, value=note).font = BLACK
    REF[name] = ref(P, 2, r)
    style_row(pr, r, 8)
    r += 1
r += 1

section(pr, r, "Minimum list price per user to hit the target gross margin", 8)
r += 1
minp = [
    ("Blended payer, phase 1", "C_p1"),
    ("Blended payer, phase 2 (with in-app AI)", "C_p2"),
    ("Heavy payer, phase 1", "Ch_p1"),
    ("Heavy payer, phase 2 (with in-app AI)", "Ch_p2"),
]
for label, key in minp:
    pr.cell(row=r, column=1, value=label).font = BOLD
    f = f"=({REF[key]}+{REF['F0']})/({REF['k']}*(1-{REF['f']}-{REF['target_gm']}))"
    c = pr.cell(row=r, column=2, value=f)
    c.number_format = USD
    c.font = BOLD
    c.fill = KEY_FILL
    pr.cell(row=r, column=8, value="$ / user / month (monthly list price). Solves: margin = target").font = BLACK
    style_row(pr, r, 8)
    r += 1
r += 1

section(pr, r, "Margin at candidate list prices (per paying user per month)", 8)
r += 1
pr.cell(row=r, column=1, value="List price (monthly billing)").font = BOLD
cands = [5, 6, 8, 10, 12, 15]
for j, p in enumerate(cands):
    c = pr.cell(row=r, column=2 + j, value=p)
    c.font = BLUE
    c.number_format = USD
R_CAND = r
r += 1


def prow(label, fn, fmt=USD, bold=False, note=""):
    global r
    pr.cell(row=r, column=1, value=label).font = BOLD if bold else BLACK
    for j in range(len(cands)):
        L = get_column_letter(2 + j)
        c = pr.cell(row=r, column=2 + j, value=fn(L))
        c.number_format = fmt
        if bold:
            c.font = BOLD
    if note:
        pr.cell(row=r, column=8, value=note).font = BLACK
    style_row(pr, r, 8)
    out = r
    r += 1
    return out


R_REV = prow("Revenue per payer (after annual discount mix)", lambda L: f"={L}{R_CAND}*{REF['k']}")
R_FEES = prow("Payment fees", lambda L: f"={L}{R_REV}*{REF['f']}+{REF['F0']}")
R_GM1 = prow("Gross margin, phase 1", lambda L: f"=IF({L}{R_REV}=0,0,({L}{R_REV}-{L}{R_FEES}-{REF['C_p1']})/{L}{R_REV})", PCT, True)
R_GM2 = prow("Gross margin, phase 2", lambda L: f"=IF({L}{R_REV}=0,0,({L}{R_REV}-{L}{R_FEES}-{REF['C_p2']})/{L}{R_REV})", PCT, True)
R_GMH = prow("Gross margin, heavy payer phase 2", lambda L: f"=IF({L}{R_REV}=0,0,({L}{R_REV}-{L}{R_FEES}-{REF['Ch_p2']})/{L}{R_REV})", PCT, False, "Worst case without tier caps")
R_CON2 = prow("Contribution per payer, phase 2 ($)", lambda L: f"={L}{R_REV}-{L}{R_FEES}-{REF['C_p2']}", USD)
prow("Payers needed to cover fixed costs (break-even)", lambda L: f"=IF({L}{R_CON2}<=0,\"never\",ROUNDUP({REF['fixed_total']}/{L}{R_CON2},0))", NUM, True,
     "Includes owner pay target if set on Assumptions")
pr.freeze_panes = "B2"

# ---------------------------------------------------------------- Scenarios
S = "Scenarios"
sc = wb.create_sheet(S)
header(sc, 1, ["Monthly totals", "Scenario 1", "Scenario 2", "Scenario 3", "Scenario 4", "Note"], [46, 16, 16, 16, 16, 60])
r = 2
sc.cell(row=r, column=1, value="Total users (free + paid)").font = BOLD
for j, n in enumerate([100, 1000, 10000, 100000]):
    c = sc.cell(row=r, column=2 + j, value=n)
    c.font = BLUE
    c.number_format = NUM
R_N = r
r += 1
SC = list(range(2, 6))


def srow(label, fn, fmt=USD0, bold=False, note=""):
    global r
    sc.cell(row=r, column=1, value=label).font = BOLD if bold else BLACK
    for col in SC:
        L = get_column_letter(col)
        c = sc.cell(row=r, column=col, value=fn(L))
        c.number_format = fmt
        if bold:
            c.font = BOLD
    if note:
        sc.cell(row=r, column=6, value=note).font = BLACK
    style_row(sc, r, 6)
    out = r
    r += 1
    return out


R_PAID = srow("Paying users", lambda L: f"={L}{R_N}/(1+{REF['free_ratio']})", NUM)
R_FREE = srow("Free users", lambda L: f"={L}{R_N}-{L}{R_PAID}", NUM)
R_SREV = srow("Revenue", lambda L: f"={L}{R_PAID}*{REF['price']}*{REF['k']}", USD0, True)
r += 1
R_SFEE = srow("Payment fees", lambda L: f"={L}{R_SREV}*{REF['f']}+{L}{R_PAID}*{REF['F0']}")
R_SAI = srow("Claude AI",
             lambda L: f"={L}{R_PAID}*({REF['aicore_blend']}+{REF['inapp']}*{REF['aiapp_blend']})+{L}{R_FREE}*{REF['aicore_free']}",
             note="In-app AI included when the Assumptions flag = 1")


def tot(metric):
    return lambda L: f"({L}{R_PAID}*{REF[metric + '_paid']}+{L}{R_FREE}*{REF[metric + '_free']})"


R_SCF = srow("Cloudflare (Workers + D1 + Durable Objects, after included allowances)",
             lambda L: (f"={REF['cf_base']}"
                        f"+MAX(0,{tot('u_req')(L)}-{REF['req_incl']})/1000000*{REF['req_rate']}"
                        f"+MAX(0,{tot('u_d1r')(L)}-{REF['d1r_incl']})/1000000*{REF['d1r_rate']}"
                        f"+MAX(0,{tot('u_d1w')(L)}-{REF['d1w_incl']})/1000000*{REF['d1w_rate']}"
                        f"+MAX(0,{tot('u_gb')(L)}-{REF['d1s_incl']})*{REF['d1s_rate']}"
                        f"+MAX(0,{tot('u_dor')(L)}-{REF['dor_incl']})/1000000*{REF['dor_rate']}"
                        f"+MAX(0,{tot('u_dod')(L)}-{REF['dod_incl']})/1000000*{REF['dod_rate']}"))
R_SEM = srow("Email (Resend)",
             lambda L: (f"=IF({tot('u_em')(L)}<={REF['em_free']},0,"
                        f"{REF['em_pro']}+MAX(0,{tot('u_em')(L)}-{REF['em_pro_incl']})/1000*{REF['em_over']})"),
             note="Above ~100k emails/month a higher Resend tier is cheaper; check pricing")
R_SFIX = srow("Other fixed costs", lambda L: f"={REF['fixed_total']}-{REF['cf_base']}", note="Domain, app stores, tools, legal, owner pay")
R_SCOST = srow("Total costs", lambda L: f"={L}{R_SFEE}+{L}{R_SAI}+{L}{R_SCF}+{L}{R_SEM}+{L}{R_SFIX}", USD0, True)
r += 1
R_SPROF = srow("PROFIT / (LOSS) per month", lambda L: f"={L}{R_SREV}-{L}{R_SCOST}", USD0, True)
for col in SC:
    sc.cell(row=R_SPROF, column=col).fill = KEY_FILL
srow("Profit margin", lambda L: f"=IF({L}{R_SREV}=0,0,{L}{R_SPROF}/{L}{R_SREV})", PCT)
srow("Revenue per paying user", lambda L: f"=IF({L}{R_PAID}=0,0,{L}{R_SREV}/{L}{R_PAID})", USD)
srow("Total cost per paying user", lambda L: f"=IF({L}{R_PAID}=0,0,{L}{R_SCOST}/{L}{R_PAID})", USD)
srow("Income-to-cost ratio (revenue / total cost)", lambda L: f"=IF({L}{R_SCOST}=0,0,{L}{R_SREV}/{L}{R_SCOST})", '0.00"x"', True,
     "Above 1.00x = profitable. 5.00x = $5 earned per $1 spent")
sc.freeze_panes = "B3"

# ---------------------------------------------------------------- TierCaps
T = "TierCaps"
tc = wb.create_sheet(T)
header(tc, 1, ["Paid tier AI allowance", "Value", "Note"], [52, 16, 70])
r = 2
tc.cell(row=r, column=1, value="Tier list price (monthly billing)").font = BLACK
c = tc.cell(row=r, column=2, value=f"={REF['price']}")
c.font = GREEN
c.number_format = USD
R_TP = r
r += 1
tc.cell(row=r, column=1, value="Revenue per payer").font = BLACK
c = tc.cell(row=r, column=2, value=f"=B{R_TP}*{REF['k']}")
c.number_format = USD
R_TREV = r
r += 1
tc.cell(row=r, column=1, value="AI budget per payer at target margin").font = BOLD
c = tc.cell(row=r, column=2,
            value=f"=B{R_TREV}*(1-{REF['f']}-{REF['target_gm']})-{REF['F0']}-{REF['infra_email_blend']}-{REF['sub1']}")
c.number_format = USD
c.font = BOLD
c.fill = KEY_FILL
tc.cell(row=r, column=3, value="Revenue left for AI after fees, infra, email, free users and target margin").font = BLACK
R_TB = r
r += 2
section(tc, r, "If the whole budget went to one feature, max uses per month", 3)
r += 1
for label, key in [("Quick Plan Checks", "cpc_qc"), ("Deep Plan Checks", "cpc_dc"), ("Status reports", "cpc_sr"),
                   ("In-app plan generations", "cpc_gen"), ("In-app helper calls", "cpc_hp")]:
    tc.cell(row=r, column=1, value=label).font = BLACK
    c = tc.cell(row=r, column=2, value=f"=IF({REF[key]}=0,0,MAX(0,ROUNDDOWN($B${R_TB}/{REF[key]},0)))")
    c.number_format = NUM
    style_row(tc, r, 3)
    r += 1
r += 1
section(tc, r, "Proposed monthly caps (edit blue) and worst-case check", 3)
r += 1
caps = [("Quick Plan Checks", "cpc_qc", 100), ("Deep Plan Checks", "cpc_dc", 8), ("Status reports", "cpc_sr", 30),
        ("In-app plan generations", "cpc_gen", 4), ("In-app helper calls", "cpc_hp", 50)]
first = r
for label, key, cap in caps:
    tc.cell(row=r, column=1, value=label + " cap").font = BLACK
    c = tc.cell(row=r, column=2, value=cap)
    c.font = BLUE
    c.number_format = NUM
    tc.cell(row=r, column=3, value=f"=B{r}*{REF[key]}").number_format = USD
    style_row(tc, r, 3)
    r += 1
last = r - 1
tc.cell(row=r, column=1, value="Worst-case AI cost if a payer maxes every cap (column C total)").font = BOLD
c = tc.cell(row=r, column=2, value=f"=SUM(C{first}:C{last})")
c.number_format = USD
R_WC = r
r += 1
tc.cell(row=r, column=1, value="Gross margin for that worst-case payer").font = BOLD
c = tc.cell(row=r, column=2,
            value=f"=IF(B{R_TREV}=0,0,(B{R_TREV}*(1-{REF['f']})-{REF['F0']}-{REF['infra_email_blend']}-{REF['sub1']}-B{R_WC})/B{R_TREV})")
c.number_format = PCT
c.font = BOLD
R_WCM = r
r += 1
tc.cell(row=r, column=1, value="Caps OK? (worst case at or above target margin)").font = BOLD
tc.cell(row=r, column=2, value=f"=IF(B{R_WCM}>={REF['target_gm']},\"OK\",\"Lower caps or raise price\")").font = BOLD

# ---------------------------------------------------------------- Enterprise
E = "Enterprise"
en = wb.create_sheet(E)
header(en, 1, ["Per Enterprise customer, per month", "Customer A", "Customer B", "Customer C", "Note"], [56, 16, 16, 16, 62])
r = 2
en.cell(row=r, column=1, value="Seats (employees licensed)").font = BOLD
for j, n in enumerate([25, 200, 1000]):
    c = en.cell(row=r, column=2 + j, value=n)
    c.font = BLUE
    c.number_format = NUM
R_ES = r
r += 1
EC = [2, 3, 4]


def erow(label, fn, fmt=USD0, bold=False, note=""):
    global r
    en.cell(row=r, column=1, value=label).font = BOLD if bold else BLACK
    for col in EC:
        L = get_column_letter(col)
        c = en.cell(row=r, column=col, value=fn(L))
        c.number_format = fmt
        if bold:
            c.font = BOLD
    if note:
        en.cell(row=r, column=5, value=note).font = BLACK
    style_row(en, r, 5)
    out = r
    r += 1
    return out


R_EB = erow("Billed seats (minimum applies)", lambda L: f"=MAX({L}{R_ES},{REF['ent_min']})", NUM)
R_EREV = erow("Revenue", lambda L: f"={L}{R_EB}*{REF['ent_price']}", USD0, True)
r += 1
R_EUSE = erow("Seat usage costs (AI + infra + email)",
              lambda L: f"={L}{R_ES}*({REF['p1_blend']}+{REF['inapp']}*({REF['p2_blend']}-{REF['p1_blend']}))",
              note="Blended paid-user cost; no free users carried")
erow("Sign-in track", lambda L: f"=IF({L}{R_ES}>={REF['ent_workos_min']},\"WorkOS\",\"Direct\")", "@",
     note="Direct = Sign in with Microsoft/Google + our own SCIM endpoint ($0 per company)")
R_EID = erow("Identity: SSO + directory sync", lambda L: f"=IF({L}{R_ES}>={REF['ent_workos_min']},{REF['ent_sso']}+{REF['ent_scim']},0)",
             note="WorkOS cost only for companies at or above the seat threshold")
R_ESUP = erow("Support / account management", lambda L: f"={REF['ent_support']}")
R_EPAY = erow("Invoice payment fees", lambda L: f"={L}{R_EREV}*{REF['ent_pay']}")
R_ECOST = erow("Total cost", lambda L: f"={L}{R_EUSE}+{L}{R_EID}+{L}{R_ESUP}+{L}{R_EPAY}", USD0, True)
r += 1
R_EPROF = erow("PROFIT per month", lambda L: f"={L}{R_EREV}-{L}{R_ECOST}", USD0, True)
for col in EC:
    en.cell(row=R_EPROF, column=col).fill = KEY_FILL
erow("Gross margin", lambda L: f"=IF({L}{R_EREV}=0,0,{L}{R_EPROF}/{L}{R_EREV})", PCT, True)
erow("Identity cost as % of revenue", lambda L: f"=IF({L}{R_EREV}=0,0,{L}{R_EID}/{L}{R_EREV})", PCT)
erow("Annual contract value", lambda L: f"={L}{R_EREV}*12", USD0)
erow("Income-to-cost ratio", lambda L: f"=IF({L}{R_ECOST}=0,0,{L}{R_EREV}/{L}{R_ECOST})", '0.00"x"', True)
r += 1
en.cell(row=r, column=1, value="Seats at which WorkOS costs stay under the target share").font = BOLD
c = en.cell(row=r, column=2, value=f"=ROUNDUP(({REF['ent_sso']}+{REF['ent_scim']})/({REF['ent_id_max']}*{REF['ent_price']}),0)")
c.number_format = NUM
c.font = BOLD
c.fill = KEY_FILL
en.cell(row=r, column=5, value="Compare with the WorkOS seat threshold on Assumptions").font = BLACK
en.freeze_panes = "B3"

# ---------------------------------------------------------------- Actuals
AC = "Actuals"
ac = wb.create_sheet(AC)
cols = ["Month", "Active users", "Paying users", "AI cost ($)", "AI $ per user p50", "AI $ per user p90", "AI $ per user max",
        "Worker requests", "Emails sent", "Cloudflare bill ($)", "Resend bill ($)", "Revenue ($)",
        "Actual AI $ per payer", "Model AI $ per payer", "Actual vs model"]
header(ac, 1, cols, [10] + [14] * 14)
ex = ["2027-01", 40, 12, 3.10, 0.03, 0.22, 0.95, 120000, 600, 5.00, 0.00, 96.00]
for j, v in enumerate(ex, start=1):
    c = ac.cell(row=2, column=j, value=v)
    c.font = BLUE
for row_i in range(2, 26):
    ac.cell(row=row_i, column=13, value=f"=IF(OR(C{row_i}=\"\",C{row_i}=0),\"\",D{row_i}/C{row_i})").number_format = USD
    ac.cell(row=row_i, column=14, value=f"=IF(C{row_i}=\"\",\"\",{REF['aicore_blend']}+{REF['inapp']}*{REF['aiapp_blend']})").number_format = USD
    ac.cell(row=row_i, column=15, value=f"=IF(OR(M{row_i}=\"\",N{row_i}=\"\",N{row_i}=0),\"\",M{row_i}/N{row_i})").number_format = '0.00"x"'
    for col in (4, 5, 6, 7, 10, 11, 12):
        ac.cell(row=row_i, column=col).number_format = USD
ac.cell(row=28, column=1, value="Row 2 is an EXAMPLE showing the expected format; overwrite it with real data. Paste one row per month from Admin > Economics > Export CSV.").font = BLACK
ac.cell(row=29, column=1, value="Actual vs model above 1.00x means real AI usage is heavier than assumed: update the usage rows on Assumptions.").font = BLACK
ac.freeze_panes = "B2"
ac.cell(row=2, column=1).comment = Comment("Example row. Replace with real numbers.", "EZPLAN")

OUT.parent.mkdir(parents=True, exist_ok=True)
wb.save(OUT)
print(f"saved {OUT}")
