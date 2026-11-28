import {
  Activity,
  AlertTriangle,
  CalendarRange,
  CheckSquare,
  Columns3,
  LayoutDashboard,
  Table2,
  Users,
  type LucideIcon,
} from "lucide-react";

export type PlanView = "" | "checklist" | "board" | "timeline" | "grid" | "team" | "risks" | "activity";

export const PLAN_VIEWS: { view: PlanView; label: string; hint: string; Icon: LucideIcon }[] = [
  { view: "", label: "Overview", hint: "Status at a glance", Icon: LayoutDashboard },
  { view: "checklist", label: "Checklist", hint: "Tasks by phase", Icon: CheckSquare },
  { view: "board", label: "Board", hint: "Cards by status", Icon: Columns3 },
  { view: "timeline", label: "Timeline", hint: "Dates on a chart", Icon: CalendarRange },
  { view: "grid", label: "Grid", hint: "Edit tasks in a table", Icon: Table2 },
  { view: "team", label: "Team", hint: "Who does what, when", Icon: Users },
  { view: "risks", label: "Risks", hint: "Risks and issues", Icon: AlertTriangle },
  { view: "activity", label: "Activity", hint: "What changed", Icon: Activity },
];

export const OTHER_PAGES: Record<string, string> = {
  update: "Update with my AI",
  report: "Status report",
  history: "History and Trash",
  share: "Share",
  print: "Print summary",
};

export function viewName(view: string): string {
  return PLAN_VIEWS.find((v) => v.view === view)?.label ?? OTHER_PAGES[view] ?? "Overview";
}
