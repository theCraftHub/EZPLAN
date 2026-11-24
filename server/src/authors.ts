/**
 * Who wrote a message in a conversation between our team and customers (support requests, safety
 * cases). Our team is shown as the brand, never mixed up with customers; customers are shown with
 * their name, email domain, role and company. Saved with each message when it's posted, so a later
 * role or name change doesn't rewrite history. Owner, Nov 24.
 */
import type { Db } from "./ports";

export type Who =
  | { kind: "team"; team: string; person: string | null }
  | { kind: "customer"; name: string; domain: string; role: "Manager" | "Employee" | "Guest"; company: string | null };

export const teamWho = (team: string, person: string | null): Who => ({ kind: "team", team, person });

/** A customer as seen in one company: their role there, or Guest when they're only on a plan. */
export async function customerWho(db: Db, userId: string, workspaceId: string | null): Promise<Who> {
  const u = await db.first<{ name: string; email: string }>(`SELECT name, email FROM users WHERE id = ?`, [userId]);
  const ws = workspaceId ? await db.first<{ name: string }>(`SELECT name FROM workspaces WHERE id = ?`, [workspaceId]) : null;
  const m = workspaceId ? await db.first<{ role: string }>(`SELECT role FROM members WHERE workspace_id = ? AND user_id = ?`, [workspaceId, userId]) : null;
  return {
    kind: "customer",
    name: u?.name ?? "Someone",
    domain: (u?.email.split("@")[1] ?? "").toLowerCase(),
    role: !m ? "Guest" : m.role === "manager" ? "Manager" : "Employee",
    company: ws?.name ?? null,
  };
}

/** Reads a saved author; hides our staff member's own name from customers when asked to. */
export function readWho(saved: string | null, fallback: Who, showPerson: boolean): Who {
  let w: Who = fallback;
  if (saved) {
    try {
      w = JSON.parse(saved) as Who;
    } catch {
      /* older rows keep the fallback */
    }
  }
  return w.kind === "team" && !showPerson ? { ...w, person: null } : w;
}

/** One line for emails and notifications: "Alex Rivera (Manager, Northfield Builders, northfield.example)". */
export function whoLine(w: Who): string {
  if (w.kind === "team") return `${w.team} (official)`;
  return `${w.name} (${[w.role, w.company, w.domain].filter(Boolean).join(", ")})`;
}
