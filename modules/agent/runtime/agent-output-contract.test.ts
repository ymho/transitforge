import { expect, it } from "vitest";
import { agentTurnOutputContract, agentTurnPresentationOutputContract, decodeAgentTurnOutput } from "./agent-output-contract";

it("requires typed presentation only in the Evidence-backed final-answer contract", () => {
  expect(agentTurnOutputContract.version).toBe("1");
  expect(agentTurnOutputContract.schema.required).toEqual(["responseText", "decision"]);
  expect(agentTurnPresentationOutputContract.version).toBe("3");
  expect(agentTurnPresentationOutputContract.schema.required).toEqual(["responseText", "presentation", "decision"]);
  expect(agentTurnPresentationOutputContract.schemaHash).not.toBe(agentTurnOutputContract.schemaHash);
});

it("publishes the typed itinerary activity shape enforced by the Application parser", () => {
  const schema = agentTurnPresentationOutputContract.schema as any;
  const activity = schema.properties.presentation.anyOf[1].properties.candidates.items.properties
    .itinerary.items.properties.activities.items;
  expect(activity.required).toEqual(["period", "title", "kind"]);
  expect(activity.properties.activity).toBeUndefined();
  expect(activity.properties.title).toMatchObject({ minLength: 1, maxLength: 300 });
  expect(activity.properties.kind.enum).toEqual(["transport", "stay", "activity", "free-time"]);
  expect(schema.properties.decision.properties.usedEvidenceIds.items).toMatchObject({ minLength: 1, maxLength: 160 });
});

it("decodes the required presentation without treating responseText as factual output", () => {
  const presentation = { kind: "travel-plan", startDate: null, candidates: [] };
  expect(decodeAgentTurnOutput({ responseText: "旅行案です", presentation, decision: {
    interpretedGoal: "旅行案を提示", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: [],
  } })).toMatchObject({ responseText: "旅行案です", presentation, decision: { selectedAction: "answer" } });
});
