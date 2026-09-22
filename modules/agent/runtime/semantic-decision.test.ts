import { describe, expect, it } from "vitest";
import { validateSemanticDecision, type SemanticDecision } from "./semantic-decision";

const base = { version: 1 as const, interpretedGoal: "宿を調べる", targetRefs: ["trip:1"], constraintRefs: [], missingRequirements: [], usedEvidenceIds: [] };
describe("SemanticDecision", () => {
  it("rejects schema-valid action/tool and target contradictions", () => {
    const decision: SemanticDecision = { ...base, action: "use_tool", toolName: "search_stays" };
    expect(validateSemanticDecision({ decision, nativeToolNames: ["search_weather"], availableToolNames: ["search_stays", "search_weather"], allowedTargetRefs: ["trip:1"] }))
      .toEqual({ valid: false, error: "action_mismatch" });
    expect(validateSemanticDecision({ decision: { ...decision, targetRefs: ["trip:other"] }, nativeToolNames: ["search_stays"], availableToolNames: ["search_stays"], allowedTargetRefs: ["trip:1"] }))
      .toEqual({ valid: false, error: "target_mismatch" });
  });
  it("requires an externalized user or authorization requirement for ask", () => {
    const ask: SemanticDecision = { ...base, action: "ask", questionRefs: ["budget"] };
    expect(validateSemanticDecision({ decision: ask, nativeToolNames: [], availableToolNames: [], allowedTargetRefs: ["trip:1"] }))
      .toEqual({ valid: false, error: "missing_requirement_mismatch" });
    ask.missingRequirements = [{ action: "ask", field: "budget", resolution: "user_decision", reason: "利用者だけが決められる" }];
    expect(validateSemanticDecision({ decision: ask, nativeToolNames: [], availableToolNames: [], allowedTargetRefs: ["trip:1"] })).toEqual({ valid: true });
  });
});
