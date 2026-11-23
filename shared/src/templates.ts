/**
 * Starter templates for any industry, written in the plan format so they go through the same
 * import checks as everything else, plus "start from a past project".
 */
import { BRAND } from "./brand";
import { exportPlan } from "./export";
import { allTasks, type Plan } from "./schema";

export interface Template {
  id: string;
  name: string;
  /** One line for the picker. */
  blurb: string;
  goal: string;
  doneWhen: string;
  /** Phases and tasks in the plan format (no header). */
  body: string;
}

export const TEMPLATES: readonly Template[] = [
  { id: "blank", name: "Blank plan", blurb: "One phase and one task to start typing.", goal: "", doneWhen: "", body: "## P1: Getting started\n- [ ] T1: First step (1d)" },
  {
    id: "event", name: "Event", blurb: "Venue, budget, guests, suppliers and the day itself.", goal: "Hold a well-run event on budget.", doneWhen: "Event held, suppliers paid, thank-yous sent.",
    body: `## P1: Basics
- [ ] T1: Set the budget (1d)
- [ ] T2: Shortlist venues (2d) depends: T1
- [ ] T3: Book the venue (1d) depends: T2
- [ ] M1: Venue booked (milestone) depends: T3
## P2: Guests and suppliers
- [ ] T4: Draft the guest list (1d) depends: T1
- [ ] T5: Send invitations (1d) depends: T4, M1
- [ ] T6: Book catering (2d) depends: M1
- [ ] T7: Wait for RSVPs (2w) #wait depends: T5
- [ ] T8: Confirm final numbers with suppliers (1d) depends: T7, T6
## P3: The day
- [ ] T9: Run-of-show and roles (1d) depends: T8
- [ ] M2: Event day (milestone) depends: T9
- [ ] T10: Pay suppliers and send thank-yous (1d) depends: M2` },
  {
    id: "renovation", name: "Home renovation", blurb: "Quotes, permits, ordering, building and inspection.", goal: "Finish the renovation on time and on budget.", doneWhen: "Work finished, inspection passed, final invoice paid.",
    body: `## P1: Plan
- [ ] T1: Measure and list what you want (1d)
- [ ] T2: Get three contractor quotes (1w) depends: T1
- [ ] T3: Choose the contractor (1d) depends: T2
- [ ] T4: Apply for the permit (1d) depends: T3
- [ ] T5: Wait for the permit (3w) #wait depends: T4
## P2: Order
- [ ] T6: Choose materials and fittings (2d) depends: T3
- [ ] T7: Order materials (1d) depends: T6
- [ ] T8: Delivery lead time (2w) #wait depends: T7
- [ ] M1: Ready to start (milestone) depends: T5, T8
## P3: Build
- [ ] T9: Demolition (2d) depends: M1
- [ ] T10: Rough-in work (wiring, plumbing) (1w) depends: T9
- [ ] T11: Install and finish (2w) depends: T10
- [ ] T12: Final inspection (1d) depends: T11
- [ ] M2: Renovation complete (milestone) depends: T12` },
  {
    id: "launch", name: "Product launch", blurb: "Positioning, build, launch content and the launch day.", goal: "Launch the product to the people who need it.", doneWhen: "Product live, launch announced, first feedback collected.",
    body: `## P1: Shape it
- [ ] T1: Write who it's for and why (1d)
- [ ] T2: Decide the launch date and scope (1d) depends: T1
## P2: Build and test
- [ ] T3: Finish the must-have features (3w) depends: T2
- [ ] T4: Test with five real users (1w) depends: T3
- [ ] T5: Fix what testing found (1w) depends: T4
- [ ] M1: Ready to launch (milestone) depends: T5
## P3: Launch
- [ ] T6: Launch page and announcement (1w) depends: T2
- [ ] T7: Prepare support answers (2d) depends: T4
- [ ] M2: Launch day (milestone) depends: M1, T6, T7
- [ ] T8: Collect and sort first feedback (1w) depends: M2` },
  {
    id: "hiring", name: "Hiring", blurb: "Role description, sourcing, interviews and the offer.", goal: "Hire the right person for the role.", doneWhen: "Offer accepted and start date agreed.",
    body: `## P1: Prepare
- [ ] T1: Write the role description (1d)
- [ ] T2: Agree the interview steps and panel (1d) depends: T1
## P2: Find people
- [ ] T3: Post the job and ask for referrals (1d) depends: T1
- [ ] T4: Applications open (2w) #wait depends: T3
- [ ] T5: Shortlist candidates (2d) depends: T4
## P3: Interview and decide
- [ ] T6: First interviews (1w) depends: T5, T2
- [ ] T7: Final interviews (1w) depends: T6
- [ ] T8: References and decision (2d) depends: T7
- [ ] T9: Make the offer (1d) depends: T8
- [ ] M1: Offer accepted (milestone) depends: T9` },
  {
    id: "research", name: "Research study", blurb: "Question, method, approval, data and write-up.", goal: "Answer the research question with sound evidence.", doneWhen: "Report written, reviewed and shared.",
    body: `## P1: Design
- [ ] T1: Write the research question (1d)
- [ ] T2: Review what's already known (1w) depends: T1
- [ ] T3: Choose the method and sample (2d) depends: T2
- [ ] T4: Ethics or approval request (1d) depends: T3
- [ ] T5: Wait for approval (3w) #wait depends: T4
## P2: Collect
- [ ] T6: Recruit participants (2w) depends: T5
- [ ] T7: Collect the data (3w) depends: T6
## P3: Analyse and share
- [ ] T8: Analyse the results (2w) depends: T7
- [ ] T9: Write the report (2w) depends: T8
- [ ] T10: Review and revise (1w) depends: T9
- [ ] M1: Report shared (milestone) depends: T10` },
  {
    id: "move", name: "Office move", blurb: "New space, suppliers, packing, move day and settling in.", goal: "Move the office with as little disruption as possible.", doneWhen: "Everyone working at the new address, old space handed back.",
    body: `## P1: Prepare
- [ ] T1: Agree the move date (1d)
- [ ] T2: Book the movers (1d) depends: T1
- [ ] T3: Order internet for the new space (1d) depends: T1
- [ ] T4: Internet installation lead time (3w) #wait depends: T3
- [ ] T5: Plan who sits where (2d) depends: T1
## P2: Move
- [ ] T6: Pack (3d) depends: T5, T2
- [ ] M1: Move day (milestone) depends: T6, T4
- [ ] T7: Set up desks and equipment (2d) depends: M1
## P3: Settle in
- [ ] T8: Update the address everywhere (1d) depends: M1
- [ ] T9: Hand back the old space (1d) depends: T7
- [ ] M2: Move complete (milestone) depends: T8, T9` },
  {
    id: "wedding", name: "Wedding", blurb: "Budget, venue, suppliers, guests and the day.", goal: "A happy day that stays within budget.", doneWhen: "Married, suppliers paid, thank-you cards sent.",
    body: `## P1: Big decisions
- [ ] T1: Set the budget and guest count (1d)
- [ ] T2: Book the venue (1w) depends: T1
- [ ] T3: Book photographer and music (1w) depends: T2
## P2: Guests
- [ ] T4: Send save-the-dates (1d) depends: T2
- [ ] T5: Send invitations (1d) depends: T4
- [ ] T6: Wait for RSVPs (4w) #wait depends: T5
- [ ] T7: Seating plan (2d) depends: T6
## P3: Details and the day
- [ ] T8: Outfits and fittings (4w) depends: T1
- [ ] T9: Final numbers to suppliers (1d) depends: T7, T3
- [ ] M1: Wedding day (milestone) depends: T9, T8
- [ ] T10: Thank-you cards (1w) depends: M1` },
  {
    id: "construction", name: "Construction job", blurb: "Site, permits, foundations, structure, finishing and handover.", goal: "Deliver the building safely, on time and on budget.", doneWhen: "Final inspection passed and handed over to the client.",
    body: `## P1: Pre-construction
- [ ] T1: Site survey (2d)
- [ ] T2: Final drawings and quantities (2w) depends: T1
- [ ] T3: Building permit application (1d) depends: T2
- [ ] T4: Wait for the permit (4w) #wait depends: T3
- [ ] T5: Award subcontracts (1w) depends: T2
- [ ] M1: Mobilised on site (milestone) depends: T4, T5
## P2: Structure
- [ ] T6: Excavation and foundations (2w) depends: M1
- [ ] T7: Foundation inspection (1d) depends: T6
- [ ] T8: Frame and roof (4w) depends: T7
- [ ] M2: Weathertight (milestone) depends: T8
## P3: Finishing and handover
- [ ] T9: Services (electrical, plumbing, HVAC) (3w) depends: M2
- [ ] T10: Interior finishes (4w) depends: T9
- [ ] T11: Snag list and fixes (1w) depends: T10
- [ ] T12: Final inspection (1d) depends: T11
- [ ] M3: Handover (milestone) depends: T12` },
  {
    id: "marketing", name: "Marketing campaign", blurb: "Goal, audience, content, launch and results.", goal: "Reach the right people and hit the campaign target.", doneWhen: "Campaign run, results reported, lessons written down.",
    body: `## P1: Plan
- [ ] T1: Set the goal and how to measure it (1d)
- [ ] T2: Define the audience and message (2d) depends: T1
- [ ] T3: Choose channels and budget (1d) depends: T2
## P2: Create
- [ ] T4: Write and design the content (2w) depends: T3
- [ ] T5: Review and approvals (3d) depends: T4
- [ ] T6: Set up tracking (1d) depends: T3
- [ ] M1: Ready to launch (milestone) depends: T5, T6
## P3: Run and learn
- [ ] T7: Run the campaign (3w) depends: M1
- [ ] T8: Report the results (2d) depends: T7
- [ ] M2: Campaign done (milestone) depends: T8` },
];

