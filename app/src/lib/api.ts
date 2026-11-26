/** Calls to our own server. Every change is JSON, which the server requires (blocks cross-site forms). */
import type { AiReview, MasterPart, Op, PersonAvailability, Plan, PlanCheckResult, ReportText, StatusFacts, SuggestionKind, WorkWeek } from "@rakuplan/shared";

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
  /** On the owner's team (PLATFORM_ADMINS): sees the safety review queue. */
  platformAdmin?: boolean;
  safetyOpen?: number;
  unread?: number;
  supportOpen?: number;
}

export interface SupportContact { team: string; email: string | null; phone: string | null; url: string | null; hours: string | null; note: string | null; route: "direct" | "it_only" }
export interface HelpInfo { staff: boolean; workspaces: { workspaceId: string; name: string; canManage: boolean; contact: SupportContact | null }[] }
export type TicketTopic = "problem" | "question" | "billing" | "account" | "safety";
export interface TicketRow { id: string; topic: TicketTopic; subject: string; status: "open" | "waiting" | "solved"; via: "direct" | "it"; from: string | null; updatedAt: number }
/** Who wrote a message to or from our team: our team (the brand) or a customer. */
export type Who = { kind: "team"; team: string; person: string | null } | { kind: "customer"; name: string; domain: string; role: "Manager" | "Employee" | "Guest"; company: string | null };
export interface TicketThread {
  as: "author" | "staff" | "it";
  ticket: { id: string; topic: TicketTopic; subject: string; status: "open" | "waiting" | "solved"; via: "direct" | "it"; from: string; createdAt: number; context: { page: string; browser: string; version: string; errors: string[] } | null };
  messages: { id: string; author: string; who: Who; fromStaff: boolean; body: string; createdAt: number }[];
  grants: { id: string; planId: string; planTitle: string | null; expiresAt: number; active: boolean }[];
  views: { by: string; at: number }[];
}

export interface SafetyCaseRow { id: string; workspace: string; status: "open" | "closed"; lastFrom: string | null; updatedAt: number }
export interface SafetyCase {
  as: "staff" | "manager";
  case: { id: string; workspace: string; status: "open" | "closed"; createdAt: number; reportId: string | null };
  messages: { id: string; author: string; who: Who; fromStaff: boolean; via: "app" | "email" | "system"; body: string; createdAt: number; emails?: { to: string; status: "off" | "sent" | "failed" }[] }[];
  emailOff: boolean;
}

export interface Notifications {
  unread: number;
  due: { planId: string; planTitle: string; taskId: string; title: string; due: string; overdue: boolean }[];
  items: { id: string; planId: string | null; kind: string; text: string; link: string; createdAt: number; read: boolean }[];
}

export interface CreditRequest { id: string; userId: string; name: string; checks: number; reports: number; note: string | null; status: "pending" | "approved" | "declined"; decidedBy: string | null; createdAt: number; decidedAt: number | null }
export interface Counts { checks: number; reports: number }
export interface AiAdmin {
  pool: { total: Counts; used: Counts; left: Counts; max: number };
  defaultAllowance: Counts;
  people: ({ userId: string; name: string; email: string; department: string | null; override: boolean } & AiUsage)[];
}
export interface SpendTotals { cost: number; inputTokens: number; outputTokens: number; checks: number; reports: number; screenings: number; declined: number; runs: number }
export type SpendRow = SpendTotals & { key: string; name: string; previous: number; department?: string; projects?: number; people?: number; active?: number };
export interface Spending {
  from: string;
  to: string;
  totals: SpendTotals;
  previousTotals: SpendTotals;
  daily: number[];
  previousDaily: number[];
  pool: { total: Counts; used: Counts };
  people: SpendRow[];
  projects: SpendRow[];
  departments: SpendRow[];
  idle: { people: string[]; projects: string[]; departments: string[] };
}
export type SpendType = "person" | "project" | "department";
export type SpendPeriod = "month" | "last-month" | "90d";
export interface SpendDetail {
  type: SpendType;
  from: string;
  to: string;
  item: SpendRow;
  byFeature: (SpendTotals & { key: string })[];
  byModel: (SpendTotals & { key: string })[];
  daily: number[];
  related: { type: SpendType; key: string; name: string }[];
}
export interface SafetyItem { id: string; planId: string | null; planTitle: string | null; feature: string; category: string | null; excerpt: string; status: "held" | "released" | "kept" | "suspended"; note: string | null; person: string; email: string; decidedBy: string | null; createdAt: number; decidedAt: number | null }

