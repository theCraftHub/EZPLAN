/** Migration 7 rebuilds two tables to add the Commenter role: every existing row must survive. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, migrate } from "@rakuplan/server";
import { NodeSqliteDb } from "../src/adapters";

describe("migration 7 keeps plan members and invites", () => {
  it("copies rows and then accepts the commenter role", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    const db = new NodeSqliteDb(join(dir, "db.sqlite"));
    await db.run(`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
    for (const m of MIGRATIONS.filter((x) => x.id <= 6)) await db.batch([...m.statements.map((sql) => ({ sql })), { sql: `INSERT INTO schema_migrations VALUES (?, ?, 0)`, params: [m.id, m.name] }]);
    await db.batch([
      { sql: `INSERT INTO users (id, name, email, created_at) VALUES ('u1', 'Alex', 'a@x.com', 0), ('u2', 'Sam', 's@x.com', 0)` },
      { sql: `INSERT INTO workspaces (id, name, work_week, created_at) VALUES ('w1', 'W', '{}', 0)` },
      { sql: `INSERT INTO plans (id, workspace_id, title, state, room, version, created_by, created_at, updated_at) VALUES ('p1', 'w1', 'P', 'active', '{}', 0, 'u1', 0, 0)` },
      { sql: `INSERT INTO plan_members VALUES ('p1', 'u2', 'viewer', 'u1', 5)` },
      { sql: `INSERT INTO invites (id, token_hash, plan_id, email, role, created_by, created_at, expires_at) VALUES ('i1', 'h', 'p1', 's@x.com', 'editor', 'u1', 1, 2)` },
    ]);
    expect(await migrate(db, 0)).toContain(7);
    expect(await db.all(`SELECT plan_id, user_id, role, added_at FROM plan_members`)).toEqual([{ plan_id: "p1", user_id: "u2", role: "viewer", added_at: 5 }]);
    expect((await db.first<{ role: string }>(`SELECT role FROM invites WHERE id = 'i1'`))?.role).toBe("editor");
    await db.run(`UPDATE plan_members SET role = 'commenter'`);
    await expect(db.run(`UPDATE plan_members SET role = 'owner'`)).rejects.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
