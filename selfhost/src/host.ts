/**
 * Builds the self-hosted server: the shared API (server/) on the Node connectors.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { authFor, createApp, systemClock, type Clock } from "@ezplan/server";
import { DEFAULT_WORK_WEEK, type WorkWeek } from "@ezplan/shared";
import { FolderBlobs, MemoryRoomHost, NodeSqliteDb } from "./adapters";

export interface SelfHostOptions {
  /** Folder for the database file and stored files (a Docker volume in production). */
  dataDir: string;
  /** "1" only in tests: trusts the x-test-user header. Never set in production. */
  testAuth?: string;
  clock?: Clock;
  defaultWorkWeek?: WorkWeek;
}

export function createSelfHost(opts: SelfHostOptions) {
  mkdirSync(opts.dataDir, { recursive: true });
  const db = new NodeSqliteDb(join(opts.dataDir, "data.sqlite"));
  const clock = opts.clock ?? systemClock;
  const app = createApp({
    db,
    blobs: new FolderBlobs(join(opts.dataDir, "files")),
    rooms: new MemoryRoomHost(db, clock),
    auth: authFor(opts.testAuth),
    clock,
    config: { defaultWorkWeek: opts.defaultWorkWeek ?? DEFAULT_WORK_WEEK },
  });
  return { app, close: () => db.close() };
}
