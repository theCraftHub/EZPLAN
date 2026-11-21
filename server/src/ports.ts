/**
 * The connectors ("ports") the server talks to. The same server code runs on our cloud
 * (Cloudflare adapters in worker/) and self-hosted (Node adapters in selfhost/). Plan section 7b.
 */
import type { Actor, Applied, OpEnvelope, WorkWeek } from "@ezplan/shared";

export type SqlValue = string | number | null;

export interface SqlStatement {
  sql: string;
  params?: SqlValue[];
}

/** SQLite dialect on both hosts (Cloudflare D1 is SQLite). */
export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | null>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** All statements in one transaction: all apply or none do. */
  batch(statements: SqlStatement[]): Promise<void>;
}

/** Files: exports and backups (R2 in the cloud; S3-compatible storage or a folder self-hosted). */
export interface Blobs {
  put(key: string, data: Uint8Array | string, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

/** Who is making the request. Real sign-in plugs in here; nothing else changes. */
export interface Auth {
  getUser(request: Request): Promise<User | null>;
}

export type ApplyResult = { status: "applied"; applied: Applied; version: number } | { status: "duplicate"; version: number } | { status: "missing" };

/** Live editing: one room per plan; a room applies edits in order and saves the plan. */
export interface RoomHost {
  apply(planId: string, envelope: OpEnvelope, actor: Actor): Promise<ApplyResult>;
}

export interface Clock {
  /** Today's date (YYYY-MM-DD, UTC). */
  today(): string;
  /** Milliseconds since 1970. */
  now(): number;
}

export interface ServerConfig {
  /** Work week for new workspaces (a workspace setting afterwards). */
  defaultWorkWeek: WorkWeek;
}

export interface Ports {
  db: Db;
  blobs: Blobs;
  rooms: RoomHost;
  auth: Auth;
  clock: Clock;
  config: ServerConfig;
}

export const systemClock: Clock = {
  today: () => new Date().toISOString().slice(0, 10),
  now: () => Date.now(),
};
