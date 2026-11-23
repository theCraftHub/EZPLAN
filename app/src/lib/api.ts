/** Calls to our own server. Every change is JSON, which the server requires (blocks cross-site forms). */
import type { AiReview, Op, PersonAvailability, Plan, PlanCheckResult, ReportText, StatusFacts, SuggestionKind, WorkWeek } from "@ezplan/shared";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string })?.error ?? "Something went wrong. Try again.", body);
  return body as T;
}

export interface Me {
  user: { id: string; name: string; email: string };
  workspaces: { id: string; name: string; role: "manager" | "editor" | "viewer"; work_week: WorkWeek }[];
}

export interface PlanSummary {
  id: string;
  title: string;
  state: string;
  workspace_id: string;
  updated_at: number;
  shared?: boolean;
  summary: { percent: number; doneCount: number; countedTasks: number; overdueCount: number; finish: string; health: string; nextMilestone: { title: string; date: string } | null } | null;
}

export interface PlanDetail {
  id: string;
  version: number;
  role: "manager" | "editor" | "viewer";
  state: string;
  plan: Plan;
  people: People;
  workWeek: WorkWeek;
  today: string;
  check: PlanCheckResult;
}

export interface ImportPreview {
  plan: Plan;
  people: string[];
  workWeek: WorkWeek;
  finish: string;
  check: PlanCheckResult;
  notices: string[];
  moderation: "allow" | "review" | "block";
  suggestedPeople: string[];
}

export type People = Record<string, PersonAvailability>;

export interface AiUsage {
  checks: { used: number; limit: number };
  reports: { used: number; limit: number };
  poolLeft: { checks: number; reports: number };
  resets: string;
}

export interface AiState {
  enabled: boolean;
  held: boolean;
  review: { result: AiReview; planVersion: number; hidden: number; createdAt: number; by: string; changedSince: boolean } | null;
  suppressions: { id: string; kind: SuggestionKind; text: string; taskIds: string[]; by: string; createdAt: number }[];
  usage: AiUsage;
}

export interface Sharing {
  canShare: boolean;
  members: { userId: string; name: string; email: string; role: "manager" | "editor" | "viewer"; via: "workspace" | "invite" }[];
  invites: { id: string; email: string; role: "editor" | "viewer"; personName: string | null; expiresAt: number }[];
}

export const api = {
  me: () => call<Me>("/api/me"),
  providers: () => call<{ providers: { id: string; label: string }[] }>("/auth/providers"),
  plans: () => call<{ plans: PlanSummary[] }>("/api/plans"),
  plan: (id: string) => call<PlanDetail>(`/api/plans/${encodeURIComponent(id)}`),
  preview: (text: string, people: People = {}, fileName?: string) => call<ImportPreview>("/api/plans/preview", { method: "POST", body: JSON.stringify({ text, people, ...(fileName ? { fileName } : {}) }) }),
  createPlan: (text: string, people: People = {}, fileName?: string) => call<{ id: string; notices: string[] }>("/api/plans", { method: "POST", body: JSON.stringify({ text, people, ...(fileName ? { fileName } : {}) }) }),
  setPerson: (planId: string, name: string, a: PersonAvailability) => call<{ name: string }>(`/api/plans/${encodeURIComponent(planId)}/people/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(a) }),
  workWeek: (workspaceId: string, w: WorkWeek, dryRun: boolean) => call<{ workWeek: WorkWeek; saved: boolean; impact: { planId: string; title: string; before: string; after: string }[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/work-week`, { method: "PUT", body: JSON.stringify({ ...w, dryRun }) }),
  update: (planId: string, ops: Op[]) => call<{ version: number; applied: number }>(`/api/plans/${encodeURIComponent(planId)}/update`, { method: "POST", body: JSON.stringify({ ops }) }),
  versions: (planId: string) => call<{ versions: { version: number; reason: string; createdAt: number; by: string; title: string; tasks: number; done: number; plan: Plan }[] }>(`/api/plans/${encodeURIComponent(planId)}/versions`),
  restoreVersion: (planId: string, v: number) => call<{ version: number }>(`/api/plans/${encodeURIComponent(planId)}/versions/${v}/restore`, { method: "POST", body: "{}" }),
  trash: (planId: string) => call<{ items: { taskId: string; title: string; deletedAt: string; by: string }[] }>(`/api/plans/${encodeURIComponent(planId)}/trash`),
  sharing: (planId: string) => call<Sharing>(`/api/plans/${encodeURIComponent(planId)}/sharing`),
  invite: (planId: string, email: string, role: "editor" | "viewer", personName?: string) => call<{ id: string; link: string; expiresAt: number }>(`/api/plans/${encodeURIComponent(planId)}/invites`, { method: "POST", body: JSON.stringify({ email, role, ...(personName ? { personName } : {}) }) }),
  cancelInvite: (planId: string, inviteId: string) => call<{ ok: true }>(`/api/plans/${encodeURIComponent(planId)}/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" }),
  setRole: (planId: string, userId: string, role: "editor" | "viewer") => call<{ ok: true }>(`/api/plans/${encodeURIComponent(planId)}/members/${encodeURIComponent(userId)}`, { method: "PUT", body: JSON.stringify({ role }) }),
  removeMember: (planId: string, userId: string) => call<{ ok: true }>(`/api/plans/${encodeURIComponent(planId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  inviteInfo: (token: string) => call<{ planTitle: string | null; inviter: string; role: "editor" | "viewer"; email: string; problem: string | null; accepted: boolean; planId: string | null }>(`/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) => call<{ planId: string }>(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST", body: "{}" }),
  ai: (planId: string) => call<AiState>(`/api/plans/${encodeURIComponent(planId)}/ai`),
  aiCheck: (planId: string) => call<{ review: AiReview; hidden: number; usage: AiUsage }>(`/api/plans/${encodeURIComponent(planId)}/ai/check`, { method: "POST", body: "{}" }),
  suppress: (planId: string, kind: SuggestionKind, text: string, taskIds: string[]) => call<{ id: string }>(`/api/plans/${encodeURIComponent(planId)}/ai/suppressions`, { method: "POST", body: JSON.stringify({ kind, text, taskIds }) }),
  unsuppress: (planId: string, id: string) => call<{ ok: true }>(`/api/plans/${encodeURIComponent(planId)}/ai/suppressions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  report: (planId: string, ai: boolean, since?: string) => call<{ facts: StatusFacts; text: ReportText; source: "ai" | "template"; note?: string }>(`/api/plans/${encodeURIComponent(planId)}/report`, { method: "POST", body: JSON.stringify({ ai, ...(since ? { since } : {}) }) }),
  myAi: () => call<{ enabled: boolean; workspaces: ({ workspaceId: string; name: string } & AiUsage)[] }>("/api/me/ai"),
  logout: () => call<{ ok: true }>("/auth/logout", { method: "POST", body: "{}" }),
};
