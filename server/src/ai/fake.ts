/**
 * TESTS ONLY (TEST_AI=1, off by default like TEST_AUTH): a scripted engine so both hosts' tests can
 * run the AI features without the network. Markers in the plan steer it:
 *   [refuse]       every request is declined          [refuse-once]  declined once, then answers
 *   [invent]       the report adds a made-up number   [ai-block]     moderation blocks
 *   [mod-refuse]   moderation is declined
 * It repeats its suggestions reworded, so "don't suggest this again" is tested against rewording.
 */
import type { AiReportText, AiReview, ModerationVerdict, StatusFacts } from "@ezplan/shared";
import type { AiEngine, AiResult, ReviewInput } from "./engine";

const usage = (model: string) => ({ model, inputTokens: 1000, outputTokens: 200 });

export class FakeEngine implements AiEngine {
  readonly name = "fake";
  private readonly seen = new Map<string, number>();
  /** Every request, for assertions (which model, what was sent). */
  readonly calls: { kind: string; model: string; text: string }[] = [];

  private refused(text: string): boolean {
    if (text.includes("[refuse]")) return true;
    if (text.includes("[refuse-once]")) {
      const n = (this.seen.get(text) ?? 0) + 1;
      this.seen.set(text, n);
      return n === 1;
    }
    return false;
  }

  async review(input: ReviewInput): Promise<AiResult<AiReview>> {
    this.calls.push({ kind: "review", model: "claude-opus-5-5", text: input.planText });
    if (this.refused(input.planText)) return { ok: false, reason: "refused", category: "test", message: "declined", usage: usage("claude-opus-5-5") };
    const firstTask = /- \[.\] (T\d+):/.exec(input.planText)?.[1] ?? "T1";
    const declinedPermit = input.declined.some((d) => /permit/i.test(d.text));
    return {
      ok: true,
      usage: usage("claude-opus-5-5"),
      value: {
        verdict: "needs_work",
        summary: "The plan is close; a permit step and a weather risk stand out.",
        goalFit: { score: 74, comment: "Fits the goal; the end date is tight." },
        // Reworded each time once declined: the server must still filter it.
        missingSteps: [{ title: declinedPermit ? "Get the building permit approved first" : "Apply for the building permit", phaseId: null, afterTaskId: firstTask, why: "Work can't start without it." }, { title: "Book the final inspection", phaseId: null, afterTaskId: null, why: "Needed to close the job." }],
        risks: [{ title: "Bad weather could delay outdoor work", taskIds: [firstTask], mitigation: "Keep two spare days." }],
        suggestions: [{ taskId: firstTask, change: "Split this task into two smaller steps", why: "Easier to track." }],
      },
    };
  }

  async report(facts: StatusFacts): Promise<AiResult<AiReportText>> {
    this.calls.push({ kind: "report", model: "claude-haiku-5-5", text: facts.planTitle });
    if (this.refused(facts.planTitle)) return { ok: false, reason: "refused", category: "test", message: "declined", usage: usage("claude-haiku-5-5") };
    return {
      ok: true,
      usage: usage("claude-haiku-5-5"),
      value: {
        headline: `A steady week: ${facts.percent}% done${facts.planTitle.includes("[invent]") ? " and $5,000 saved" : ""}.`,
        sections: [{ title: "Done", text: facts.doneSince.length ? facts.doneSince.map((d) => d.title).join(", ") + "." : "Nothing new this week." }],
      },
    };
  }

  async moderate(text: string): Promise<AiResult<ModerationVerdict>> {
    this.calls.push({ kind: "moderate", model: "claude-opus-5-5", text });
    if (text.includes("[mod-refuse]")) return { ok: false, reason: "refused", category: "test", message: "declined", usage: usage("claude-opus-5-5") };
    if (text.includes("[ai-block]")) return { ok: true, usage: usage("claude-opus-5-5"), value: { verdict: "block", category: "test", reason: "test block" } };
    return { ok: true, usage: usage("claude-opus-5-5"), value: { verdict: "allow", reason: "ok" } };
  }
}
