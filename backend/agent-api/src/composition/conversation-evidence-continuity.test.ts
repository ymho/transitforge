import { expect, it, vi } from "vitest";
import type { ConversationModel, ConversationModelRequest } from "../ports/conversation-model.js";
import { stateDynamoFixture, stateA, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import type { ServerAgentToolBinding } from "../usecases/agent/server-tools.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";

const sourceEvidenceId = "evidence:izumo-source";
const sourceExcerpt = "出雲大社は出雲市にあり、参拝と門前町散策を組み合わせられます。";

it("reuses a published candidate source after an unrelated follow-up Tool call", async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const { tripId: _tripId, ...metadata } = stateMetadata();
  await state.conversations.create(stateA, conversationId, { ...metadata, scope: "general" });
  const requests: ConversationModelRequest[] = [];
  const responses = [toolCall("source-1", "discover_source"), finalPlan(), toolCall("lodging-1", "check_lodging"), finalPlan()];
  const model: ConversationModel = { converse: vi.fn(async request => {
    requests.push(structuredClone(request));
    return responses.shift()!;
  }) };
  let execution = 0;
  const options = { stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model, weather: { search: vi.fn() }, newExecutionId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++execution).padStart(12, "0")}`,
    additionalTools: [sourceTool(), lodgingTool()] };
  const agent = createConversationServerAgent(options);

  const first = await agent.runConversationTurn({ principal: stateA, conversationId,
    turnId: "11111111-1111-4111-8111-111111111111", userRequest: "出雲大社へ1泊で行きたい" });
  expect(first.status).toBe("completed");
  const second = await agent.runConversationTurn({ principal: stateA, conversationId,
    turnId: "22222222-2222-4222-8222-222222222222", userRequest: "宿も確認して、さっきの案を完成させて" });

  expect(second.status).toBe("completed");
  expect(second.response).toContain("出雲大社");
  expect(JSON.stringify(requests[2])).toContain(sourceExcerpt);
  expect(JSON.stringify(requests[2])).not.toContain("groundingEvidence");
  const working = await new DynamoDbConversationTurnRepository("test-state", state.client)
    .getWorkingState(stateA, conversationId);
  expect(working?.groundingEvidence?.map(({ id }) => id)).toContain(sourceEvidenceId);
});

function toolCall(toolUseId: string, name: string) {
  return { message: { role: "assistant" as const, content: [{ toolUse: { toolUseId, name, input: {} } }] },
    stopReason: "tool_use" as const, metadata: { modelId: "synthetic", latencyMs: 1 } };
}

function finalPlan() {
  const presentation = { kind: "travel-plan", startDate: "2026-09-25", candidates: [{ evidenceId: sourceEvidenceId, quote: sourceExcerpt,
    itinerary: [{ day: 1, activities: [{ period: "afternoon", title: "出雲大社を参拝し門前町を散策する", kind: "activity" },
      { period: "evening", title: "宿で休む", kind: "stay" }] }, { day: 2, activities: [{ period: "morning", title: "周辺をゆっくり歩く", kind: "activity" },
      { period: "afternoon", title: "余裕を持って帰路につく", kind: "transport" }] }],
    estimate: { currency: "JPY", partySize: 1, nights: 1, originTravel: "excluded", lodgingClass: "standard",
      items: { transport: 0, accommodation: 18_000, sightseeing: 2_000, food: 7_000 } } }] };
  return { message: { role: "assistant" as const, content: [{ text: JSON.stringify({ responseText: "旅行案です", presentation,
    decision: { interpretedGoal: "出雲大社の1泊旅行を提案する", hardConstraints: [], softPreferences: [], selectedAction: "answer",
      unresolvedFacts: [], reasonCodes: ["evidence_sufficient"], usedEvidenceIds: [sourceEvidenceId] } }) }] },
    stopReason: "end_turn" as const, metadata: { modelId: "synthetic", latencyMs: 1, outputMode: "application_strict" as const } };
}

function sourceTool(): ServerAgentToolBinding {
  return { descriptor: { name: "discover_source", description: "旅行先の資料を確認する", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
    operation: async () => ({ body: { source: "izumo" } }), evidence: (_output, context) => [{ id: sourceEvidenceId, category: "external", knowledgeKind: "deterministic_fact",
      subject: "出雲大社", facts: { status: "available", freshness: "fresh", sourceTitle: "出雲大社", sourceExcerpt,
        sourceUrl: "https://example.test/izumo", placeName: "出雲大社", imageUrl: "https://images.example.test/izumo.jpg",
        imageSourceUrl: "https://example.test/izumo", imageAttribution: "Example", boundSourceUrls: ["https://example.test/izumo"] }, references: [{ sourceType: "external-source", sourceRef: "https://example.test/izumo",
        retrievedAt: context.retrievedAt, freshness: "current", summary: "確認済みの旅行先資料" }], observation: { observationId: sourceEvidenceId,
        subjectKey: "place:izumo", scopeKey: "izumo", predicate: "place_description", retrievedAt: context.retrievedAt,
        applicability: "applicable", state: "current", retention: "bounded_excerpt" } }] };
}

function lodgingTool(): ServerAgentToolBinding {
  return { descriptor: { name: "check_lodging", description: "宿泊候補を確認する", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
    operation: async () => ({ body: { status: "checked" } }), evidence: (_output, context) => [{ id: "evidence:lodging", category: "external", knowledgeKind: "deterministic_fact",
      subject: "宿泊候補", facts: { status: "available", freshness: "fresh", resultKind: "accommodation", name: "確認済みの宿" },
      references: [{ sourceType: "external-source", sourceRef: "https://example.test/lodging", retrievedAt: context.retrievedAt, freshness: "current", summary: "宿泊候補" }],
      observation: { observationId: "evidence:lodging", subjectKey: "lodging:test", scopeKey: "izumo", predicate: "accommodation", retrievedAt: context.retrievedAt,
        applicability: "applicable", state: "current", retention: "bounded_excerpt" } }] };
}
