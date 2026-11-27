/**
 * Database migrations, kept as code so both hosts run exactly the same ones (Workers have no
 * file system). Each migration is a list of single statements, applied in one transaction.
 * Never edit a released migration; add a new one.
 */
import type { Db } from "./ports";

export interface Migration {
  id: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "users, workspaces, members, plans",
    statements: [
      `CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)`,
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
      `CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, work_week TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE TABLE members (workspace_id TEXT NOT NULL REFERENCES workspaces(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK (role IN ('manager', 'editor', 'viewer')), PRIMARY KEY (workspace_id, user_id))`,
      `CREATE INDEX members_user ON members(user_id)`,
      `CREATE TABLE plans (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active', room TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE INDEX plans_workspace ON plans(workspace_id)`,
      `CREATE TABLE plan_versions (plan_id TEXT NOT NULL REFERENCES plans(id), version INTEGER NOT NULL, reason TEXT NOT NULL, snapshot TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (plan_id, version))`,
    ],
  },
  {
    id: 2,
    name: "sign-in identities, login attempts, hashed sessions",
    statements: [
      `CREATE TABLE identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), email TEXT NOT NULL, created_at INTEGER NOT NULL, last_login_at INTEGER NOT NULL, PRIMARY KEY (provider, subject))`,
      `CREATE INDEX identities_user ON identities(user_id)`,
      `CREATE TABLE login_attempts (state TEXT PRIMARY KEY, provider TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, return_to TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
      // The first sessions table was never used; sessions now store only a hash of the token.
      `DROP TABLE sessions`,
      `CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, user_agent TEXT)`,
      `CREATE INDEX sessions_user ON sessions(user_id)`,
    ],
  },
  {
    id: 3,
    name: "availability people give each plan",
    statements: [
      // name_key is the lowercased name, so "Priya" and "priya" are one person on a plan.
      `CREATE TABLE plan_people (plan_id TEXT NOT NULL REFERENCES plans(id), name_key TEXT NOT NULL, name TEXT NOT NULL, availability TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (plan_id, name_key))`,
    ],
  },
  {
    id: 4,
    name: "plan sharing: members with roles, invites, names linked to accounts",
    statements: [
      `CREATE TABLE plan_members (plan_id TEXT NOT NULL REFERENCES plans(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')), added_by TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY (plan_id, user_id))`,
      `CREATE INDEX plan_members_user ON plan_members(user_id)`,
      // Only a hash of the link's secret is kept; the link itself is shown once to whoever invites.
      `CREATE TABLE invites (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, plan_id TEXT NOT NULL REFERENCES plans(id), email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')), person_name TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, accepted_by TEXT, accepted_at INTEGER, revoked_at INTEGER)`,
      `CREATE INDEX invites_plan ON invites(plan_id)`,
      `ALTER TABLE plan_people ADD COLUMN user_id TEXT`,
    ],
  },
  {
    id: 5,
    name: "AI checks, reports, usage, limits and credits, safety holds",
    statements: [
      `CREATE TABLE ai_usage (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan_id TEXT, workspace_id TEXT NOT NULL, feature TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, status TEXT NOT NULL, month TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE INDEX ai_usage_ws_month ON ai_usage(workspace_id, month)`,
      `CREATE INDEX ai_usage_user_month ON ai_usage(user_id, month)`,
      `CREATE TABLE ai_reviews (plan_id TEXT PRIMARY KEY REFERENCES plans(id), plan_version INTEGER NOT NULL, result TEXT NOT NULL, hidden INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE TABLE ai_suppressions (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id), kind TEXT NOT NULL, text TEXT NOT NULL, task_ids TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE INDEX ai_suppressions_plan ON ai_suppressions(plan_id)`,
      // user_id '*' is the workspace's default allowance; a row per person overrides it.
      `CREATE TABLE ai_allowances (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, monthly_checks INTEGER NOT NULL, monthly_reports INTEGER NOT NULL, set_by TEXT NOT NULL, set_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, user_id))`,
      `CREATE TABLE ai_credit_requests (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, checks INTEGER NOT NULL, reports INTEGER NOT NULL, note TEXT, status TEXT NOT NULL, decided_by TEXT, decided_at INTEGER, created_at INTEGER NOT NULL)`,
      // user_id NULL = added to the workspace pool (a top-up); otherwise extra for one person this month.
      `CREATE TABLE ai_credit_grants (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT, month TEXT NOT NULL, checks INTEGER NOT NULL, reports INTEGER NOT NULL, granted_by TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL)`,
      `CREATE INDEX ai_grants_ws_month ON ai_credit_grants(workspace_id, month)`,
      `CREATE TABLE ai_moderation_cache (text_hash TEXT PRIMARY KEY, verdict TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE TABLE safety_holds (id TEXT PRIMARY KEY, plan_id TEXT, user_id TEXT NOT NULL, feature TEXT NOT NULL, category TEXT, excerpt TEXT NOT NULL, status TEXT NOT NULL, note TEXT, decided_by TEXT, decided_at INTEGER, created_at INTEGER NOT NULL)`,
      `ALTER TABLE members ADD COLUMN department TEXT`,
    ],
  },
  {
    id: 6,
    name: "account suspension (safety review)",
    statements: [`ALTER TABLE users ADD COLUMN suspended_at INTEGER`],
  },
  {
    id: 7,
    name: "commenter role, comments, activity",
    statements: [
      // SQLite can't change a CHECK constraint in place: rebuild both tables with the new role, keeping every row.
      `CREATE TABLE plan_members_new (plan_id TEXT NOT NULL REFERENCES plans(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')), added_by TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY (plan_id, user_id))`,
      `INSERT INTO plan_members_new SELECT plan_id, user_id, role, added_by, added_at FROM plan_members`,
      `DROP TABLE plan_members`,
      `ALTER TABLE plan_members_new RENAME TO plan_members`,
      `CREATE INDEX plan_members_user ON plan_members(user_id)`,
      `CREATE TABLE invites_new (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, plan_id TEXT NOT NULL REFERENCES plans(id), email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')), person_name TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, accepted_by TEXT, accepted_at INTEGER, revoked_at INTEGER)`,
      `INSERT INTO invites_new SELECT id, token_hash, plan_id, email, role, person_name, created_by, created_at, expires_at, accepted_by, accepted_at, revoked_at FROM invites`,
      `DROP TABLE invites`,
      `ALTER TABLE invites_new RENAME TO invites`,
      `CREATE INDEX invites_plan ON invites(plan_id)`,
      `CREATE TABLE comments (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id), task_id TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, mentions TEXT NOT NULL, created_at INTEGER NOT NULL, edited_at INTEGER, deleted_at INTEGER)`,
      `CREATE INDEX comments_task ON comments(plan_id, task_id, created_at)`,
      `CREATE TABLE activity (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id), actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, kind TEXT NOT NULL, task_id TEXT, summary TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE INDEX activity_plan ON activity(plan_id, created_at)`,
    ],
  },
  {
    id: 8,
    name: "notifications",
    statements: [
      `CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), plan_id TEXT, kind TEXT NOT NULL, text TEXT NOT NULL, link TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER)`,
      `CREATE INDEX notifications_user ON notifications(user_id, read_at, created_at)`,
    ],
  },
  {
    id: 9,
    name: "help: company support contacts, support requests, time-limited plan access",
    statements: [
      `CREATE TABLE support_contacts (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), team TEXT NOT NULL, email TEXT, phone TEXT, url TEXT, hours TEXT, note TEXT, route TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE TABLE support_tickets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), workspace_id TEXT, topic TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL, via TEXT NOT NULL, context TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE INDEX support_tickets_user ON support_tickets(user_id, updated_at)`,
      `CREATE INDEX support_tickets_via ON support_tickets(via, status, updated_at)`,
      `CREATE TABLE support_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id), author_id TEXT NOT NULL, from_staff INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE INDEX support_messages_ticket ON support_messages(ticket_id, created_at)`,
      `CREATE TABLE support_access_grants (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id), plan_id TEXT NOT NULL, granted_by TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER)`,
      `CREATE TABLE support_access_log (id TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES support_access_grants(id), staff_id TEXT NOT NULL, viewed_at INTEGER NOT NULL)`,
    ],
  },
  {
    id: 10,
    name: "safety cases with companies, the email outbox, server secrets",
    statements: [
      `CREATE TABLE safety_cases (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), report_id TEXT NOT NULL REFERENCES support_tickets(id), reporter_id TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER)`,
      `CREATE INDEX safety_cases_ws ON safety_cases(workspace_id, status, updated_at)`,
      `CREATE TABLE safety_case_messages (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES safety_cases(id), author_id TEXT, author_name TEXT NOT NULL, from_staff INTEGER NOT NULL, via TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE INDEX safety_case_messages_case ON safety_case_messages(case_id, created_at)`,
      `CREATE TABLE email_outbox (id TEXT PRIMARY KEY, to_addr TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, reply_to TEXT NOT NULL, headers TEXT NOT NULL, case_id TEXT, message_id TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE INDEX email_outbox_case ON email_outbox(case_id, created_at)`,
      `CREATE TABLE server_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    ],
  },
  {
    id: 11,
    name: "who wrote each message to or from our team (brand vs customer name, domain, role, company)",
    statements: [
      `ALTER TABLE safety_case_messages ADD COLUMN author_info TEXT`,
      `ALTER TABLE support_messages ADD COLUMN author_info TEXT`,
    ],
  },
  {
    id: 12,
    name: "status updates (red / amber / green, headline, sections) per plan",
    statements: [
      `CREATE TABLE status_updates (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id), rag TEXT NOT NULL CHECK (rag IN ('green', 'amber', 'red')), headline TEXT NOT NULL, sections TEXT NOT NULL, source TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL)`,
      `CREATE INDEX status_updates_plan ON status_updates(plan_id, created_at)`,
    ],
  },
  {
    id: 13,
    name: "per-person settings (dashboard layout)",
    statements: [`CREATE TABLE user_prefs (user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, key))`],
  },
  {
    id: 14,
    name: "risk log (risks, assumptions, issues, decisions) per plan",
    statements: [
      `CREATE TABLE raid_items (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id), kind TEXT NOT NULL CHECK (kind IN ('risk', 'assumption', 'issue', 'decision')), title TEXT NOT NULL, detail TEXT NOT NULL, owner TEXT, likelihood INTEGER, impact INTEGER, status TEXT NOT NULL CHECK (status IN ('open', 'closed')), due TEXT, task_ids TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE INDEX raid_items_plan ON raid_items(plan_id, status, updated_at)`,
    ],
  },
  {
    id: 15,
    name: "master plans: sub-plans with keys and departments, department contacts, discussion",
    statements: [
      `ALTER TABLE plans ADD COLUMN kind TEXT NOT NULL DEFAULT 'plan'`,
      `ALTER TABLE plans ADD COLUMN master_id TEXT REFERENCES plans(id)`,
      `ALTER TABLE plans ADD COLUMN plan_key TEXT`,
      `ALTER TABLE plans ADD COLUMN lead_dept TEXT`,
      `ALTER TABLE plans ADD COLUMN needs_depts TEXT NOT NULL DEFAULT '[]'`,
      `CREATE INDEX plans_master ON plans(master_id)`,
      `CREATE TABLE master_departments (master_id TEXT NOT NULL REFERENCES plans(id), name TEXT NOT NULL, contact TEXT, role TEXT, PRIMARY KEY (master_id, name))`,
      `CREATE TABLE master_messages (id TEXT PRIMARY KEY, master_id TEXT NOT NULL REFERENCES plans(id), scope TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, about TEXT, created_at INTEGER NOT NULL)`,
      `CREATE INDEX master_messages_scope ON master_messages(master_id, scope, created_at)`,
    ],
  },
  {
    id: 16,
    name: "organizations: companies above workspaces, members with org roles, invites, domains, audit log, undo",
    statements: [
      `CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, industry TEXT, seats INTEGER NOT NULL, settings TEXT NOT NULL, onboarding TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL)`,
      `ALTER TABLE workspaces ADD COLUMN org_id TEXT REFERENCES organizations(id)`,
      `CREATE TABLE org_members (org_id TEXT NOT NULL REFERENCES organizations(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'dept_admin', 'helpdesk', 'auditor', 'member', 'guest')), status TEXT NOT NULL CHECK (status IN ('active', 'deactivated')), department TEXT, workspaces TEXT NOT NULL, source TEXT NOT NULL, joined_at INTEGER NOT NULL, last_active_at INTEGER, deactivated_at INTEGER, PRIMARY KEY (org_id, user_id))`,
      `CREATE INDEX org_members_user ON org_members(user_id)`,
      `CREATE TABLE org_invites (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL, name TEXT, role TEXT NOT NULL, department TEXT, workspace_id TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, accepted_by TEXT, accepted_at INTEGER, revoked_at INTEGER)`,
      `CREATE INDEX org_invites_org ON org_invites(org_id, email)`,
      `CREATE TABLE org_domains (org_id TEXT NOT NULL REFERENCES organizations(id), domain TEXT NOT NULL, token TEXT NOT NULL, created_at INTEGER NOT NULL, verified_at INTEGER, PRIMARY KEY (org_id, domain))`,
      `CREATE TABLE audit_log (org_id TEXT NOT NULL REFERENCES organizations(id), seq INTEGER NOT NULL, at INTEGER NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (org_id, seq))`,
      `CREATE TABLE undo_batches (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), actor_id TEXT NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, undone_at INTEGER)`,
    ],
  },
  {
    id: 17,
    name: "plan access that ends: company rules give outside guests a set number of days",
    statements: [`ALTER TABLE plan_members ADD COLUMN expires_at INTEGER`],
  },
  {
    id: 18,
    name: "rate limits: hits per person or network address in the current window",
    statements: [`CREATE TABLE rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)`],
  },
  {
    id: 19,
    name: "archiving: when a plan was archived",
    statements: [`ALTER TABLE plans ADD COLUMN archived_at INTEGER`],
  },
  {
    id: 20,
    name: "operations: unexpected server errors (no personal data) and daily event counts",
    statements: [
      `CREATE TABLE server_errors (at INTEGER NOT NULL, method TEXT NOT NULL, route TEXT NOT NULL, name TEXT NOT NULL, message TEXT NOT NULL)`,
      `CREATE INDEX server_errors_at ON server_errors(at)`,
      `CREATE TABLE ops_events (day TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, kind))`,
    ],
  },
  {
    id: 21,
    name: "share links: read-only views of a plan without signing in",
    statements: [
      `CREATE TABLE share_links (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id), token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER, revoked_at INTEGER, last_opened_at INTEGER, opens INTEGER NOT NULL)`,
      `CREATE INDEX share_links_plan ON share_links(plan_id)`,
    ],
  },
  {
    id: 22,
    name: "scheduled jobs: what was sent (so nothing is sent twice), job runs, plans people follow",
    statements: [
      `CREATE TABLE sent_log (key TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
      `CREATE TABLE job_runs (name TEXT PRIMARY KEY, last_run INTEGER NOT NULL, last_ok INTEGER, last_error TEXT, runs INTEGER NOT NULL)`,
      `CREATE TABLE plan_follows (plan_id TEXT NOT NULL REFERENCES plans(id), user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, PRIMARY KEY (plan_id, user_id))`,
    ],
  },
];

/** Applies any migrations not yet applied. Safe to call on every start-up. */
export async function migrate(db: Db, now: number): Promise<number[]> {
  await db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
  const done = new Set((await db.all<{ id: number }>(`SELECT id FROM schema_migrations`)).map((r) => Number(r.id)));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.batch([
      ...m.statements.map((sql) => ({ sql })),
      { sql: `INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)`, params: [m.id, m.name, now] },
    ]);
    applied.push(m.id);
  }
  return applied;
}
