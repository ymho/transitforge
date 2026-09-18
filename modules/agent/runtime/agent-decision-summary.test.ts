import { describe, expect, it } from "vitest";

import { extractAgentDecisionSummary } from "@raiquora/agent/agent-decision-summary";

describe("Agent Decision Summary", () => {
  it("validates answer references independently of invalid optional decision metadata", () => {
    const plan = { evidence: [{ evidenceId: "application:in-trip:impacts/0", presentation: "rail-impact" }] };
    const value = { interpretedGoal: "説明", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: ["接続後の時刻"], reasonCodes: [],
      usedEvidenceIds: ["application:in-trip:impacts/0"], inTripAnswerPlan: plan };
    const parsed = extractAgentDecisionSummary([`<decision_summary>${JSON.stringify(value)}</decision_summary>未検証自由文`]);
    expect(parsed).toMatchObject({ status: "invalid", declaredInTripAnswerPlan: plan, declaredEvidenceIds: value.usedEvidenceIds });
    expect(parsed.summary).toBeUndefined();
    for (const inTripAnswerPlan of [{ evidence: [{ ...plan.evidence[0], boarding: true }] }, { evidence: [] }]) {
      expect(extractAgentDecisionSummary([`<decision_summary>${JSON.stringify({ ...value, inTripAnswerPlan })}</decision_summary>`]).declaredInTripAnswerPlan).toBeUndefined();
    }
    expect(extractAgentDecisionSummary([`<decision_summary>${JSON.stringify({ ...value, selectedAction: "ask_user" })}</decision_summary>`]).declaredInTripAnswerPlan).toBeUndefined();
  });
  it("retains declared IDs for runtime existence validation even if other summary fields are invalid", () => {
    const value = { interpretedGoal: "説明", hardConstraints: [], softPreferences: [], selectedAction: "use_tool", unresolvedFacts: [], reasonCodes: [], usedEvidenceIds: ["missing"] };
    expect(extractAgentDecisionSummary([`<decision_summary>${JSON.stringify(value)}</decision_summary>回答`])).toEqual({ status: "invalid", declaredEvidenceIds: ["missing"], textBlocks: ["回答"] });
  });
  it.each([["e", "e"], Array.from({ length: 11 }, (_, i) => `e${i}`), [""], [42]])("rejects invalid Evidence references %j", (...ids) => {
    const value = { interpretedGoal: "説明", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: [], usedEvidenceIds: ids };
    expect(extractAgentDecisionSummary([`<decision_summary>${JSON.stringify(value)}</decision_summary>回答`])).toMatchObject({ status: "invalid", invalidUsedEvidenceIds: true, textBlocks: ["回答"] });
  });
  it("keeps bounded evidence IDs only in the decision, not user text", () => {
    const value = { interpretedGoal: "説明", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: [], usedEvidenceIds: ["application:in-trip:impacts/0"] };
    expect(extractAgentDecisionSummary([`<decision_summary>${JSON.stringify(value)}</decision_summary>乗換余裕は4分です`])).toMatchObject({ status: "valid", summary: { usedEvidenceIds: value.usedEvidenceIds }, textBlocks: ["乗換余裕は4分です"] });
  });
  it("extracts a bounded external decision and removes it from display text", () => {
    const result = extractAgentDecisionSummary([
      '<decision_summary>{"interpretedGoal":"出雲への宿泊旅行を組む","hardConstraints":[{"key":"stay_nights","value":1}],"softPreferences":[{"key":"pace","value":"slow"}],"selectedAction":"use_tool","selectedTool":"search_accommodations","unresolvedFacts":[],"reasonCodes":["constraint_applied","evidence_required"]}</decision_summary>宿を確認します。',
    ]);

    expect(result).toMatchObject({
      status: "valid",
      summary: {
        selectedAction: "use_tool",
        selectedTool: "search_accommodations",
        hardConstraints: [{ key: "stay_nights", value: 1 }],
      },
      textBlocks: ["宿を確認します。"],
    });
  });

  it("rejects prose reasoning and unknown fields instead of storing it", () => {
    const result = extractAgentDecisionSummary([
      '<decision_summary>{"interpretedGoal":"旅行を考える","hardConstraints":[],"softPreferences":[],"selectedAction":"answer","unresolvedFacts":[],"reasonCodes":["goal_interpreted"],"analysis":"長い内部推論"}</decision_summary>回答',
    ]);

    expect(result).toEqual({ status: "invalid", textBlocks: ["回答"] });
  });

  it("treats a missing summary as optional and preserves the answer", () => {
    expect(extractAgentDecisionSummary(["回答"])).toEqual({
      status: "missing",
      textBlocks: ["回答"],
    });
  });
});
