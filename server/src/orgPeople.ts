/**
 * The admin console's People and Licenses (step L3a): everyone in a company and their open
 * invites in one list; changes to many people at once, always previewed first (the dry run) and
 * undoable for 24 hours; one person's details; signing someone out everywhere; extra workspaces
 * (for example one per department).
 */
import type { Hono } from "hono";
import { BRAND } from "@rakuplan/shared";
import type { Clock, Db, User } from "./ports";
import { INVITE_DAYS } from "./invites";
import { endAllSessions, randomToken, sha256 } from "./sessions";
import { notify } from "./notify";
import { audit, can, mayGrant, ORG_ROLE_WORD, ORG_ROLES, orgOf, orgRole, seatsTaken, syncAccess, usesSeat, type OrgRole } from "./orgs";

export const UNDO_HOURS = 24;
export const INACTIVE_DAYS = 60;
const DAY = 86_400_000;

export interface PersonEntry {
  /** A user id, or `invite:<id>` for someone invited who hasn't joined yet. */
  id: string;
  kind: "person" | "invite";
  name: string;
  email: string;
  role: OrgRole;
  status: "active" | "invited" | "expired" | "deactivated";
  department: string | null;
  workspaces: string[];
  source: string;
  joinedAt: number | null;
  lastActiveAt: number | null;
  /** Whether this entry holds a seat now. */
  seat: boolean;
}

type MemberRow = { user_id: string; name: string; email: string; role: OrgRole; status: "active" | "deactivated"; department: string | null; workspaces: string; source: string; joined_at: number; last_active_at: number | null; deactivated_at: number | null };
type InviteRow = { id: string; email: string; name: string | null; role: OrgRole; department: string | null; workspace_id: string | null; created_at: number; expires_at: number; revoked_at: number | null };

export async function peopleOf(db: Db, orgId: string, now: number): Promise<PersonEntry[]> {
  const members = await db.all<MemberRow>(`SELECT om.*, u.name, u.email FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = ? ORDER BY lower(u.name)`, [orgId]);
  const joined = new Set(members.filter((m) => m.status === "active").map((m) => m.email.toLowerCase()));
  const invites = await db.all<InviteRow>(`SELECT * FROM org_invites WHERE org_id = ? AND accepted_by IS NULL AND revoked_at IS NULL ORDER BY created_at`, [orgId]);
  const out: PersonEntry[] = members.map((m) => ({
    id: m.user_id, kind: "person", name: m.name, email: m.email, role: m.role, status: m.status,
    department: m.department, workspaces: JSON.parse(m.workspaces) as string[], source: m.source,
    joinedAt: Number(m.joined_at), lastActiveAt: m.last_active_at === null ? null : Number(m.last_active_at),
    seat: m.status === "active" && usesSeat(m.role),
  }));
  const seenInvite = new Set<string>();
  for (const i of [...invites].reverse()) { // newest invite per address wins
    const email = i.email.toLowerCase();
    if (joined.has(email) || seenInvite.has(email)) continue;
    seenInvite.add(email);
    const live = Number(i.expires_at) > now;
    out.push({
      id: `invite:${i.id}`, kind: "invite", name: i.name ?? i.email, email: i.email, role: i.role, status: live ? "invited" : "expired",
      department: i.department, workspaces: i.workspace_id ? [i.workspace_id] : [], source: "invite",
      joinedAt: null, lastActiveAt: null, seat: live && usesSeat(i.role),
    });
  }
  return out;
}

/** Active people holding a seat who haven't used the app in 60 days (never the Owner). */
export const reclaimable = (people: PersonEntry[], now: number) =>
  people.filter((p) => p.kind === "person" && p.seat && p.role !== "owner" && (p.lastActiveAt ?? p.joinedAt ?? now) < now - INACTIVE_DAYS * DAY);

// ---------------------------------------------------------------- changes to many people at once

