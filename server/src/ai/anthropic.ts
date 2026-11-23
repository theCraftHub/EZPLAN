/**
 * The Anthropic adapter (built-in AI). Structured outputs only; no tools, no web access.
 * No fallback models: a safety decline is reported as "refused" and the caller applies the
 * refusal rule (one retry on the same model, then hold for review).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AiModerationSchema, AiReportTextSchema, AiReviewSchema, type AiReportText, type AiReview, type ModerationVerdict, type StatusFacts } from "@ezplan/shared";
import type { z } from "zod";
import type { AiEngine, AiResult, ReviewInput } from "./engine";
import { marker, MODERATION_SYSTEM, moderationMessage, REPORT_SYSTEM, reportMessage, REVIEW_SYSTEM, reviewMessage } from "./prompts";

export interface AnthropicOptions {
  apiKey: string;
  /** Plan Check and moderation (default claude-opus-5-5). */
  model?: string;
  /** Status report wording (default claude-haiku-5-5: it only rewords facts). */
  reportModel?: string;
  /** Tests replace the network. */
  fetch?: typeof fetch;
}

export class AnthropicEngine implements AiEngine {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  readonly model: string;
  readonly reportModel: string;

  constructor(opts: AnthropicOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 120_000, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    this.model = opts.model ?? "claude-opus-5-5";
    this.reportModel = opts.reportModel ?? "claude-haiku-5-5";
  }

  private async call<S extends z.ZodType>(model: string, effort: "low" | "medium", system: string, content: string, schema: S): Promise<AiResult<z.infer<S>>> {
    let truncatedOnce = false;
    for (;;) {
      try {
        // Same schema as messages.parse, but the answer is validated here, after checking why the
        // model stopped (parse would throw on a refusal before we could see it).
        const res = await this.client.messages.create({
          model,
          max_tokens: 16000,
          system,
          messages: [{ role: "user", content }],
          output_config: { effort, format: zodOutputFormat(schema) },
        });
        const usage = { model: res.model ?? model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
        // Always look at why it stopped before reading the answer.
        if (res.stop_reason === "refusal") {
          return { ok: false, reason: "refused", category: res.stop_details?.category ?? null, message: "The AI declined this request.", usage };
        }
        if (res.stop_reason === "max_tokens") {
          if (!truncatedOnce) {
            truncatedOnce = true;
            continue;
          }
          return { ok: false, reason: "truncated", message: "The AI's answer was too long. Try again.", usage };
        }
        const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          return { ok: false, reason: "failed", message: "The AI's answer couldn't be read. Try again.", usage };
        }
        const checked = schema.safeParse(json);
        if (!checked.success) return { ok: false, reason: "failed", message: "The AI's answer couldn't be read. Try again.", usage };
        return { ok: true, value: checked.data as z.infer<S>, usage };
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError) return { ok: false, reason: "failed", message: "The AI is busy right now. Try again in a minute." };
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, reason: "failed", message: "The AI isn't set up correctly on this server. Tell whoever runs it." };
        if (e instanceof Anthropic.APIConnectionError) return { ok: false, reason: "failed", message: "Couldn't reach the AI. Try again." };
        if (e instanceof Anthropic.APIError) return { ok: false, reason: "failed", message: "The AI had a problem. Try again." };
        throw e;
      }
    }
  }

  review(input: ReviewInput): Promise<AiResult<AiReview>> {
    return this.call(this.model, "medium", REVIEW_SYSTEM, reviewMessage(marker(), input.planText, input.declined, input.injectionFlags), AiReviewSchema);
  }

  report(facts: StatusFacts): Promise<AiResult<AiReportText>> {
    return this.call(this.reportModel, "low", REPORT_SYSTEM, reportMessage(marker(), facts), AiReportTextSchema);
  }

  moderate(text: string): Promise<AiResult<ModerationVerdict>> {
    return this.call(this.model, "medium", MODERATION_SYSTEM, moderationMessage(marker(), text), AiModerationSchema) as Promise<AiResult<ModerationVerdict>>;
  }
}
