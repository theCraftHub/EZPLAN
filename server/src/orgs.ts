/**
 * Organizations (step L1, plan sections 5b and 5c): a company account above workspaces. People
 * join by email-bound invite links; org roles decide what they can do in the admin console, and
 * plan access keeps flowing through ordinary workspace membership (kept in sync here). Every admin
 * action is written to an append-only, hash-chained audit log.
 */
import type { Hono } from "hono";
import { BRAND } from "@rakuplan/shared";
import type { Clock, Db, HttpFetch, User } from "./ports";
import { EMAIL_RE, INVITE_DAYS, maskEmail } from "./invites";
import { randomToken, sha256 } from "./sessions";
import { notify } from "./notify";
import { hmacHex, serverKey } from "./security";
import { peopleOf, reclaimable } from "./orgPeople";

export const ORG_ROLES = ["owner", "admin", "dept_admin", "helpdesk", "auditor", "member", "guest"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const ORG_ROLE_WORD: Record<OrgRole, string> = { owner: "Owner", admin: "Admin", dept_admin: "Department admin", helpdesk: "Helpdesk", auditor: "Auditor", member: "Member", guest: "Guest" };

/** What each role may do in the console. */
export const can = {
  manageSettings: (r: OrgRole | null) => r === "owner" || r === "admin",
  manageSeats: (r: OrgRole | null) => r === "owner",
  managePeople: (r: OrgRole | null) => r === "owner" || r === "admin" || r === "dept_admin",
  /** Helpdesk: see people, resend invites, sign people out. */
  supportPeople: (r: OrgRole | null) => r === "owner" || r === "admin" || r === "dept_admin" || r === "helpdesk",
  readAudit: (r: OrgRole | null) => r === "owner" || r === "admin" || r === "auditor",
  /** Anyone who may open the console at all. */
  console: (r: OrgRole | null) => !!r && r !== "member" && r !== "guest",
};
/** Roles a person may give: never above their own; only Owners make Owners. */
export const mayGrant = (mine: OrgRole, target: OrgRole) => (mine === "owner" ? true : mine === "admin" ? target !== "owner" : mine === "dept_admin" ? target === "member" || target === "guest" : false);
/** Guests don't take a seat. */
export const usesSeat = (r: OrgRole) => r !== "guest";

// ---------------------------------------------------------------- company rules (step L2)

/**
 * The rule presets picked in onboarding (changeable later in the console). Each is enforced where
 * the feature exists: inviting people from outside the company to a company plan, how long such
 * guests keep access, and who may download plan files.
 */
export const RULE_PRESETS = {
  standard: { outsideInvites: "managers", exports: "everyone", guestDays: 90 },
  strict: { outsideInvites: "admins", exports: "admins", guestDays: 30 },
  open: { outsideInvites: "anyone", exports: "everyone", guestDays: null },
} as const satisfies Record<string, { outsideInvites: "anyone" | "managers" | "admins"; exports: "everyone" | "admins"; guestDays: number | null }>;
export type RulePreset = keyof typeof RULE_PRESETS;
export type OrgRules = { preset: RulePreset } & (typeof RULE_PRESETS)[RulePreset];

/** A company's rules from its settings; Standard until one is picked. */
export function rulesOf(settings: string | null | undefined): OrgRules {
  let preset: RulePreset = "standard";
  try {
    const p = (JSON.parse(settings || "{}") as { preset?: string }).preset;
    if (p && p in RULE_PRESETS) preset = p as RulePreset;
  } catch { /* keep Standard */ }
  return { preset, ...RULE_PRESETS[preset] };
}

/** The company a workspace belongs to, with its rules; null for a personal workspace. */
export async function companyOf(db: Db, workspaceId: string): Promise<{ orgId: string; name: string; rules: OrgRules } | null> {
  const r = await db.first<{ id: string; name: string; settings: string }>(`SELECT o.id, o.name, o.settings FROM workspaces w JOIN organizations o ON o.id = w.org_id WHERE w.id = ?`, [workspaceId]);
  return r ? { orgId: r.id, name: r.name, rules: rulesOf(r.settings) } : null;
}

/** Whether an address belongs inside the company: an active member, or on a verified domain. */
export async function isInsider(db: Db, orgId: string, email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (await db.first(`SELECT 1 AS x FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = ? AND om.status = 'active' AND om.role != 'guest' AND lower(u.email) = ?`, [orgId, e])) return true;
  return !!(await db.first(`SELECT 1 AS x FROM org_domains WHERE org_id = ? AND domain = ? AND verified_at IS NOT NULL`, [orgId, e.split("@")[1] ?? ""]));
}

export interface OrgDeps { db: Db; clock: Clock; http: HttpFetch; siteOrigin: string; notFound: { error: string } }

type OrgRow = { id: string; name: string; industry: string | null; seats: number; settings: string; onboarding: string; created_at: number };
export const orgOf = (db: Db, id: string) => db.first<OrgRow>(`SELECT * FROM organizations WHERE id = ?`, [id]);
export async function orgRole(db: Db, orgId: string, userId: string): Promise<OrgRole | null> {
  const r = await db.first<{ role: OrgRole; status: string }>(`SELECT role, status FROM org_members WHERE org_id = ? AND user_id = ?`, [orgId, userId]);
  return r && r.status === "active" ? r.role : null;
}

/** Seats taken: active people who use one, plus open invites that would. */
export async function seatsTaken(db: Db, orgId: string, now: number): Promise<number> {
  const people = Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND status = 'active' AND role != 'guest'`, [orgId]))?.n ?? 0);
  const pending = Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM org_invites WHERE org_id = ? AND accepted_by IS NULL AND revoked_at IS NULL AND expires_at > ? AND role != 'guest'`, [orgId, now]))?.n ?? 0);
  return people + pending;
}