export const BULK_ACTIONS = ["role", "department", "workspace", "deactivate", "reactivate", "resend", "cancel"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export interface BulkChange { id: string; name: string; email: string; from: string; to: string }
export interface BulkSkip { id: string; name: string; email: string; reason: string }
type Snapshot =
  | { kind: "person"; userId: string; role: OrgRole; status: string; department: string | null; workspaces: string; deactivated_at: number | null }
  | { kind: "invite"; id: string; role: OrgRole; department: string | null; workspace_id: string | null; revoked_at: number | null; expires_at: number };

export interface BulkDeps { db: Db; clock: Clock; siteOrigin: string; email: (to: string, subject: string, text: string) => Promise<void> }

const statusWord = (p: PersonEntry) => ({ active: "Active", invited: "Invited", expired: "Invite expired", deactivated: "Deactivated" })[p.status];

/** Works out what one bulk action would do to each chosen entry; changes nothing. */
async function plan(db: Db, now: number, orgId: string, actor: User, actorRole: OrgRole, action: BulkAction, ids: string[], value: string | undefined) {
  const org = (await orgOf(db, orgId))!;
  const people = await peopleOf(db, orgId, now);
  const byId = new Map(people.map((p) => [p.id, p]));
  const wsNames = new Map((await db.all<{ id: string; name: string }>(`SELECT id, name FROM workspaces WHERE org_id = ?`, [orgId])).map((w) => [w.id, w.name]));
  const mine = actorRole === "dept_admin" ? (people.find((p) => p.id === actor.id)?.workspaces ?? []) : [];
  const owners = people.filter((p) => p.kind === "person" && p.role === "owner" && p.status === "active").map((p) => p.id);
  let seatsLeft = Number(org.seats) - (await seatsTaken(db, orgId, now));
  const changes: BulkChange[] = [];
  const skipped: BulkSkip[] = [];
  const touched: PersonEntry[] = [];
  for (const id of [...new Set(ids)].slice(0, 5000)) {
    const p = byId.get(id);
    if (!p) { skipped.push({ id, name: "Unknown", email: "", reason: "Not in this company." }); continue; }
    const skip = (reason: string) => skipped.push({ id, name: p.name, email: p.email, reason });
    const change = (from: string, to: string) => { changes.push({ id, name: p.name, email: p.email, from, to }); touched.push(p); };
    if (action === "resend" || action === "cancel") {
      if (p.kind !== "invite") { skip("Already joined."); continue; }
    } else if (p.kind === "invite" && (action === "deactivate" || action === "reactivate")) { skip("Hasn't joined yet. Cancel the invite instead."); continue; }
    if (p.id === actor.id && (action === "role" || action === "deactivate")) { skip("That's you. Ask another Owner or Admin."); continue; }
    if (p.role === "owner" && actorRole !== "owner") { skip("Only an Owner can change an Owner."); continue; }
    if (actorRole === "dept_admin" && action !== "resend" && ((p.role !== "member" && p.role !== "guest") || !p.workspaces.every((w) => mine.includes(w)))) { skip("Outside your department's workspaces."); continue; }
    const freesSeat = p.seat;
    switch (action) {
      case "role": {
        const to = value as OrgRole;
        if (p.role === to) { skip(`Already ${ORG_ROLE_WORD[to]}.`); continue; }
        if (!mayGrant(actorRole, to)) { skip(`You can't make someone ${ORG_ROLE_WORD[to]}.`); continue; }
        if (p.role === "owner" && owners.length - touched.filter((t) => t.role === "owner").length <= 1) { skip("The company needs at least one Owner."); continue; }
        if (!p.seat && usesSeat(to) && p.status !== "deactivated" && p.status !== "expired") {
          if (seatsLeft <= 0) { skip("No seats left. Add seats in Licenses, or free one."); continue; }
          seatsLeft--;
        }
        if (p.seat && !usesSeat(to)) seatsLeft++;
        change(ORG_ROLE_WORD[p.role], ORG_ROLE_WORD[to]);
        break;
      }
      case "department": {
        const to = (value ?? "").trim().slice(0, 60);
        if ((p.department ?? "") === to) { skip(to ? `Already in ${to}.` : "Has no department."); continue; }
        change(p.department ?? "No department", to || "No department");
        break;
      }
      case "workspace": {
        if (!value || !wsNames.has(value)) { skip("Choose one of the company's workspaces."); continue; }
        if (p.workspaces.length === 1 && p.workspaces[0] === value) { skip(`Already in ${wsNames.get(value)}.`); continue; }
        change(p.workspaces.map((w) => wsNames.get(w) ?? "?").join(", ") || "No workspace", wsNames.get(value)!);
        break;
      }
      case "deactivate": {
        if (p.status === "deactivated") { skip("Already deactivated."); continue; }
        if (p.role === "owner" && owners.length - touched.filter((t) => t.role === "owner").length <= 1) { skip("The company needs at least one Owner."); continue; }
        if (freesSeat) seatsLeft++;
        change(statusWord(p), "Deactivated");
        break;
      }
      case "reactivate": {
        if (p.status === "active") { skip("Already active."); continue; }
        if (usesSeat(p.role)) {
          if (seatsLeft <= 0) { skip("No seats left. Add seats in Licenses, or free one."); continue; }
          seatsLeft--;
        }
        change("Deactivated", "Active");
        break;
      }
      case "resend": {
        if (p.status === "expired" && usesSeat(p.role)) {
          if (seatsLeft <= 0) { skip("No seats left. Add seats in Licenses, or free one."); continue; }
          seatsLeft--;
        }
        change(statusWord(p), `New link, valid ${INVITE_DAYS} days`);
        break;
      }
      case "cancel": {
        if (freesSeat) seatsLeft++;
        change(statusWord(p), "Invite cancelled");
        break;
      }
    }
  }
  return { org, changes, skipped, touched, wsNames };
}

async function snapshot(db: Db, orgId: string, p: PersonEntry): Promise<Snapshot> {
  if (p.kind === "person") {
    const m = (await db.first<{ role: OrgRole; status: string; department: string | null; workspaces: string; deactivated_at: number | null }>(`SELECT role, status, department, workspaces, deactivated_at FROM org_members WHERE org_id = ? AND user_id = ?`, [orgId, p.id]))!;
    return { kind: "person", userId: p.id, role: m.role, status: m.status, department: m.department, workspaces: m.workspaces, deactivated_at: m.deactivated_at === null ? null : Number(m.deactivated_at) };
  }
  const i = (await db.first<{ role: OrgRole; department: string | null; workspace_id: string | null; revoked_at: number | null; expires_at: number }>(`SELECT role, department, workspace_id, revoked_at, expires_at FROM org_invites WHERE id = ?`, [p.id.slice(7)]))!;
  return { kind: "invite", id: p.id.slice(7), role: i.role, department: i.department, workspace_id: i.workspace_id, revoked_at: i.revoked_at === null ? null : Number(i.revoked_at), expires_at: Number(i.expires_at) };
}

// ---------------------------------------------------------------- routes

export function registerOrgPeopleRoutes(app: Hono<{ Variables: { user: User } }>, d: BulkDeps & { notFound: { error: string } }) {
  const { db, clock } = d;
  const consoleFor = async (orgId: string, user: User) => {
    const org = await orgOf(db, orgId);
    const role = org ? await orgRole(db, orgId, user.id) : null;
    return org && role && can.console(role) ? { org, role } : null;
  };
  const who = (u: User) => ({ id: u.id, name: u.name });

  app.get("/api/orgs/:id/people", async (c) => {
    const x = await consoleFor(c.req.param("id"), c.get("user"));
    if (!x) return c.json(d.notFound, 404);
    const now = clock.now();
    const people = await peopleOf(db, x.org.id, now);
    return c.json({ people, reclaimable: reclaimable(people, now).map((p) => p.id), inactiveDays: INACTIVE_DAYS });
  });

  // Bulk changes: { action, ids, value, dryRun }. The dry run says what would change and what's
  // skipped and why; applying does exactly that and returns an undo id (24 hours).
  app.post("/api/orgs/:id/people/bulk", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    const b = await c.req.json<{ action?: unknown; ids?: unknown; value?: unknown; dryRun?: unknown }>().catch(() => null);
    const action = (BULK_ACTIONS as readonly unknown[]).includes(b?.action) ? (b!.action as BulkAction) : null;
    if (!action) return c.json({ error: "Choose what to change." }, 400);
    if (action === "resend" ? !can.supportPeople(x.role) : !can.managePeople(x.role)) return c.json({ error: "Your role can't make this change." }, 403);
    const ids = Array.isArray(b?.ids) ? (b!.ids as unknown[]).filter((i): i is string => typeof i === "string") : [];
    if (!ids.length) return c.json({ error: "Choose at least one person." }, 400);
    const value = typeof b?.value === "string" ? b.value : undefined;
    if (action === "role" && !(ORG_ROLES as readonly string[]).includes(value ?? "")) return c.json({ error: "Choose a role." }, 400);
    const now = clock.now();
    const p = await plan(db, now, x.org.id, user, x.role, action, ids, value);
    if (b?.dryRun === true) return c.json({ dryRun: true, changes: p.changes, skipped: p.skipped });
    if (!p.changes.length) return c.json({ changes: [], skipped: p.skipped, undoId: null, links: [] });

    const before = await Promise.all(p.touched.map((t) => snapshot(db, x.org.id, t)));
    const links: { email: string; link: string }[] = [];
    for (const t of p.touched) {
      const inviteId = t.id.slice(7);
      if (t.kind === "invite") {
        if (action === "cancel") await db.run(`UPDATE org_invites SET revoked_at = ? WHERE id = ?`, [now, inviteId]);
        else if (action === "resend") {
          const token = randomToken();
          await db.run(`UPDATE org_invites SET token_hash = ?, expires_at = ? WHERE id = ?`, [await sha256(token), now + INVITE_DAYS * DAY, inviteId]);
          const link = `${d.siteOrigin}/join/${token}`;
          links.push({ email: t.email, link });
          await d.email(t.email, `Reminder: ${user.name} invited you to ${x.org.name} on ${BRAND.name}`, `${user.name} invited you to join ${x.org.name} on ${BRAND.name} as ${ORG_ROLE_WORD[t.role]}.\n\nJoin: ${link}\n\nThe link works once, for ${t.email}, for ${INVITE_DAYS} days. Earlier links no longer work.`);
        } else if (action === "role") await db.run(`UPDATE org_invites SET role = ? WHERE id = ?`, [value ?? null, inviteId]);
        else if (action === "department") await db.run(`UPDATE org_invites SET department = ? WHERE id = ?`, [value?.trim().slice(0, 60) || null, inviteId]);
        else if (action === "workspace") await db.run(`UPDATE org_invites SET workspace_id = ? WHERE id = ?`, [value ?? null, inviteId]);
        continue;
      }
      if (action === "role") await db.run(`UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?`, [value ?? null, x.org.id, t.id]);
      else if (action === "department") await db.run(`UPDATE org_members SET department = ? WHERE org_id = ? AND user_id = ?`, [value?.trim().slice(0, 60) || null, x.org.id, t.id]);
      else if (action === "workspace") await db.run(`UPDATE org_members SET workspaces = ? WHERE org_id = ? AND user_id = ?`, [JSON.stringify([value]), x.org.id, t.id]);
      else if (action === "deactivate") {
        await db.run(`UPDATE org_members SET status = 'deactivated', deactivated_at = ? WHERE org_id = ? AND user_id = ?`, [now, x.org.id, t.id]);
        await notify(db, now, { userId: t.id, kind: "company", text: `Your access to ${x.org.name}'s plans has ended`, link: "/" }, user.id);
      } else if (action === "reactivate") {
        await db.run(`UPDATE org_members SET status = 'active', deactivated_at = NULL WHERE org_id = ? AND user_id = ?`, [x.org.id, t.id]);
        await notify(db, now, { userId: t.id, kind: "company", text: `You're back in ${x.org.name}`, link: "/" }, user.id);
      }
      await syncAccess(db, x.org.id, t.id);
    }
    // Resending can't be taken back (old links stop working at once); everything else can for 24 hours.
    let undoId: string | null = null;
    if (action !== "resend") {
      undoId = crypto.randomUUID();
      await db.run(`INSERT INTO undo_batches (id, org_id, actor_id, action, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [undoId, x.org.id, user.id, action, JSON.stringify(before), now]);
    }
    await audit(db, now, x.org.id, who(user), `people.${action}`, `${p.changes.length} ${p.changes.length === 1 ? "person" : "people"}`, { value: action === "workspace" ? p.wsNames.get(value ?? "") : value ?? null, emails: p.changes.map((ch) => ch.email), skipped: p.skipped.length });
    return c.json({ changes: p.changes, skipped: p.skipped, undoId, undoUntil: undoId ? now + UNDO_HOURS * 3_600_000 : null, links });
  });

  // Undo a bulk change within 24 hours: everyone it touched goes back to how they were.
  app.post("/api/orgs/:id/undo/:batch", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.managePeople(x.role)) return c.json({ error: "Your role can't undo changes." }, 403);
    const batch = await db.first<{ id: string; action: string; payload: string; created_at: number; undone_at: number | null }>(`SELECT * FROM undo_batches WHERE id = ? AND org_id = ?`, [c.req.param("batch"), x.org.id]);
    const now = clock.now();
    if (!batch) return c.json({ error: "That change can't be found." }, 404);
    if (batch.undone_at) return c.json({ error: "That change was already undone." }, 409);
    if (Number(batch.created_at) < now - UNDO_HOURS * 3_600_000) return c.json({ error: `Changes can be undone for ${UNDO_HOURS} hours. This one is older.` }, 409);
    const before = JSON.parse(batch.payload) as Snapshot[];
    // Putting people back must fit in the seats.
    let need = 0;
    for (const s of before) {
      if (s.kind === "person") {
        const cur = await db.first<{ role: OrgRole; status: string }>(`SELECT role, status FROM org_members WHERE org_id = ? AND user_id = ?`, [x.org.id, s.userId]);
        need += Number(s.status === "active" && usesSeat(s.role)) - Number(cur?.status === "active" && usesSeat(cur.role));
      } else {
        const cur = await db.first<{ role: OrgRole; revoked_at: number | null; accepted_by: string | null; expires_at: number }>(`SELECT role, revoked_at, accepted_by, expires_at FROM org_invites WHERE id = ?`, [s.id]);
        const was = !s.revoked_at && s.expires_at > now && usesSeat(s.role);
        const is = !!cur && !cur.revoked_at && !cur.accepted_by && Number(cur.expires_at) > now && usesSeat(cur.role);
        need += Number(was && !cur?.accepted_by) - Number(is);
      }
    }
    if (need > 0 && (await seatsTaken(db, x.org.id, now)) + need > Number(x.org.seats)) return c.json({ error: `Undoing this needs ${need} more ${need === 1 ? "seat" : "seats"}. Add seats in Licenses first.` }, 409);
    for (const s of before) {
      if (s.kind === "person") {
        await db.run(`UPDATE org_members SET role = ?, status = ?, department = ?, workspaces = ?, deactivated_at = ? WHERE org_id = ? AND user_id = ?`, [s.role, s.status, s.department, s.workspaces, s.deactivated_at, x.org.id, s.userId]);
        await syncAccess(db, x.org.id, s.userId);
      } else {
        await db.run(`UPDATE org_invites SET role = ?, department = ?, workspace_id = ?, revoked_at = ? WHERE id = ? AND accepted_by IS NULL`, [s.role, s.department, s.workspace_id, s.revoked_at, s.id]);
      }
    }
    await db.run(`UPDATE undo_batches SET undone_at = ? WHERE id = ?`, [now, batch.id]);
    await audit(db, now, x.org.id, who(user), "people.undo", `${before.length} ${before.length === 1 ? "person" : "people"}`, { undid: batch.action });
    return c.json({ ok: true, restored: before.length });
  });

  // One person: profile, plans they made in the company, signed-in devices, recent activity.
  app.get("/api/orgs/:id/people/:userId", async (c) => {
    const x = await consoleFor(c.req.param("id"), c.get("user"));
    if (!x) return c.json(d.notFound, 404);
    const now = clock.now();
    const person = (await peopleOf(db, x.org.id, now)).find((p) => p.id === c.req.param("userId") && p.kind === "person");
    if (!person) return c.json({ error: "That person isn't in this company." }, 404);
    const plans = await db.all<{ id: string; title: string }>(`SELECT p.id, p.title FROM plans p JOIN workspaces w ON w.id = p.workspace_id WHERE w.org_id = ? AND p.created_by = ? AND p.state != 'archived' ORDER BY p.updated_at DESC LIMIT 50`, [x.org.id, person.id]);
    const sessions = Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?`, [person.id, now]))?.n ?? 0);
    const activity = can.readAudit(x.role)
      ? (await db.all<{ at: number; actor_name: string; action: string; target: string; detail: string }>(`SELECT at, actor_name, action, target, detail FROM audit_log WHERE org_id = ? AND (actor_id = ? OR lower(target) = ? OR lower(detail) LIKE ?) ORDER BY seq DESC LIMIT 20`, [x.org.id, person.id, person.email.toLowerCase(), `%${person.email.toLowerCase()}%`]))
        .map((r) => ({ at: Number(r.at), actor: r.actor_name, action: r.action, target: r.target }))
      : [];
    return c.json({ person, plans, sessions, activity });
  });

  // Sign out everywhere: ends every session of that account (Helpdesk can do this).
  app.post("/api/orgs/:id/people/:userId/signout", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.supportPeople(x.role)) return c.json({ error: "Your role can't sign people out." }, 403);
    const target = await db.first<{ role: OrgRole; email: string }>(`SELECT om.role, u.email FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = ? AND om.user_id = ?`, [x.org.id, c.req.param("userId")]);
    if (!target) return c.json({ error: "That person isn't in this company." }, 404);
    if (target.role === "owner" && x.role !== "owner") return c.json({ error: "Only an Owner can sign out an Owner." }, 403);
    const ended = await endAllSessions(db, c.req.param("userId"));
    await audit(db, clock.now(), x.org.id, who(user), "person.signed_out", target.email, { sessions: ended });
    return c.json({ ended });
  });

  // Another workspace in the company (for example one per department).
  app.post("/api/orgs/:id/workspaces", async (c) => {
    const user = c.get("user");
    const x = await consoleFor(c.req.param("id"), user);
    if (!x) return c.json(d.notFound, 404);
    if (!can.manageSettings(x.role)) return c.json({ error: "Only Owners and Admins can add workspaces." }, 403);
    const b = await c.req.json<{ name?: unknown }>().catch(() => null);
    const name = typeof b?.name === "string" ? b.name.trim().slice(0, 80) : "";
    if (!name) return c.json({ error: "Name the workspace." }, 400);
    if (await db.first(`SELECT 1 AS x FROM workspaces WHERE org_id = ? AND lower(name) = ?`, [x.org.id, name.toLowerCase()])) return c.json({ error: "There's already a workspace with that name." }, 409);
    const work = (await db.first<{ work_week: string }>(`SELECT work_week FROM workspaces WHERE org_id = ? ORDER BY created_at LIMIT 1`, [x.org.id]))?.work_week ?? "{}";
    const id = crypto.randomUUID();
    const now = clock.now();
    await db.run(`INSERT INTO workspaces (id, name, work_week, created_at, org_id) VALUES (?, ?, ?, ?, ?)`, [id, name, work, now, x.org.id]);
    for (const m of await db.all<{ user_id: string }>(`SELECT user_id FROM org_members WHERE org_id = ? AND role IN ('owner', 'admin') AND status = 'active'`, [x.org.id])) await syncAccess(db, x.org.id, m.user_id);
    await audit(db, now, x.org.id, who(user), "workspace.added", name);
    return c.json({ id, name }, 201);
  });
}
