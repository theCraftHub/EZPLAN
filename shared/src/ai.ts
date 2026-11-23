/**
 * Shapes of AI answers (checked against these schemas before anyone sees them) and the
 * "don't suggest this again" matching. Used by the server and the app.
 */
import { z } from "zod";

export const AiReviewSchema = z.object({
  verdict: z.enum(["ready", "needs_work", "risky"]),
  summary: z.string(),
  goalFit: z.object({ score: z.number(), comment: z.string() }),
  missingSteps: z.array(z.object({ title: z.string(), phaseId: z.string().nullable(), afterTaskId: z.string().nullable(), why: z.string() })),
  risks: z.array(z.object({ title: z.string(), taskIds: z.array(z.string()), mitigation: z.string() })),
  suggestions: z.array(z.object({ taskId: z.string().nullable(), change: z.string(), why: z.string() })),
});
export type AiReview = z.infer<typeof AiReviewSchema>;

export const AiReportTextSchema = z.object({
  headline: z.string(),
  sections: z.array(z.object({ title: z.string(), text: z.string() })),
});
export type AiReportText = z.infer<typeof AiReportTextSchema>;

export const AiModerationSchema = z.object({
  verdict: z.enum(["allow", "review", "block"]),
  category: z.string().nullable(),
  reason: z.string(),
});

export type SuggestionKind = "missingStep" | "risk" | "suggestion" | "tip";

export interface Suppression {
  kind: SuggestionKind;
  text: string;
  taskIds: string[];
}

const FILLER = new Set("a an and are as at be by for from has have in into is it its of on or should that the their them then there these this to was were will with you your we our consider maybe please".split(" "));

/** Lowercase words without punctuation or filler, so rewordings compare fairly. */
export function keyWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w))
      .filter((w) => w && !FILLER.has(w)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

/**
 * Is this suggestion one the person said not to show again? Same kind, and either mostly the same
 * wording, or about the same tasks with some of the same wording (AI tends to reword itself).
 */
export function isSuppressed(item: Suppression, suppressed: readonly Suppression[]): boolean {
  const words = keyWords(item.text);
  const tasks = [...item.taskIds].sort().join(",");
  return suppressed.some((s) => {
    if (s.kind !== item.kind) return false;
    const o = overlap(words, keyWords(s.text));
    if (o >= 0.6) return true;
    return tasks !== "" && tasks === [...s.taskIds].sort().join(",") && o >= 0.25;
  });
}

/** The text a suggestion is matched on, per kind. */
export function suggestionText(kind: SuggestionKind, item: { title?: string; change?: string; message?: string }): string {
  return (kind === "suggestion" ? item.change : kind === "tip" ? item.message : item.title) ?? "";
}

/** Removes suppressed items from an AI review; returns how many were hidden. */
export function filterReview(review: AiReview, suppressed: readonly Suppression[]): { review: AiReview; hidden: number } {
  let hidden = 0;
  const keep = <T>(kind: SuggestionKind, list: T[], text: (x: T) => string, tasks: (x: T) => string[]) =>
    list.filter((x) => {
      const out = isSuppressed({ kind, text: text(x), taskIds: tasks(x) }, suppressed);
      if (out) hidden++;
      return !out;
    });
  return {
    review: {
      ...review,
      missingSteps: keep("missingStep", review.missingSteps, (m) => m.title, (m) => (m.afterTaskId ? [m.afterTaskId] : [])),
      risks: keep("risk", review.risks, (r) => r.title, (r) => r.taskIds),
      suggestions: keep("suggestion", review.suggestions, (s) => s.change, (s) => (s.taskId ? [s.taskId] : [])),
    },
    hidden,
  };
}
