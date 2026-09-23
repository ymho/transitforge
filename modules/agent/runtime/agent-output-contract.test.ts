import { expect, it } from "vitest";
import { agentTurnOutputContract, agentTurnPresentationOutputContract, decodeAgentTurnOutput } from "./agent-output-contract";

it("requires typed presentation only in the Evidence-backed final-answer contract", () => {
  expect(agentTurnOutputContract.version).toBe("1");
  expect(agentTurnOutputContract.schema.required).toEqual(["responseText", "decision"]);
  expect(agentTurnPresentationOutputContract.version).toBe("2");
  expect(agentTurnPresentationOutputContract.schema.required).toEqual(["responseText", "presentation", "decision"]);
  expect(agentTurnPresentationOutputContract.schemaHash).not.toBe(agentTurnOutputContract.schemaHash);
});

it("decodes the required presentation without treating responseText as factual output", () => {
  const presentation = { kind: "travel-plan", startDate: null, candidates: [] };
  expect(decodeAgentTurnOutput({ responseText: "旅行案です", presentation, decision: {
    interpretedGoal: "旅行案を提示", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: [],
  } })).toMatchObject({ responseText: "旅行案です", presentation, decision: { selectedAction: "answer" } });
});
