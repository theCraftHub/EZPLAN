/**
 * Inviting people to a plan. An invite is a single-use link for one email address and one role;
 * only a hash of its secret is stored, and it lasts 7 days.
 */
export const INVITE_DAYS = 7;
import { RANK } from "./roles";

export type PlanRole = "editor" | "commenter" | "viewer";
export const PLAN_ROLES: readonly PlanRole[] = ["editor", "commenter", "viewer"];

export interface InviteRow {
  id: string;
  plan_id: string;
  email: string;
  role: PlanRole;
  person_name: string | null;
  created_by: string;
  expires_at: number;
  accepted_by: string | null;
  revoked_at: number | null;
}

/** Why this person can't use this invite now, or null when they can. */
export function inviteProblem(invite: Pick<InviteRow, "email" | "expires_at" | "accepted_by" | "revoked_at">, now: number, signedInEmail: string, signedInUserId: string): string | null {
  if (invite.revoked_at) return "This invite was cancelled. Ask for a new one.";
  if (invite.accepted_by && invite.accepted_by !== signedInUserId) return "This invite has already been used. Ask for a new one.";
  if (!invite.accepted_by && invite.expires_at <= now) return "This invite has expired. Ask for a new one.";
  if (invite.email.toLowerCase() !== signedInEmail.toLowerCase()) return `This invite is for ${maskEmail(invite.email)}. Sign in with that address to accept it.`;
  return null;
}

/** "sam@example.com" → "s••@example.com": enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(4, user.length - 1)))}@${domain}`;
}

export const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;

/** The stronger of two roles (someone can be a workspace member and a plan member). */
export function strongest<R extends keyof typeof RANK>(a: R | null | undefined, b: R | null | undefined): R | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}
