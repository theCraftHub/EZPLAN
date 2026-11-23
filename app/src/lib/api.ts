/** Calls to our own server. Every change is JSON, which the server requires (blocks cross-site forms). */
import type { Plan, PlanCheckResult, WorkWeek } from "@ezplan/shared";

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
  check: PlanCheckResult;
}

export const api = {
  me: () => call<Me>("/api/me"),
  providers: () => call<{ providers: { id: string; label: string }[] }>("/auth/providers"),
  plans: () => call<{ plans: PlanSummary[] }>("/api/plans"),
  plan: (id: string) => call<PlanDetail>(`/api/plans/${encodeURIComponent(id)}`),
  createPlan: (text: string, fileName?: string) => call<{ id: string; notices: string[] }>("/api/plans", { method: "POST", body: JSON.stringify({ text, ...(fileName ? { fileName } : {}) }) }),
  logout: () => call<{ ok: true }>("/auth/logout", { method: "POST", body: "{}" }),
};
