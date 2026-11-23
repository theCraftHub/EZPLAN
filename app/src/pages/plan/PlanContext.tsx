/** What every part of an open plan needs to know about comments, without threading props. */
import { createContext, useContext } from "react";

export interface PlanCtx {
  planId: string;
  canComment: boolean;
  /** Live comment counts per task. */
  counts: Record<string, number>;
  /** Bumped whenever any task's comments change (open threads reload). */
  tick: number;
}

export const PlanContext = createContext<PlanCtx>({ planId: "", canComment: false, counts: {}, tick: 0 });
export const usePlanCtx = () => useContext(PlanContext);
