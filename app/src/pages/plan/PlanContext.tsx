/** What every part of an open plan needs to know about comments, without threading props. */
import { createContext, useContext } from "react";
import type { PersonAvailability, WorkWeek } from "@rakuplan/shared";

export interface PlanCtx {
  planId: string;
  canComment: boolean;
  /** Live comment counts per task. */
  counts: Record<string, number>;
  /** Bumped whenever any task's comments change (open threads reload). */
  tick: number;
  /** The signed-in person's name, and whether they manage the plan (managers may approve any task). */
  me?: string;
  manager?: boolean;
  /** Hourly rates and the work week, for budgets and time (step N4). */
  people?: Record<string, PersonAvailability>;
  workWeek?: WorkWeek;
}

export const PlanContext = createContext<PlanCtx>({ planId: "", canComment: false, counts: {}, tick: 0 });
export const usePlanCtx = () => useContext(PlanContext);
