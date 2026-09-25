import { expect, it } from "vitest";
import { agentTurnOutputContract, agentTurnPlanningOutputContract, agentTurnPresentationOutputContract, decodeAgentTurnOutput } from "./agent-output-contract";

it("requires a travel-plan presentation for a verified planning answer", () => {
  const answer = (agentTurnPlanningOutputContract.schema as any).anyOf[0];
  expect(answer.required).toContain("presentation");
  expect(answer.properties.presentation.properties.kind.const).toBe("travel-plan");
  expect(answer.properties.presentation.properties.candidates.items.required).not.toContain("estimate");
});

it("publishes a small answer-or-ask contract and requires presentation only for Evidence-backed answers", () => {
  expect(agentTurnOutputContract.version).toBe("4");
  expect(agentTurnPresentationOutputContract.version).toBe("4-presentation");
  expect((agentTurnOutputContract.schema as any).anyOf).toHaveLength(2);
  expect((agentTurnPresentationOutputContract.schema as any).anyOf[0].required)
    .toEqual(["kind", "responseText", "presentation"]);
  expect(agentTurnPresentationOutputContract.schemaHash).not.toBe(agentTurnOutputContract.schemaHash);
});

it("publishes the typed itinerary activity shape enforced by the Application parser", () => {
  const answer = (agentTurnPresentationOutputContract.schema as any).anyOf[0];
  const activity = answer.properties.presentation.anyOf[1].properties.candidates.items.properties
    .itinerary.items.properties.activities.items;
  expect(activity.required).toEqual(["period", "title", "kind"]);
  expect(activity.properties.activity).toBeUndefined();
  expect(activity.properties.title).toMatchObject({ minLength: 1, maxLength: 300 });
  expect(activity.properties.kind.enum).toEqual(["transport", "stay", "activity", "free-time"]);
  expect(answer.properties.evidenceIds.items).toMatchObject({ minLength: 1, maxLength: 160 });
});

it("decodes answers, questions and in-trip references without model-authored decision metadata", () => {
  const presentation = { kind: "travel-plan", startDate: null, candidates: [] };
  expect(decodeAgentTurnOutput({ kind: "answer", responseText: "旅行案です", presentation }))
    .toEqual({ kind: "answer", responseText: "旅行案です", presentation });
  expect(decodeAgentTurnOutput({ kind: "ask", responseText: "どちらにしますか？", missingRequirements: [
    { action: "ask", field: "destination", resolution: "user_decision", reason: "行き先の選択が必要です" },
  ] })).toMatchObject({ kind: "ask", missingRequirements: [{ field: "destination" }] });
  expect(decodeAgentTurnOutput({ kind: "answer", responseText: "次の予定です", evidenceIds: ["trip-1"],
    inTripAnswerPlan: { evidence: [{ evidenceId: "trip-1", presentation: "planned-itinerary" }] } }))
    .toMatchObject({ kind: "answer", inTripAnswerPlan: { evidence: [{ evidenceId: "trip-1" }] } });
  expect(decodeAgentTurnOutput({ kind: "answer", responseText: "不正", decision: {} })).toBeUndefined();
});
