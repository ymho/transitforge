import { describe, expect, it } from "vitest";

import { extractAgentDecisionSummary } from "./agent-decision-summary";

describe("Agent Decision Summary", () => {
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