// ---------------------------------------------------------------- audit log

const ZERO = "0".repeat(64);
type AuditRow = { org_id: string; seq: number; at: number; actor_id: string | null; actor_name: string; action: string; target: string; detail: string; prev_hash: string; hash: string };
// Keyed with a per-install secret, so someone who can edit the database can't quietly rebuild the chain.
const auditHash = async (db: Db, r: Omit<AuditRow, "hash">) => hmacHex(await serverKey(db, "audit"), JSON.stringify([r.org_id, Number(r.seq), Number(r.at), r.actor_id, r.actor_name, r.action, r.target, r.detail, r.prev_hash]));

/** Appends one event; each row's hash covers the previous row's, so an edited or removed row shows. */
export async function audit(db: Db, now: number, orgId: string, actor: { id: string | null; name: string }, action: string, target: string, detail: Record<string, unknown> = {}): Promise<void> {
  const last = await db.first<{ seq: number; hash: string }>(`SELECT seq, hash FROM audit_log WHERE org_id = ? ORDER BY seq DESC LIMIT 1`, [orgId]);
  const row = { org_id: orgId, seq: Number(last?.seq ?? 0) + 1, at: now, actor_id: actor.id, actor_name: actor.name, action, target, detail: JSON.stringify(detail), prev_hash: last?.hash ?? ZERO };
  await db.run(`INSERT INTO audit_log (org_id, seq, at, actor_id, actor_name, action, target, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [row.org_id, row.seq, row.at, row.actor_id, row.actor_name, row.action, row.target, row.detail, row.prev_hash, await auditHash(db, row)]);
}

/** Checks the whole chain: null when intact, else the first sequence number that doesn't match. */
export async function auditBreak(db: Db, orgId: string): Promise<number | null> {
  const rows = await db.all<AuditRow>(`SELECT * FROM audit_log WHERE org_id = ? ORDER BY seq`, [orgId]);
  let prev = ZERO;
  for (const [i, r] of rows.entries()) {
    if (Number(r.seq) !== i + 1 || r.prev_hash !== prev || (await auditHash(db, r)) !== r.hash) return Number(r.seq);
    prev = r.hash;
  }
  return null;
}

// ---------------------------------------------------------------- workspace access follows the org role

/**
 * Keeps someone's workspace membership in line with their org role: Owners and Admins manage every
 * workspace of the org; Department admins manage theirs; Members edit theirs; Helpdesk, Auditors
 * and Guests get no workspace (Guests only reach the plans they're invited to). Deactivated people
 * lose all of it, and any plan-only access inside the org.
 */
export async function syncAccess(db: Db, orgId: string, userId: string): Promise<void> {
  const m = await db.first<{ role: OrgRole; status: string; workspaces: string }>(`SELECT role, status, workspaces FROM org_members WHERE org_id = ? AND user_id = ?`, [orgId, userId]);
  const all = (await db.all<{ id: string }>(`SELECT id FROM workspaces WHERE org_id = ?`, [orgId])).map((r) => r.id);
  const mine = m ? (JSON.parse(m.workspaces) as string[]).filter((w) => all.includes(w)) : [];
  const want = new Map<string, "manager" | "editor">();
  if (m && m.status === "active") {
    if (m.role === "owner" || m.role === "admin") for (const w of all) want.set(w, "manager");
    else if (m.role === "dept_admin") for (const w of mine) want.set(w, "manager");
    else if (m.role === "member") for (const w of mine) want.set(w, "editor");
  }
  for (const w of all) {
    const role = want.get(w);
    if (role) await db.run(`INSERT INTO members (workspace_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`, [w, userId, role]);
    else await db.run(`DELETE FROM members WHERE workspace_id = ? AND user_id = ?`, [w, userId]);
  }
  if (!m || m.status !== "active") {
    if (all.length) await db.run(`DELETE FROM plan_members WHERE user_id = ? AND plan_id IN (SELECT id FROM plans WHERE workspace_id IN (${all.map(() => "?").join(",")}))`, [userId, ...all]);
  }
}

// ---------------------------------------------------------------- invites

export interface InviteRequest { email: string; name?: string; role?: OrgRole; department?: string; workspaceId?: string }
export interface InviteCheck { email: string; name: string | null; role: OrgRole; department: string | null; workspaceId: string | null; ok: boolean; problem?: string }

/** Checks a batch of invites without changing anything (the dry run), row by row. */
export async function checkInvites(db: Db, now: number, orgId: string, byRole: OrgRole, rows: InviteRequest[]): Promise<{ rows: InviteCheck[]; seatsLeft: number }> {
  const org = (await orgOf(db, orgId))!;
  const workspaces = new Set((await db.all<{ id: string }>(`SELECT id FROM workspaces WHERE org_id = ?`, [orgId])).map((r) => r.id));
  const verified = (await db.all<{ domain: string }>(`SELECT domain FROM org_domains WHERE org_id = ? AND verified_at IS NOT NULL`, [orgId])).map((r) => r.domain);
  let seatsLeft = Number(org.seats) - (await seatsTaken(db, orgId, now));
  const seen = new Set<string>();
  const out: InviteCheck[] = [];
  for (const r of rows.slice(0, 1000)) {
    const email = String(r.email ?? "").trim().toLowerCase();
    const role = (ORG_ROLES as readonly string[]).includes(r.role ?? "") ? (r.role as OrgRole) : "member";
    const row: InviteCheck = { email, name: (r.name ?? "").trim().slice(0, 80) || null, role, department: (r.department ?? "").trim().slice(0, 60) || null, workspaceId: r.workspaceId && workspaces.has(r.workspaceId) ? r.workspaceId : ([...workspaces][0] ?? null), ok: false };
    const fail = (problem: string) => out.push({ ...row, problem });
    if (!EMAIL_RE.test(email) || email.length > 254) { fail("Not an email address."); continue; }
    if (seen.has(email)) { fail("Listed twice; kept the first."); continue; }
    seen.add(email);
    if (!mayGrant(byRole, role)) { fail(`You can't make someone ${ORG_ROLE_WORD[role]}.`); continue; }
    if (role === "guest" && verified.includes(email.split("@")[1]!)) { fail(`People on ${email.split("@")[1]} work here: add them as members, not guests.`); continue; }
    const user = await db.first<{ id: string }>(`SELECT id FROM users WHERE lower(email) = ?`, [email]);
    if (user && (await db.first(`SELECT 1 AS x FROM org_members WHERE org_id = ? AND user_id = ? AND status = 'active'`, [orgId, user.id]))) { fail("Already in the company."); continue; }
    if (await db.first(`SELECT 1 AS x FROM org_invites WHERE org_id = ? AND lower(email) = ? AND accepted_by IS NULL AND revoked_at IS NULL AND expires_at > ?`, [orgId, email, now])) { fail("Already invited; resend from People if needed."); continue; }
    if (usesSeat(role)) {
      if (seatsLeft <= 0) { fail("No seats left. Add seats in Licenses, or free one."); continue; }
      seatsLeft--;
    }
    out.push({ ...row, ok: true });
  }
  return { rows: out, seatsLeft };
}

async function createInvite(db: Db, d: OrgDeps, org: OrgRow, by: User, r: InviteCheck, sendEmail: (to: string, subject: string, text: string) => Promise<void>): Promise<{ email: string; link: string }> {
  const token = randomToken();
  const now = d.clock.now();
  await db.run(
    `INSERT INTO org_invites (id, org_id, token_hash, email, name, role, department, workspace_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), org.id, await sha256(token), r.email, r.name, r.role, r.department, r.workspaceId, by.id, now, now + INVITE_DAYS * 86_400_000],
  );
  const link = `${d.siteOrigin}/join/${token}`;
  await sendEmail(r.email, `${by.name} invited you to ${org.name} on ${BRAND.name}`, `${by.name} invited you to join ${org.name} on ${BRAND.name} as ${ORG_ROLE_WORD[r.role]}.\n\nJoin: ${link}\n\nThe link works once, for ${r.email}, for ${INVITE_DAYS} days.`);
  return { email: r.email, link };
}

/** DNS-over-HTTPS lookup of a domain's TXT records (Cloudflare's JSON API). */
async function txtRecords(http: HttpFetch, domain: string): Promise<string[] | null> {
  try {
    const res = await http(new Request(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=TXT`, { headers: { accept: "application/dns-json" } }));
    if (!res.ok) return null;
    const body = (await res.json()) as { Answer?: { type: number; data: string }[] };
    return (body.Answer ?? []).filter((a) => a.type === 16).map((a) => a.data.replace(/^"|"$/g, "").replace(/" "/g, ""));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- onboarding progress (step L2)

export const ONBOARDING_STEPS = ["company", "domain", "people", "rules", "first", "live"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export interface Onboarding { step?: OnboardingStep; email?: string; people?: InviteRequest[]; firstPlanId?: string | null; done?: boolean; liveAt?: number }

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
/** The people list as saved between steps: only known fields, trimmed, at most 1,000 rows. */
function cleanPeople(v: unknown): InviteRequest[] | null {
  if (!Array.isArray(v) || v.length > 1000) return null;
  const out: InviteRequest[] = [];
  for (const r of v as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") return null;
    const row: InviteRequest = { email: str(r.email, 254) ?? "" };
    const name = str(r.name, 80), department = str(r.department, 60), workspaceId = str(r.workspaceId, 64);
    if (name) row.name = name;
    if (department) row.department = department;
    if (workspaceId) row.workspaceId = workspaceId;
    if (typeof r.role === "string" && (ORG_ROLES as readonly string[]).includes(r.role)) row.role = r.role as OrgRole;
    out.push(row);
  }
  return out;
}
export const onboardingOf = (org: OrgRow): Onboarding => { try { return JSON.parse(org.onboarding || "{}") as Onboarding; } catch { return {}; } };

/** Numbers for the console's Overview. */
async function orgStats(db: Db, orgId: string, now: number) {
  const people = await peopleOf(db, orgId, now);
  const active = people.filter((p) => p.kind === "person" && p.status === "active");
  const departments = new Map<string, number>();
  for (const p of active) departments.set(p.department ?? "", (departments.get(p.department ?? "") ?? 0) + 1);
  return {
    active: active.length,
    invited: people.filter((p) => p.status === "invited").length,
    expired: people.filter((p) => p.status === "expired").length,
    deactivated: people.filter((p) => p.status === "deactivated").length,
    activeThisWeek: active.filter((p) => (p.lastActiveAt ?? 0) >= now - 7 * 86_400_000).length,
    admins: active.filter((p) => p.role === "owner" || p.role === "admin").length,
    reclaimable: reclaimable(people, now).length,
    departments: [...departments].map(([name, people]) => ({ name: name || null, people })).sort((a, b) => b.people - a.people),
  };
}

// ---------------------------------------------------------------- routes

export function registerOrgRoutes(app: Hono<{ Variables: { user: User } }>, d: OrgDeps & { email: (to: string, subject: string, text: string) => Promise<void> }) {
  const { db, clock } = d;
  const actor = (u: User) => ({ id: u.id, name: u.name });
  const consoleFor = async (orgId: string, user: User) => {
    const org = await orgOf(db, orgId);
    const role = org ? await orgRole(db, orgId, user.id) : null;
    return org && role && can.console(role) ? { org, role } : null;
  };

  // A company: its first workspace, the person creating it as Owner, seats from the people count.
  app.post("/api/orgs", async (c) => {
    const user = c.get("user");
    const b = await c.req.json<{ name?: unknown; industry?: unknown; people?: unknown }>().catch(() => null);
    const name = typeof b?.name === "string" ? b.name.trim().slice(0, 120) : "";
    const people = Number(b?.people);
    if (!name) return c.json({ error: "Enter your company's name." }, 400);
    if (!Number.isInteger(people) || people < 1 || people > 100_000) return c.json({ error: "Enter how many people will use it (1 or more)." }, 400);
    const now = clock.now();
    const orgId = crypto.randomUUID();
    const wsId = crypto.randomUUID();
    const work = (await db.first<{ work_week: string }>(`SELECT w.work_week FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? LIMIT 1`, [user.id]))?.work_week ?? "{}";
    await db.batch([
      { sql: `INSERT INTO organizations (id, name, industry, seats, settings, onboarding, created_by, created_at) VALUES (?, ?, ?, ?, '{}', '{}', ?, ?)`, params: [orgId, name, typeof b?.industry === "string" ? b.industry.trim().slice(0, 60) || null : null, people, user.id, now] },
      { sql: `INSERT INTO workspaces (id, name, work_week, created_at, org_id) VALUES (?, ?, ?, ?, ?)`, params: [wsId, name, work, now, orgId] },
      { sql: `INSERT INTO org_members (org_id, user_id, role, status, department, workspaces, source, joined_at, last_active_at) VALUES (?, ?, 'owner', 'active', NULL, ?, 'creator', ?, ?)`, params: [orgId, user.id, JSON.stringify([wsId]), now, now] },
    ]);
    await syncAccess(db, orgId, user.id);
    await audit(db, now, orgId, actor(user), "org.created", name, { seats: people });
    return c.json({ id: orgId, workspaceId: wsId }, 201);
  });

  /** The companies I belong to, with my role. */
  app.get("/api/orgs", async (c) => {
    const rows = await db.all<{ id: string; name: string; role: OrgRole; onboarding: string }>(`SELECT o.id, o.name, m.role, o.onboarding FROM organizations o JOIN org_members m ON m.org_id = o.id WHERE m.user_id = ? AND m.status = 'active' ORDER BY o.name`, [c.get("user").id]);
    return c.json({
      orgs: rows.map((r) => {
        const ob = onboardingOf(r as unknown as OrgRow);
        // Owners and Admins are shown "finish setting up" until Go live.
        return { id: r.id, name: r.name, role: r.role, console: can.console(r.role), setup: can.manageSettings(r.role) && !ob.done ? { step: ob.step ?? "domain" } : null };
      }),
    });
  });

  app.get("/api/orgs/:id", async (c) => {
    const x = await consoleFor(c.req.param("id"), c.get("user"));
    if (!x) return c.json(d.notFound, 404);
    const now = clock.now();
    const workspaces = await db.all<{ id: string; name: string }>(`SELECT id, name FROM workspaces WHERE org_id = ? ORDER BY created_at`, [x.org.id]);
    const domains = await db.all<{ domain: string; token: string; verified_at: number | null }>(`SELECT domain, token, verified_at FROM org_domains WHERE org_id = ? ORDER BY domain`, [x.org.id]);
    return c.json({
      id: x.org.id, name: x.org.name, industry: x.org.industry, role: x.role,
      seats: { total: Number(x.org.seats), taken: await seatsTaken(db, x.org.id, now) },
      workspaces, rules: rulesOf(x.org.settings), onboarding: onboardingOf(x.org), stats: await orgStats(db, x.org.id, now),
      domains: domains.map((r) => ({ domain: r.domain, record: `${BRAND.name.toLowerCase()}-verify=${r.token}`, verified: !!r.verified_at, verifiedAt: r.verified_at === null ? null : Number(r.verified_at) })),
      can: { settings: can.manageSettings(x.role), seats: can.manageSeats(x.role), people: can.managePeople(x.role), support: can.supportPeople(x.role), audit: can.readAudit(x.role) },
    });
  });

  // Seats: the Owner sets them (no billing until launch); never below what's in use.
  app.put("/api/orgs/:id/seats", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.manageSeats(x.role)) return c.json({ error: "Only the Owner can change seats." }, 403);
    const b = await c.req.json<{ seats?: unknown }>().catch(() => null);
    const seats = Number(b?.seats);
    const taken = await seatsTaken(db, x.org.id, clock.now());
    if (!Number.isInteger(seats) || seats < 1 || seats > 100_000) return c.json({ error: "Enter a number of seats." }, 400);
    if (seats < taken) return c.json({ error: `${taken} seats are in use (people and open invites). Free some first.` }, 400);
    await db.run(`UPDATE organizations SET seats = ? WHERE id = ?`, [seats, x.org.id]);
    await audit(db, clock.now(), x.org.id, actor(user), "seats.changed", x.org.name, { from: Number(x.org.seats), to: seats });
    return c.json({ ok: true });
  });

  // Invites: `dryRun` checks every row and changes nothing; otherwise the good rows become links.
  app.post("/api/orgs/:id/invites", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.managePeople(x.role)) return c.json({ error: "You can't invite people to this company." }, 403);
    const b = await c.req.json<{ people?: unknown; dryRun?: unknown }>().catch(() => null);
    const people = Array.isArray(b?.people) ? (b!.people as InviteRequest[]) : [];
    if (!people.length) return c.json({ error: "Add at least one person." }, 400);
    const check = await checkInvites(db, clock.now(), x.org.id, x.role, people);
    if (b?.dryRun === true) return c.json({ dryRun: true, ...check, willInvite: check.rows.filter((r) => r.ok).length, skipped: check.rows.filter((r) => !r.ok).length });
    const links = [];
    for (const r of check.rows.filter((r) => r.ok)) links.push({ ...(await createInvite(db, d, x.org, user, r, d.email)), role: r.role });
    if (links.length) await audit(db, clock.now(), x.org.id, actor(user), "people.invited", `${links.length} ${links.length === 1 ? "person" : "people"}`, { emails: links.map((l) => l.email) });
    return c.json({ invited: links, skipped: check.rows.filter((r) => !r.ok) }, 201);
  });

  const inviteFor = async (token: string) =>
    token && token.length <= 100 ? db.first<{ id: string; org_id: string; email: string; name: string | null; role: OrgRole; department: string | null; workspace_id: string | null; expires_at: number; accepted_by: string | null; revoked_at: number | null; org_name: string; inviter: string | null }>(
      `SELECT i.*, o.name AS org_name, u.name AS inviter FROM org_invites i JOIN organizations o ON o.id = i.org_id LEFT JOIN users u ON u.id = i.created_by WHERE i.token_hash = ?`, [await sha256(token)]) : null;
  const problem = (i: NonNullable<Awaited<ReturnType<typeof inviteFor>>>, user: User) =>
    i.revoked_at ? "This invite was cancelled. Ask for a new one." : i.accepted_by && i.accepted_by !== user.id ? "This invite has already been used. Ask for a new one." : !i.accepted_by && Number(i.expires_at) <= clock.now() ? "This invite has expired. Ask for a new one." : i.email.toLowerCase() !== user.email.toLowerCase() ? `This invite is for ${maskEmail(i.email)}. Sign in with that address to accept it.` : null;

  app.get("/api/join/:token", async (c) => {
    const user = c.get("user");
    const i = await inviteFor(c.req.param("token"));
    if (!i) return c.json({ error: "This invite link isn't valid. Ask for a new one." }, 404);
    const p = problem(i, user);
    return c.json({ org: p ? null : i.org_name, inviter: i.inviter ?? "Someone", role: ORG_ROLE_WORD[i.role], email: maskEmail(i.email), problem: p, accepted: i.accepted_by === user.id });
  });

  app.post("/api/join/:token/accept", async (c) => {
    const user = c.get("user");
    const i = await inviteFor(c.req.param("token"));
    if (!i) return c.json({ error: "This invite link isn't valid. Ask for a new one." }, 404);
    const p = problem(i, user);
    if (p) return c.json({ error: p }, 403);
    if (!i.accepted_by) {
      const now = clock.now();
      await db.batch([
        { sql: `INSERT INTO org_members (org_id, user_id, role, status, department, workspaces, source, joined_at, last_active_at) VALUES (?, ?, ?, 'active', ?, ?, 'invite', ?, ?) ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', department = excluded.department, workspaces = excluded.workspaces, deactivated_at = NULL`, params: [i.org_id, user.id, i.role, i.department, JSON.stringify(i.workspace_id ? [i.workspace_id] : []), now, now] },
        { sql: `UPDATE org_invites SET accepted_by = ?, accepted_at = ? WHERE id = ?`, params: [user.id, now, i.id] },
      ]);
      await syncAccess(db, i.org_id, user.id);
      await audit(db, now, i.org_id, actor(user), "person.joined", user.email, { role: i.role });
      const owners = await db.all<{ user_id: string }>(`SELECT user_id FROM org_members WHERE org_id = ? AND role IN ('owner', 'admin') AND status = 'active'`, [i.org_id]);
      for (const o of owners) await notify(db, now, { userId: o.user_id, kind: "invited", text: `${user.name} joined ${i.org_name}`, link: `/admin/org/${i.org_id}/people` }, user.id);
    }
    return c.json({ orgId: i.org_id });
  });

  // Domains: add one to get its TXT record; "check now" looks it up over DNS-over-HTTPS.
  app.post("/api/orgs/:id/domains", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.manageSettings(x.role)) return c.json({ error: "Only Owners and Admins can add domains." }, 403);
    const b = await c.req.json<{ domain?: unknown }>().catch(() => null);
    const domain = typeof b?.domain === "string" ? b.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "") : "";
    if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return c.json({ error: "Enter a domain like northfield.com." }, 400);
    if (await db.first(`SELECT 1 AS x FROM org_domains WHERE domain = ? AND verified_at IS NOT NULL AND org_id != ?`, [domain, x.org.id])) return c.json({ error: "Another company has already verified that domain. Contact support if it's yours." }, 409);
    const token = randomToken().slice(0, 32);
    await db.run(`INSERT INTO org_domains (org_id, domain, token, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (org_id, domain) DO NOTHING`, [x.org.id, domain, token, clock.now()]);
    const row = await db.first<{ token: string }>(`SELECT token FROM org_domains WHERE org_id = ? AND domain = ?`, [x.org.id, domain]);
    await audit(db, clock.now(), x.org.id, actor(user), "domain.added", domain);
    return c.json({ domain, record: `${BRAND.name.toLowerCase()}-verify=${row!.token}` }, 201);
  });

  app.post("/api/orgs/:id/domains/:domain/check", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.manageSettings(x.role)) return c.json({ error: "Only Owners and Admins can verify domains." }, 403);
    const domain = c.req.param("domain").toLowerCase();
    const row = await db.first<{ token: string; verified_at: number | null }>(`SELECT token, verified_at FROM org_domains WHERE org_id = ? AND domain = ?`, [x.org.id, domain]);
    if (!row) return c.json({ error: "Add the domain first." }, 404);
    if (row.verified_at) return c.json({ verified: true });
    const records = await txtRecords(d.http, domain);
    if (records === null) return c.json({ verified: false, reason: "We couldn't look up the domain just now. Try again in a minute." });
    const want = `${BRAND.name.toLowerCase()}-verify=${row.token}`;
    if (!records.includes(want)) return c.json({ verified: false, reason: records.some((r) => r.startsWith(`${BRAND.name.toLowerCase()}-verify=`)) ? "We found a verification record, but not the one for your company. Check you copied it exactly." : "We couldn't find the record yet. DNS changes can take up to an hour to show." });
    if (await db.first(`SELECT 1 AS x FROM org_domains WHERE domain = ? AND verified_at IS NOT NULL AND org_id != ?`, [domain, x.org.id])) return c.json({ verified: false, reason: "Another company has already verified that domain." });
    await db.run(`UPDATE org_domains SET verified_at = ? WHERE org_id = ? AND domain = ?`, [clock.now(), x.org.id, domain]);
    await audit(db, clock.now(), x.org.id, actor(user), "domain.verified", domain);
    return c.json({ verified: true });
  });

  // Onboarding progress: saved after each step so the setup can be left and resumed.
  app.put("/api/orgs/:id/onboarding", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.manageSettings(x.role)) return c.json({ error: "Only Owners and Admins can set up the company." }, 403);
    const b = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!b) return c.json({ error: "Send the progress to save." }, 400);
    const next = onboardingOf(x.org);
    if (b.step !== undefined) {
      if (!(ONBOARDING_STEPS as readonly unknown[]).includes(b.step)) return c.json({ error: "Unknown step." }, 400);
      next.step = b.step as OnboardingStep;
    }
    if (b.email !== undefined) next.email = str(b.email, 254) ?? "";
    if (b.people !== undefined) {
      const people = cleanPeople(b.people);
      if (!people) return c.json({ error: "The people list isn't valid (up to 1,000 people)." }, 400);
      next.people = people;
    }
    if (b.firstPlanId !== undefined) {
      const id = typeof b.firstPlanId === "string" ? b.firstPlanId : null;
      if (id && !(await db.first(`SELECT 1 AS x FROM plans p JOIN workspaces w ON w.id = p.workspace_id WHERE p.id = ? AND w.org_id = ?`, [id, x.org.id]))) return c.json({ error: "That plan isn't in the company." }, 400);
      next.firstPlanId = id;
    }
    await db.run(`UPDATE organizations SET onboarding = ? WHERE id = ?`, [JSON.stringify(next), x.org.id]);
    return c.json({ onboarding: next });
  });

  // Rules: one of the presets; each change is in the audit log.
  app.put("/api/orgs/:id/settings", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.manageSettings(x.role)) return c.json({ error: "Only Owners and Admins can change the company's rules." }, 403);
    const b = await c.req.json<{ preset?: unknown }>().catch(() => null);
    const preset = typeof b?.preset === "string" && b.preset in RULE_PRESETS ? (b.preset as RulePreset) : null;
    if (!preset) return c.json({ error: "Choose Standard, Strict or Open." }, 400);
    const before = rulesOf(x.org.settings).preset;
    const settings = { ...(JSON.parse(x.org.settings || "{}") as Record<string, unknown>), preset };
    await db.run(`UPDATE organizations SET settings = ? WHERE id = ?`, [JSON.stringify(settings), x.org.id]);
    if (before !== preset || !JSON.parse(x.org.settings || "{}").preset) await audit(db, clock.now(), x.org.id, actor(user), "rules.changed", x.org.name, { from: before, to: preset });
    return c.json({ rules: rulesOf(JSON.stringify(settings)) });
  });

  // Go live: the saved people list is checked once more and the good rows get invite links; with
  // `dryRun` only the check. Onboarding is then done.
  app.post("/api/orgs/:id/golive", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.manageSettings(x.role)) return c.json({ error: "Only Owners and Admins can set up the company." }, 403);
    const b = await c.req.json<{ dryRun?: unknown }>().catch(() => ({}) as { dryRun?: unknown });
    const ob = onboardingOf(x.org);
    const people = ob.people ?? [];
    const check = people.length ? await checkInvites(db, clock.now(), x.org.id, x.role, people) : { rows: [] as InviteCheck[], seatsLeft: 0 };
    const skipped = check.rows.filter((r) => !r.ok);
    if (b?.dryRun === true) return c.json({ dryRun: true, willInvite: check.rows.filter((r) => r.ok), skipped });
    const invited = [];
    for (const r of check.rows.filter((r) => r.ok)) invited.push({ ...(await createInvite(db, d, x.org, user, r, d.email)), name: r.name, role: r.role });
    const now = clock.now();
    if (invited.length) await audit(db, now, x.org.id, actor(user), "people.invited", `${invited.length} ${invited.length === 1 ? "person" : "people"}`, { emails: invited.map((l) => l.email) });
    await db.run(`UPDATE organizations SET onboarding = ? WHERE id = ?`, [JSON.stringify({ ...ob, step: "live", done: true, liveAt: now }), x.org.id]);
    await audit(db, now, x.org.id, actor(user), "org.live", x.org.name, { invited: invited.length, skipped: skipped.length, rules: rulesOf(x.org.settings).preset });
    return c.json({ invited, skipped }, 201);
  });

  // Audit log: search and filter; CSV; whether the chain is intact.
  app.get("/api/orgs/:id/audit", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.readAudit(x.role)) return c.json({ error: "Only Owners, Admins and Auditors can read the audit log." }, 403);
    const q = (c.req.query("q") ?? "").toLowerCase();
    const action = c.req.query("action") ?? "";
    const rows = (await db.all<AuditRow>(`SELECT * FROM audit_log WHERE org_id = ? ORDER BY seq DESC LIMIT 5000`, [x.org.id]))
      .filter((r) => (!action || r.action === action) && (!q || `${r.actor_name} ${r.action} ${r.target} ${r.detail}`.toLowerCase().includes(q)));
    const items = rows.map((r) => ({ seq: Number(r.seq), at: Number(r.at), actor: r.actor_name, action: r.action, target: r.target, detail: JSON.parse(r.detail) as Record<string, unknown> }));
    if (c.req.query("format") === "csv") {
      const cell = (v: unknown) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
      const csv = ["Seq,Time (UTC),Who,Action,Target,Detail", ...items.map((i) => [i.seq, new Date(i.at).toISOString(), i.actor, i.action, i.target, JSON.stringify(i.detail)].map(cell).join(","))].join("\r\n");
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log.csv"` } });
    }
    const broken = await auditBreak(db, x.org.id);
    const actions = (await db.all<{ action: string }>(`SELECT DISTINCT action FROM audit_log WHERE org_id = ? ORDER BY action`, [x.org.id])).map((r) => r.action);
    return c.json({ items: items.slice(0, 500), total: items.length, intact: broken === null, brokenAt: broken, actions });
  });
}
