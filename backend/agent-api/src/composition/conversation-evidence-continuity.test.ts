import { createTrip } from "@raiquora/trip/trip";
import { expect, it, vi } from "vitest";
import { strandsScriptedRuntime } from "../adapters/strands-scripted-model.fixture.js";
import type { ServerAgentRuntimeRunner } from "../ports/server-agent-runtime.js";
import { stateDynamoFixture, stateA, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import type { ServerAgentToolBinding } from "../usecases/agent/server-tools.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";

const sourceEvidenceId = "evidence:izumo-source";
const sourceExcerpt = "出雲大社は出雲市にあり、参拝と門前町散策を組み合わせられます。";

it("reuses a published candidate source after an unrelated follow-up Tool call", async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const metadata = stateMetadata();
  trips.seed(createTrip(stateMetadata().tripId, "検討中の旅", "2026-09-18T00:00:00Z"), stateA.subject);
  await state.conversations.create(stateA, conversationId, { ...metadata, scope: "trip" });
  const models: ReturnType<typeof strandsScriptedRuntime>["model"][] = [];
  const runRuntime: ServerAgentRuntimeRunner = input => {
    const fixture = strandsScriptedRuntime([
      { name: models.length ? "check_lodging" : "discover_source", input: {} },
      { name: "strands_structured_output", input: { reply: { kind: "answer", commentary: "出雲大社は出雲市にあり、参拝と門前町散策を組み合わせられます。",
        references: [{ evidenceId: sourceEvidenceId, field: "sourceExcerpt" }] } } },
    ]);
    models.push(fixture.model);
    return fixture.runRuntime(input);
  };
  let execution = 0;
  const options = { stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    runRuntime, weather: { search: vi.fn() }, newExecutionId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++execution).padStart(12, "0")}`,
    additionalTools: [sourceTool(), lodgingTool()] };
  const agent = createConversationServerAgent(options);

  const first = await agent.runConversationTurn({ principal: stateA, conversationId,
    turnId: "11111111-1111-4111-8111-111111111111", userRequest: "出雲大社へ1泊で行きたい" });
  expect(first.status).toBe("completed");
  const second = await agent.runConversationTurn({ principal: stateA, conversationId,
    turnId: "22222222-2222-4222-8222-222222222222", userRequest: "宿も確認して、さっきの案を完成させて" });

  expect(second.status).toBe("completed");
  expect(second.response).toContain("出雲大社");
  expect(JSON.stringify(models[1].observedMessages[0])).toContain(sourceExcerpt);
  expect(JSON.stringify(models[1].observedMessages[0])).not.toContain("groundingEvidence");
  const working = await new DynamoDbConversationTurnRepository("test-state", state.client)
    .getWorkingState(stateA, conversationId);
  expect(working?.groundingEvidence?.map(({ id }) => id)).toContain(sourceEvidenceId);
});

it("keeps published source Evidence when a later turn supplies tomorrow's departure", async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  trips.seed(createTrip(stateMetadata().tripId, "検討中の旅", "2026-09-18T00:00:00Z"), stateA.subject);
  await state.conversations.create(stateA, conversationId, stateMetadata());
  let turn = 0;
  const runRuntime: ServerAgentRuntimeRunner = input => {
    const steps: Array<{ name: string; input: unknown }> = [];
    if (turn === 0) steps.push({ name: "discover_source", input: {} });
    if (turn === 1) steps.push({ name: "update_current_travel_period", input: {
      action: "set", period: { start: { kind: "relative_date", relation: "tomorrow" } }, quote: "明日" } });
    steps.push({ name: "strands_structured_output", input: { reply: turn === 1
      ? { kind: "conversation", message: "acknowledgement", text: "明日出発する条件を確認しました。" }
      : { kind: "answer", commentary: sourceExcerpt, references: [{ evidenceId: sourceEvidenceId, field: "sourceExcerpt" }] } } });
    turn += 1;
    return strandsScriptedRuntime(steps).runRuntime(input);
  };
  const agent = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    runRuntime, weather: { search: vi.fn() }, newExecutionId: () => crypto.randomUUID(), additionalTools: [sourceTool()] });
  await agent.runConversationTurn({ principal: stateA, conversationId,
    turnId: "11111111-1111-4111-8111-111111111111", userRequest: "出雲大社に行きたい", uiContext: { calendarDate: "2026-09-25" } });
  const second = await agent.runConversationTurn({ principal: stateA, conversationId,
    turnId: "22222222-2222-4222-8222-222222222222", userRequest: "明日出発します", uiContext: { calendarDate: "2026-09-25" } });
  expect(second.status).toBe("completed");
  expect(second.semanticReceipt?.changes.map(change => change.target)).toContain("start_date");
  expect((await new DynamoDbConversationTurnRepository("test-state", state.client).getWorkingState(stateA, conversationId))?.groundingEvidence?.map(({ id }) => id)).toContain(sourceEvidenceId);
});

function sourceTool(): ServerAgentToolBinding {
  return { descriptor: { name: "discover_source", description: "旅行先の資料を確認する", inputSchema: { type: "object", additionalProperties: false, properties: {} },
    intentPolicy: { dependencies: ["destination"] } },
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