export type PlanRole = "editor" | "commenter" | "viewer";
export type Role = "manager" | PlanRole;
export const canEditRole = (r: Role | undefined) => r === "editor" || r === "manager";
export const canCommentRole = (r: Role | undefined) => r === "commenter" || canEditRole(r);
export const ROLE_NAME: Record<Role, string> = { manager: "Owner", editor: "Editor", commenter: "Commenter", viewer: "Viewer" };

export interface TaskComments {
  canComment: boolean;
  people: string[];
  comments: { id: string; author: string; mine: boolean; body: string | null; deleted: boolean; createdAt: number; editedAt: number | null; canEdit: boolean; canDelete: boolean }[];
}
export interface ActivityItem { id: string; actorId: string; actor: string; kind: string; taskId: string | null; summary: string; at: number }

export interface PlanSummary {
  id: string;
  title: string;
  state: string;
  workspace_id: string;
  updated_at: number;
  shared?: boolean;
  summary: { percent: number; doneCount: number; countedTasks: number; overdueCount: number; finish: string; health: string; nextMilestone: { title: string; date: string } | null; baselineVarianceDays: number | null } | null;
  statusUpdate?: UpdateState;
  /** A master plan: how many plans are inside. */
  master?: { plans: number };
  /** The master plan this plan sits in. */
  masterId?: string;
}

export type RaidKind = "risk" | "assumption" | "issue" | "decision";
export interface RaidItem { id: string; kind: RaidKind; title: string; detail: string; owner: string | null; likelihood: number | null; impact: number | null; status: "open" | "closed"; due: string | null; taskIds: string[]; createdBy: string; createdAt: number; updatedAt: number }
type RaidInput = Partial<Pick<RaidItem, "kind" | "title" | "detail" | "owner" | "likelihood" | "impact" | "status" | "due" | "taskIds">>;
export type Rag = "green" | "amber" | "red";
/** The latest status update and whether one is due (more than 7 days). */
export interface UpdateState { last: { rag: Rag; headline: string; at: number } | null; overdue: boolean }
export interface StatusUpdate { id: string; rag: Rag; headline: string; sections: { title: string; text: string }[]; source: "ai" | "template"; author: string; createdAt: number }

export interface PlanDetail {
  id: string;
  version: number;
  role: Role;
  state: string;
  plan: Plan;
  people: People;
  workWeek: WorkWeek;
  today: string;
  check: PlanCheckResult;
  statusUpdate: UpdateState;
  raidOpen: { risks: number; issues: number };
  /** Set when the plan is a master plan or sits inside one. */
  master: MasterContext | null;
}

export interface MasterContext {
  id: string;
  isMaster: boolean;
  key: string;
  title: string;
  plans: number;
  canOpenMaster: boolean;
  lead?: string | null;
  needs?: string[];
  /** The master as this plan's people may see it (others in outline), for live dates. */
  view: { parts: MasterPart[]; people: Record<string, PersonAvailability> } | null;
}

export interface MasterData {
  id: string;
  title: string;
  canEdit: boolean;
  today: string;
  workWeek: WorkWeek;
  people: Record<string, PersonAvailability>;
  parts: { key: string; planId: string; title: string; plan: Plan; lead: string | null; needs: string[] }[];
  departments: { name: string; contact: string | null; role: string | null }[];
}
export interface MasterThread { scope: string; title: string; count: number; last: { author: string; body: string; at: number } | null }
export interface MasterMessage { id: string; author: string; body: string; about: string | null; at: number }

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
  workspaceId: string;
  held: boolean;
  review: { result: AiReview; planVersion: number; hidden: number; createdAt: number; by: string; changedSince: boolean } | null;
  suppressions: { id: string; kind: SuggestionKind; text: string; taskIds: string[]; by: string; createdAt: number }[];
  usage: AiUsage;
}

