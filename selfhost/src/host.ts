/**
 * Builds the self-hosted server: the shared API (server/) on the Node connectors.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createApp, FakeEngine, systemClock, type AiEngine, type Clock, type HttpFetch, type ServerConfig } from "@ezplan/server";
import { FolderBlobs, MemoryRoomHost, NodeSqliteDb } from "./adapters";
import { withStatic } from "./static";

export interface SelfHostOptions {
  /** Folder for the database file and stored files (a Docker volume in production). */
  dataDir: string;
  config: ServerConfig;
  /** TESTS ONLY: also trust the x-test-user header. Never set in production. */
  testAuth?: boolean;
  clock?: Clock;
  /** Outbound HTTP (tests stand in for sign-in providers). */
  http?: HttpFetch;
  /** The built website (app/dist) to serve next to the API. */
  staticDir?: string;
  /** The AI engine (built-in Anthropic engine when a key is set); none means AI features are off. */
  ai?: AiEngine;
  /** TESTS ONLY: a scripted AI engine instead of a real one. */
  testAi?: boolean;
}

export function createSelfHost(opts: SelfHostOptions) {
  mkdirSync(opts.dataDir, { recursive: true });
  const db = new NodeSqliteDb(join(opts.dataDir, "data.sqlite"));
  const clock = opts.clock ?? systemClock;
  const rooms = new MemoryRoomHost(db, clock);
  const app = createApp({
    db,
    blobs: new FolderBlobs(join(opts.dataDir, "files")),
    rooms,
    clock,
    config: opts.config,
    http: opts.http ?? ((req) => fetch(req)),
    ...(opts.testAuth ? { testAuth: true } : {}),
    ...(opts.testAi ? { ai: new FakeEngine() } : opts.ai ? { ai: opts.ai } : {}),
  });
  return { app: withStatic(app, opts.staticDir), rooms, close: () => db.close() };
}
