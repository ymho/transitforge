import { describe, expect, it } from "vitest";
import { validInTripAnswerPlan } from "@raiquora/agent/in-trip-answer-plan";
import { parseAgentDecisionSummary } from "@raiquora/agent/agent-decision-summary";

describe("InTripAnswerPlan retained wire contract", () => {
  it.each([
    {}, { evidence: [] }, { evidence: Array.from({ length: 7 }, (_, i) => ({ evidenceId: `id${i}`, presentation: "uncertainty" })) },
    { evidence: [{ evidenceId: "id", presentation: "location-permission", currentLocation: "京都", boarding: true }] },
    { evidence: [{ evidenceId: "id", presentation: "invented" }] },
    { evidence: [{ evidenceId: "id", presentation: "uncertainty" }, { evidenceId: "id", presentation: "uncertainty" }] },
    { evidence: [{ evidenceId: "id", presentation: "uncertainty" }], facts: { delay: 0 } },
  ])("rejects invalid structure or authored facts %j", (plan) => {
    expect(validInTripAnswerPlan(plan)).toBe(false);
    expect(parseAgentDecisionSummary({ interpretedGoal: "回答", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: [], inTripAnswerPlan: plan })).toBeUndefined();
  });

});
