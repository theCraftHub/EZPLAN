import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filterReview, isSuppressed, levelPlan, onlyKnownNumbers, parsePlan, progressOf, statusFacts, templateReport, type AiReview } from "../src";

describe("don't suggest this again", () => {
  const no = [{ kind: "missingStep" as const, text: "Book a backup venue in case the first one cancels", taskIds: ["T2"] }];
  it("hides the same idea reworded", () => {
    expect(isSuppressed({ kind: "missingStep", text: "Book a backup venue in case the first venue cancels", taskIds: [] }, no)).toBe(true);
    expect(isSuppressed({ kind: "missingStep", text: "You should consider booking a back-up venue, in case the first cancels!", taskIds: ["T2"] }, no)).toBe(true);
  });
  it("keeps genuinely different suggestions, and other kinds", () => {
    expect(isSuppressed({ kind: "missingStep", text: "Hire a photographer for the evening", taskIds: [] }, no)).toBe(false);
    expect(isSuppressed({ kind: "risk", text: "Book a backup venue in case the first one cancels", taskIds: ["T2"] }, no)).toBe(false);
    expect(isSuppressed({ kind: "missingStep", text: "Confirm catering numbers", taskIds: ["T2"] }, no)).toBe(false); // same task, different idea
  });
  it("filters an AI answer and counts what it hid", () => {
    const review: AiReview = {
      verdict: "needs_work", summary: "", goalFit: { score: 70, comment: "" },
      missingSteps: [{ title: "Book backup venue in case first venue cancels", phaseId: null, afterTaskId: null, why: "" }, { title: "Plan the seating", phaseId: null, afterTaskId: null, why: "" }],
      risks: [], suggestions: [],
    };
    const r = filterReview(review, no);
    expect(r.hidden).toBe(1);
    expect(r.review.missingSteps.map((m) => m.title)).toEqual(["Plan the seating"]);
  });
});

describe("status report facts", () => {
  const gala = parsePlan(readFileSync(join(import.meta.dirname, "fixtures", "gala.ezplan"), "utf8")).plan;
  const today = "2026-12-08";
  const s = levelPlan(gala, { today });
  const facts = statusFacts(gala, s, progressOf(gala, s, { today }), { today, since: "2026-12-01" });
  it("collects what was done, what's coming and the forecast from the plan alone", () => {
    expect(facts.doneSince).toEqual([{ title: "Set budget", by: "Ana", date: "2026-12-02" }]);
    expect(facts.finish).toBe(s.finish);
    expect(["green", "amber", "red"]).toContain(facts.rag);
    const t = templateReport(facts);
    expect(t.headline).toMatch(/^Spring Charity Gala: /);
    expect(t.sections.map((x) => x.title)).toEqual(["Done since Dec 1", "Behind schedule", "Coming up", "Milestones", "Forecast"]);
  });
  it("accepts rewording that keeps the numbers, refuses invented ones", () => {
    const t = templateReport(facts);
    expect(onlyKnownNumbers(t, facts)).toBe(true);
    expect(onlyKnownNumbers({ headline: `Good week: ${facts.percent}% done.`, sections: [] }, facts)).toBe(true);
    expect(onlyKnownNumbers({ headline: "Good week: 93% done and $12,000 raised.", sections: [] }, facts)).toBe(false);
  });
});
