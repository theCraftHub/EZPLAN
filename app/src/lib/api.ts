/** Calls to our own server. Every change is JSON, which the server requires (blocks cross-site forms). */
import type { PersonAvailability, Plan, PlanCheckResult, WorkWeek } from "@ezplan/shared";

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
  summary: { percent: number; doneCount: number; countedTasks: number; overdueCount: number; finish: string; health: string; nextMilestone: { title: string; date: string } | null } | null;
}

export interface PlanDetail {
  id: string;
  version: number;
  role: "manager" | "editor" | "viewer";
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

export const api = {
  me: () => call<Me>("/api/me"),
  providers: () => call<{ providers: { id: string; label: string }[] }>("/auth/providers"),
  plans: () => call<{ plans: PlanSummary[] }>("/api/plans"),
  plan: (id: string) => call<PlanDetail>(`/api/plans/${encodeURIComponent(id)}`),
  preview: (text: string, people: People = {}, fileName?: string) => call<ImportPreview>("/api/plans/preview", { method: "POST", body: JSON.stringify({ text, people, ...(fileName ? { fileName } : {}) }) }),
  createPlan: (text: string, people: People = {}, fileName?: string) => call<{ id: string; notices: string[] }>("/api/plans", { method: "POST", body: JSON.stringify({ text, people, ...(fileName ? { fileName } : {}) }) }),
  setPerson: (planId: string, name: string, a: PersonAvailability) => call<{ name: string }>(`/api/plans/${encodeURIComponent(planId)}/people/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(a) }),
  logout: () => call<{ ok: true }>("/auth/logout", { method: "POST", body: "{}" }),
};