export interface Sharing {
  canShare: boolean;
  members: { userId: string; name: string; email: string; role: Role; via: "workspace" | "invite" }[];
  invites: { id: string; email: string; role: PlanRole; personName: string | null; expiresAt: number }[];
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
  invite: (planId: string, email: string, role: PlanRole, personName?: string) => call<{ id: string; link: string; expiresAt: number }>(`/api/plans/${encodeURIComponent(planId)}/invites`, { method: "POST", body: JSON.stringify({ email, role, ...(personName ? { personName } : {}) }) }),
  cancelInvite: (planId: string, inviteId: string) => call<{ ok: true }>(`/api/plans/${encodeURIComponent(planId)}/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" }),
  setRole: (planId: string, userId: string, role: PlanRole) => call<{ ok: true }>(`/api/plans/${encodeURIComponent(planId)}/members/${encodeURIComponent(userId)}`, { method: "PUT", body: JSON.stringify({ role }) }),
  removeMember: (planId: string, userId: string) => call<{ ok: true }>(`/api/plans/${encodeURIComponent(planId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  notifications: () => call<Notifications>("/api/notifications"),
  unreadCount: () => call<{ unread: number }>("/api/notifications/count"),
  markRead: (ids: string[] | "all") => call<{ ok: true; unread: number }>("/api/notifications/read", { method: "POST", body: JSON.stringify(ids === "all" ? { all: true } : { ids }) }),
  inviteInfo: (token: string, byId = false) => call<{ planTitle: string | null; inviter: string; role: PlanRole; email: string; problem: string | null; accepted: boolean; planId: string | null }>(`/api/invites/${encodeURIComponent(token)}${byId ? "?by=id" : ""}`),
  acceptInvite: (token: string, byId = false) => call<{ planId: string }>(`/api/invites/${encodeURIComponent(token)}/accept${byId ? "?by=id" : ""}`, { method: "POST", body: "{}" }),
  ai: (planId: string) => call<AiState>(`/api/plans/${encodeURIComponent(planId)}/ai`),
  aiCheck: (planId: string) => call<{ review: AiReview; hidden: number; usage: AiUsage }>(`/api/plans/${encodeURIComponent(planId)}/ai/check`, { method: "POST", body: "{}" }),
  suppress: (planId: string, kind: SuggestionKind, text: string, taskIds: string[]) => call<{ id: string }>(`/api/plans/${encodeURIComponent(planId)}/ai/suppressions`, { method: "POST", body: JSON.stringify({ kind, text, taskIds }) }),
  unsuppress: (planId: string, id: string) => call<{ ok: true }>(`/api/plans/${encodeURIComponent(planId)}/ai/suppressions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getPref: (key: string) => call<{ value: unknown }>(`/api/me/prefs/${encodeURIComponent(key)}`),
  setPref: (key: string, value: unknown) => call<{ ok: true }>(`/api/me/prefs/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value }) }),
  raid: (planId: string) => call<{ canEdit: boolean; items: RaidItem[]; open: { risks: number; issues: number } }>(`/api/plans/${encodeURIComponent(planId)}/raid`),
  addRaid: (planId: string, v: RaidInput) => call<{ item: RaidItem }>(`/api/plans/${encodeURIComponent(planId)}/raid`, { method: "POST", body: JSON.stringify(v) }),
  updateRaid: (planId: string, itemId: string, v: RaidInput) => call<{ item: RaidItem }>(`/api/plans/${encodeURIComponent(planId)}/raid/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify(v) }),
  deleteRaid: (planId: string, itemId: string) => call<{ ok: true }>(`/api/plans/${encodeURIComponent(planId)}/raid/${encodeURIComponent(itemId)}`, { method: "DELETE" }),
  master: (id: string) => call<MasterData>(`/api/masters/${encodeURIComponent(id)}`),
  createMaster: (title: string, planIds: string[], start?: string) => call<{ id: string; keys: Record<string, string> }>("/api/masters", { method: "POST", body: JSON.stringify({ title, planIds, ...(start ? { start } : {}) }) }),
  addToMaster: (id: string, planId: string) => call<{ key: string }>(`/api/masters/${encodeURIComponent(id)}/plans`, { method: "POST", body: JSON.stringify({ planId }) }),
  removeFromMaster: (id: string, planId: string) => call<{ ok: true }>(`/api/masters/${encodeURIComponent(id)}/plans/${encodeURIComponent(planId)}`, { method: "DELETE" }),
  setPlanDepartments: (id: string, planId: string, lead: string | null, needs: string[]) => call<{ ok: true }>(`/api/masters/${encodeURIComponent(id)}/plans/${encodeURIComponent(planId)}/departments`, { method: "PUT", body: JSON.stringify({ lead, needs }) }),
  setDepartmentContact: (id: string, name: string, contact: string, role: string) => call<{ ok: true }>(`/api/masters/${encodeURIComponent(id)}/departments/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify({ contact, role }) }),
  masterActivity: (id: string) => call<{ items: { id: string; planId: string; key: string; plan: string; actor: string; kind: string; taskId: string | null; summary: string; at: number }[] }>(`/api/masters/${encodeURIComponent(id)}/activity`),
  masterThreads: (id: string) => call<{ threads: MasterThread[] }>(`/api/masters/${encodeURIComponent(id)}/threads`),
  masterThread: (id: string, scope: string) => call<{ messages: MasterMessage[]; people: { id: string; name: string }[] }>(`/api/masters/${encodeURIComponent(id)}/threads/${encodeURIComponent(scope)}`),
  postMasterThread: (id: string, scope: string, body: string, about?: string) => call<{ id: string }>(`/api/masters/${encodeURIComponent(id)}/threads/${encodeURIComponent(scope)}`, { method: "POST", body: JSON.stringify({ body, ...(about ? { about } : {}) }) }),
  setBaseline: (planId: string) => call<{ version: number; baselineSet: string; finish: string; savedVersion: number | null }>(`/api/plans/${encodeURIComponent(planId)}/baseline`, { method: "POST", body: "{}" }),
  statusUpdates: (planId: string) => call<{ canPost: boolean; overdue: boolean; dueEveryDays: number; items: StatusUpdate[] }>(`/api/plans/${encodeURIComponent(planId)}/status-updates`),
  postStatusUpdate: (planId: string, u: { rag: Rag; headline: string; sections: { title: string; text: string }[]; source: "ai" | "template" }) => call<{ id: string }>(`/api/plans/${encodeURIComponent(planId)}/status-updates`, { method: "POST", body: JSON.stringify(u) }),
  report: (planId: string, ai: boolean, since?: string) => call<{ facts: StatusFacts; text: ReportText; source: "ai" | "template"; note?: string }>(`/api/plans/${encodeURIComponent(planId)}/report`, { method: "POST", body: JSON.stringify({ ai, ...(since ? { since } : {}) }) }),
  myAi: () => call<{ enabled: boolean; workspaces: ({ workspaceId: string; name: string } & AiUsage)[] }>("/api/me/ai"),
  creditRequests: (ws: string) => call<{ canManage: boolean; approvers: string[]; requests: CreditRequest[] }>(`/api/workspaces/${encodeURIComponent(ws)}/ai/requests`),
  askCredits: (ws: string, checks: number, reports: number, note: string) => call<{ id: string }>(`/api/workspaces/${encodeURIComponent(ws)}/ai/requests`, { method: "POST", body: JSON.stringify({ checks, reports, note }) }),
  decideCredits: (ws: string, id: string, decision: "approve" | "decline", amounts?: Counts) => call<{ ok: true }>(`/api/workspaces/${encodeURIComponent(ws)}/ai/requests/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ decision, ...amounts }) }),
  aiAdmin: (ws: string) => call<AiAdmin>(`/api/workspaces/${encodeURIComponent(ws)}/ai/admin`),
  setAllowance: (ws: string, userId: string, a: Counts) => call<{ ok: true }>(`/api/workspaces/${encodeURIComponent(ws)}/ai/allowances/${encodeURIComponent(userId)}`, { method: "PUT", body: JSON.stringify(a) }),
  topUp: (ws: string, a: Counts, reason: string) => call<{ ok: true }>(`/api/workspaces/${encodeURIComponent(ws)}/ai/topup`, { method: "POST", body: JSON.stringify({ ...a, reason }) }),
  setDepartment: (ws: string, userId: string, department: string) => call<{ ok: true }>(`/api/workspaces/${encodeURIComponent(ws)}/members/${encodeURIComponent(userId)}/department`, { method: "PUT", body: JSON.stringify({ department }) }),
  spending: (ws: string, period: SpendPeriod) => call<Spending>(`/api/workspaces/${encodeURIComponent(ws)}/ai/spending?period=${period}`),
  spendingDetail: (ws: string, type: SpendType, key: string, period: SpendPeriod) => call<SpendDetail>(`/api/workspaces/${encodeURIComponent(ws)}/ai/spending/${type}/${encodeURIComponent(key)}?period=${period}`),
  spendingCsv: (ws: string, view: string, period: SpendPeriod) => `/api/workspaces/${encodeURIComponent(ws)}/ai/spending.csv?view=${view}&period=${period}`,
  safety: () => call<{ open: number; items: SafetyItem[] }>("/api/admin/safety"),
  safetyAction: (id: string, action: "release" | "keep" | "suspend", note: string) => call<{ ok: true; status: string }>(`/api/admin/safety/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ action, note }) }),
  comments: (planId: string, taskId: string) => call<TaskComments>(`/api/plans/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}/comments`),
  addComment: (planId: string, taskId: string, body: string) => call<{ id: string; mentions: string[] }>(`/api/plans/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
  editComment: (planId: string, taskId: string, id: string, body: string) => call<{ ok: true }>(`/api/plans/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ body }) }),
  deleteComment: (planId: string, taskId: string, id: string) => call<{ ok: true }>(`/api/plans/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(id)}`, { method: "DELETE" }),
  commentCounts: (planId: string) => call<{ counts: Record<string, number> }>(`/api/plans/${encodeURIComponent(planId)}/comment-counts`),
  activity: (planId: string, before?: number) => call<{ items: ActivityItem[] }>(`/api/plans/${encodeURIComponent(planId)}/activity${before ? `?before=${before}` : ""}`),
  help: () => call<HelpInfo>("/api/help"),
  setSupportContact: (ws: string, c: Omit<SupportContact, "route"> & { route: SupportContact["route"] } | { clear: true }) => call<{ ok: true }>(`/api/workspaces/${encodeURIComponent(ws)}/support-contact`, { method: "PUT", body: JSON.stringify(c) }),
  newTicket: (t: { topic: TicketTopic; subject: string; body: string; planId?: string; sharePlan?: boolean; context: { page: string; browser: string; version: string; errors: string[] } }) => call<{ id: string; via: "direct" | "it" }>("/api/support/tickets", { method: "POST", body: JSON.stringify(t) }),
  tickets: () => call<{ mine: TicketRow[]; company: TicketRow[] }>("/api/support/tickets"),
  ticket: (id: string) => call<TicketThread>(`/api/support/tickets/${encodeURIComponent(id)}`),
  replyTicket: (id: string, body: string) => call<{ ok: true }>(`/api/support/tickets/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
  ticketStatus: (id: string, status: "open" | "waiting" | "solved") => call<{ ok: true }>(`/api/support/tickets/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  forwardTicket: (id: string) => call<{ ok: true }>(`/api/support/tickets/${encodeURIComponent(id)}/forward`, { method: "POST", body: "{}" }),
  revokeGrant: (id: string) => call<{ ok: true }>(`/api/support/grants/${encodeURIComponent(id)}`, { method: "DELETE" }),
  safetyCases: () => call<{ items: SafetyCaseRow[] }>("/api/safety-cases"),
  safetyCase: (id: string) => call<SafetyCase>(`/api/safety-cases/${encodeURIComponent(id)}`),
  replySafetyCase: (id: string, body: string) => call<{ ok: true }>(`/api/safety-cases/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
  safetyCaseStatus: (id: string, status: "open" | "closed") => call<{ ok: true }>(`/api/safety-cases/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  supportInbox: () => call<{ open: number; items: (TicketRow & { email: string })[] }>("/api/admin/support"),
  supportPlan: (ticketId: string) => call<{ planId: string; title: string; until: number; text: string }>(`/api/admin/support/tickets/${encodeURIComponent(ticketId)}/plan`),
  logout: () => call<{ ok: true }>("/auth/logout", { method: "POST", body: "{}" }),
};
