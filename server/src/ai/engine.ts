/**
 * The AI engine port: every AI call goes through this, so other providers (bring your own AI,
 * section 4b) only add adapters. With no engine configured, AI features are off.
 */
import type { AiReportText, AiReview, ModerationVerdict, StatusFacts, Suppression } from "@rakuplan/shared";

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type AiResult<T> =
  | { ok: true; value: T; usage: AiUsage }
  /** refused: the model declined (safety). failed: anything else (busy, bad answer, config). */
  | { ok: false; reason: "refused" | "failed" | "truncated"; category?: string | null; message: string; usage?: AiUsage };

export interface ReviewInput {
  /** The plan in the plan format (names possibly hidden). */
  planText: string;
  /** Suggestions the people on this plan said not to make again. */
  declined: Suppression[];
  /** Text in the plan that looked like instructions to an AI (shown to the model as a warning, never obeyed). */
  injectionFlags: string[];
}

export interface AiEngine {
  readonly name: string;
  review(input: ReviewInput): Promise<AiResult<AiReview>>;
  report(facts: StatusFacts): Promise<AiResult<AiReportText>>;
  moderate(text: string): Promise<AiResult<ModerationVerdict>>;
}

/** Price per million tokens in US dollars (input, output), for the usage log. */
export const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
};

export function costUsd(u: AiUsage): number {
  const [i, o] = PRICES[u.model] ?? [0, 0];
  return (u.inputTokens * i + u.outputTokens * o) / 1_000_000;
}

/**
 * The refusal rule (owner decision): a decline is retried once on the same model, never on another;
 * declined twice means the request stops and is held for review.
 */
export async function withRefusalRule<T>(call: () => Promise<AiResult<T>>): Promise<{ result: AiResult<T>; held: boolean; attempts: AiResult<T>[] }> {
  const first = await call();
  if (first.ok || first.reason !== "refused") return { result: first, held: false, attempts: [first] };
  const second = await call();
  const held = !second.ok && second.reason === "refused";
  return { result: second, held, attempts: [first, second] };
}