/** The template as a plan file, starting on `start` (YYYY-MM-DD). */
export function templateText(id: string, start: string, title?: string): string {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template: ${id}`);
  const header = [`${BRAND.formatKey}: 1`, `title: ${title?.trim() || t.name}`, ...(t.goal ? [`goal: ${t.goal}`] : []), ...(t.doneWhen ? [`done_when: ${t.doneWhen}`] : []), `start: ${start}`];
  return `---\n${header.join("\n")}\n---\n${t.body}\n`;
}

/** A finished or old plan reused as a starting point: same structure, no progress, no dates. */
export function planFromPast(plan: Plan, opts: { title?: string; start?: string } = {}): Plan {
  const p = structuredClone(plan);
  delete p.id;
  delete p.baselineSet;
  delete p.basedOn;
  p.title = opts.title?.trim() || `${plan.title} (copy)`;
  if (opts.start) p.start = opts.start;
  else delete p.start;
  for (const t of allTasks(p)) {
    t.status = "todo";
    delete t.done;
    delete t.skipped;
    delete t.planned;
    delete t.due;
    t.subtasks = t.subtasks.map((s) => ({ ...s, status: "todo" }));
  }
  return p;
}

/** planFromPast as a plan file, ready for the same import checks as a pasted plan. */
export function pastPlanText(plan: Plan, opts: { title?: string; start?: string } = {}): string {
  return exportPlan(planFromPast(plan, opts));
}
