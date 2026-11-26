/**
 * Validates live edits before they reach a room (server) or are sent (app). Edits come from
 * clients, so nothing in them is trusted: shapes, field values and sizes are all checked.
 */
import { z } from "zod";
import { Dependency, Estimate, IsoDate, Priority, Task, TaskStatus } from "./schema";
import type { Op } from "./ops";

const Id = z.string().min(1).max(64);
const Text = (max: number) => z.string().max(max);

/** The value allowed for each editable field; `null` clears an optional field. */
const FIELD_VALUES = {
  title: Text(500).min(1),
  owner: Text(120).nullable(),
  dept: Text(60).nullable(),
  due: IsoDate.nullable(),
  notes: z.array(Text(4000)).max(200),
  priority: Priority.nullable(),
  estimate: Estimate.nullable(),
  depends: z.array(Dependency).max(200),
  tags: z.array(Text(60)).max(50),
} as const;

const setField = <F extends keyof typeof FIELD_VALUES>(field: F) =>
  z.object({ kind: z.literal("setField"), taskId: Id, field: z.literal(field), value: FIELD_VALUES[field] });
const SetField = z.union([
  setField("title"),
  setField("owner"),
  setField("dept"),
  setField("due"),
  setField("notes"),
  setField("priority"),
  setField("estimate"),
  setField("depends"),
  setField("tags"),
]);

const NewTask = Task.extend({ id: Id, title: Text(500).min(1), done: z.undefined().optional(), skipped: z.undefined().optional() });

export const OpSchema = z.union([
  z.object({ kind: z.literal("setStatus"), taskId: Id, status: TaskStatus }),
  SetField,
  // A new task starts unfinished; "Done by" is only ever set by the server.
  z.object({ kind: z.literal("addTask"), phaseId: Id, task: NewTask, afterId: Id.optional(), first: z.literal(true).optional() }),
  z.object({ kind: z.literal("moveTask"), taskId: Id, phaseId: Id, afterId: Id.optional(), first: z.literal(true).optional() }),
  z.object({ kind: z.literal("deleteTask"), taskId: Id }),
  z.object({ kind: z.literal("restoreTask"), taskId: Id }),
  z.object({ kind: z.literal("addPhase"), phase: z.object({ id: Id, title: Text(300).min(1), description: Text(2000).optional() }).strict(), afterId: Id.optional() }),
  z.object({ kind: z.literal("setPhaseField"), phaseId: Id, field: z.enum(["title", "description"]), value: Text(2000).nullable() }),
  z.object({ kind: z.literal("setPlanField"), field: z.enum(["title", "goal", "doneWhen"]), value: Text(2000).nullable() }),
  // "replacePlan" is deliberately missing: only the server makes it (Version history restore).
]);

export const OpEnvelopeSchema = z.object({ opId: Id, clientId: Id, op: OpSchema });

/** Returns the edit with cleared fields as `undefined`, or null when it isn't valid. */
export function parseOp(input: unknown): Op | null {
  const r = OpSchema.safeParse(input);
  if (!r.success) return null;
  const op = r.data as Op & { value?: unknown };
  if ((op.kind === "setField" || op.kind === "setPhaseField" || op.kind === "setPlanField") && op.value === null) return { ...op, value: undefined } as Op;
  return op as Op;
}
