/**
 * Messages on a plan's live connection (WebSocket), shared by the server and the app.
 * Edits are sent as envelopes and confirmed in one order for everyone (see ops.ts).
 */
import type { PersonAvailability } from "./level";
import type { Applied } from "./ops";
import type { Plan } from "./schema";

export type ClientMessage =
  /** First message: the last version this client has (0 or absent = needs the whole plan). */
  | { t: "hello"; since?: number }
  | { t: "edit"; opId: string; clientId: string; op: unknown };

export interface PresencePerson {
  userId: string;
  name: string;
  /** How many open connections (tabs, devices) this person has. */
  connections: number;
}

export type ServerMessage =
  /** Catch-up: the edits missed since `since`... */
  | { t: "welcome"; version: number; missed: Applied[] }
  /** ...or, when too much was missed, the whole plan. */
  | { t: "welcome"; version: number; plan: Plan; restoredForReview: string[] }
  /** An edit everyone applies, in version order. */
  | { t: "applied"; applied: Applied; version: number }
  /** The answer to this client's own edit. */
  | { t: "ack"; opId: string; status: "applied" | "duplicate" | "rejected"; version: number; error?: string }
  | { t: "presence"; people: PresencePerson[] }
  /** Availability changed (hours a week, days off): everyone's dates update without reloading. */
  | { t: "people"; people: Record<string, PersonAvailability> }
  | { t: "error"; error: string };

/** Largest message a client may send (bytes). */
export const LIVE_MAX_MESSAGE = 256 * 1024;
