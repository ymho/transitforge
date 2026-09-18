import { expect, it } from "vitest";
import { generalGroundingCases, runGeneralGroundingScenario } from "./general-grounding-scenario.fixture";
import { modelGroundedAnswer } from "./ask-progress-scenarios.fixture";

it.each(generalGroundingCases)("production adapter validates bound claims: %s", async (id) => {
  const result = await runGeneralGroundingScenario(id, async (messages) => modelGroundedAnswer(messages));
  expect(result.passed).toBe(true);
  expect(result.modelCalls).toBe(1);
  expect(result.toolCalls).toBe(0);
  expect(result.factualClaims).toBeGreaterThan(0);
});
it("omitted claims are not accepted on either attempt, including a non-factual self declaration", async () => {
  const result = await runGeneralGroundingScenario("fabricated-duration", async () => ({
    message: { role: "assistant", content: [{ text: '<decision_summary>{"interpretedGoal":"経路を案内","hardConstraints":[],"softPreferences":[],"selectedAction":"answer","unresolvedFacts":[],"reasonCodes":["no_factual_claim_required"]}</decision_summary>AからCへ25分です。' }] }, stopReason: "end_turn",
  }));
  expect(result.passed).toBe(false);
  expect(result.modelCalls).toBe(2);
  expect(result.repairs).toBe(1);
  expect(result.response).not.toContain("25分");
});
