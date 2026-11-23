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
