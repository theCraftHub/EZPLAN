/**
 * The connectors ("ports") the server talks to. The same server code runs on our cloud
 * (Cloudflare adapters in worker/) and self-hosted (Node adapters in selfhost/). Plan section 7b.
 */
import type { Actor, Applied, OpEnvelope, ServerMessage, WorkWeek } from "@ezplan/shared";

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

export type ApplyResult = { status: "applied"; applied: Applied; version: number } | { status: "duplicate"; version: number } | { status: "missing" };

/** Live editing: one room per plan; a room applies edits in order and saves the plan. */
export interface RoomHost {
  /** An edit sent through the HTTP API (also broadcast to the plan's live connections). */
  apply(planId: string, envelope: OpEnvelope, actor: Actor): Promise<ApplyResult>;
  /**
   * Opens a live connection (WebSocket) for a signed-in person already checked for access.
   * Returns the upgrade response; hosts that upgrade elsewhere return a ticket response.
   */
  connect(request: Request, planId: string, actor: Actor, role: "manager" | "editor" | "viewer"): Promise<Response>;
  /** Sends a message to everyone connected to the plan. */
  notify(planId: string, message: ServerMessage): Promise<void>;
  /** Ends one person's live connections to the plan (their access changed). */
  kick(planId: string, userId: string): Promise<void>;
}

export interface Clock {
  /** Today's date (YYYY-MM-DD, UTC). */
  today(): string;
  /** Milliseconds since 1970. */
  now(): number;
}

/**
 * A sign-in provider that speaks OpenID Connect: Cloudflare Access (private build), Microsoft,
 * Google, or a company's own (Okta, JumpCloud, Keycloak...) when self-hosted. Endpoints come from
 * the issuer's /.well-known/openid-configuration.
 */
export interface OidcProvider {
  /** Short id used in URLs, e.g. "microsoft". */
  id: string;
  /** Button label, e.g. "Microsoft". */
  label: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  /**
   * Whether this provider's email addresses can be trusted without an email_verified claim.
   * Microsoft work accounts don't send that claim; most others do. Default false.
   */
  trustEmail?: boolean;
}

export interface ServerConfig {
  /** Work week for new workspaces (a workspace setting afterwards). */
  defaultWorkWeek: WorkWeek;
  /** The site's public address, e.g. "https://plans.example.com" (used for sign-in redirects). */
  publicUrl: string;
  providers: OidcProvider[];
  /** If set, only these email addresses may sign in (the private build: the owner only). */
  allowedEmails?: string[];
  /** Mark cookies Secure (always in production; only plain-http local testing turns it off). */
  secureCookies: boolean;
}

/** Outbound HTTP, so tests can stand in for sign-in providers. */
export type HttpFetch = (request: Request) => Promise<Response>;

export interface Ports {
  db: Db;
  blobs: Blobs;
  rooms: RoomHost;
  clock: Clock;
  config: ServerConfig;
  http: HttpFetch;
  /** TESTS ONLY: also accept the x-test-user header (see auth.ts). Never true in production. */
  testAuth?: boolean;
}

export const systemClock: Clock = {
  today: () => new Date().toISOString().slice(0, 10),
  now: () => Date.now(),
};
