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
const auditHash = (r: Omit<AuditRow, "hash">) => sha256(JSON.stringify([r.org_id, Number(r.seq), Number(r.at), r.actor_id, r.actor_name, r.action, r.target, r.detail, r.prev_hash]));

/** Appends one event; each row's hash covers the previous row's, so an edited or removed row shows. */
export async function audit(db: Db, now: number, orgId: string, actor: { id: string | null; name: string }, action: string, target: string, detail: Record<string, unknown> = {}): Promise<void> {
  const last = await db.first<{ seq: number; hash: string }>(`SELECT seq, hash FROM audit_log WHERE org_id = ? ORDER BY seq DESC LIMIT 1`, [orgId]);
  const row = { org_id: orgId, seq: Number(last?.seq ?? 0) + 1, at: now, actor_id: actor.id, actor_name: actor.name, action, target, detail: JSON.stringify(detail), prev_hash: last?.hash ?? ZERO };
  await db.run(`INSERT INTO audit_log (org_id, seq, at, actor_id, actor_name, action, target, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [row.org_id, row.seq, row.at, row.actor_id, row.actor_name, row.action, row.target, row.detail, row.prev_hash, await auditHash(row)]);
}

/** Checks the whole chain: null when intact, else the first sequence number that doesn't match. */
export async function auditBreak(db: Db, orgId: string): Promise<number | null> {
  const rows = await db.all<AuditRow>(`SELECT * FROM audit_log WHERE org_id = ? ORDER BY seq`, [orgId]);
  let prev = ZERO;
  for (const [i, r] of rows.entries()) {
    if (Number(r.seq) !== i + 1 || r.prev_hash !== prev || (await auditHash(r)) !== r.hash) return Number(r.seq);
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
    const rows = await db.all<{ id: string; name: string; role: OrgRole }>(`SELECT o.id, o.name, m.role FROM organizations o JOIN org_members m ON m.org_id = o.id WHERE m.user_id = ? AND m.status = 'active' ORDER BY o.name`, [c.get("user").id]);
    return c.json({ orgs: rows.map((r) => ({ ...r, console: can.console(r.role) })) });
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
      workspaces, settings: JSON.parse(x.org.settings), onboarding: JSON.parse(x.org.onboarding),
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
    return c.json({ items: items.slice(0, 500), total: items.length, intact: broken === null, brokenAt: broken });
  });
}
