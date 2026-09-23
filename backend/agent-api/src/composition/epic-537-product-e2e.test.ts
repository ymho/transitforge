import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyTripProposal, createTrip } from "@raiquora/trip/trip";
import type { ConversationModel, ConversationModelRequest } from "../ports/conversation-model.js";
import { stateDynamoFixture, stateA, conversationId, secondId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { DynamoDbItineraryCandidateRepository } from "../adapters/dynamodb-itinerary-candidate-repository.js";
import { PlanCandidateAdoptionApplication } from "../usecases/plan-candidate-adoption.js";
import { TripApplication } from "../usecases/trip-application.js";
import type { ServerAgentToolBinding } from "../usecases/agent/server-tools.js";
import { boundedTrip } from "../contracts/trip-api.js";
import type { AgentDiagnosticEvent } from "../ports/agent-diagnostics.js";
import { parseEpic537FinalExpected } from "../../../../frontend/src/usecases/agent/evaluation/epic-537-final-evaluation.js";

const executionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mutationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const replanMutationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const userRequest = "車なしで2案を比較して。宿は維持し、3日目だけ雨天案へ変更できる形で。最後の条件も省略しないで。";

it("traces production input → decision → search/Evidence → presentation → adoption/readback → partial replan", async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const diagnostics: AgentDiagnosticEvent[] = [];
  const original = createTrip(secondId, "複数日旅行", "2026-09-01T00:00:00Z", [{
    id: "hotel", type: "stay", title: "維持する宿", schedule: { type: "relative", dayId: "day-1", endDayId: "day-4" }, selection: { status: "unselected" },
  }], undefined, "inspiration", undefined, { version: 1, logicalDays: ["day-1", "day-2", "day-3", "day-4"].map(id => ({ id })), calendarBindings: [] });
  await trips.repository.create(stateA, original);
  await state.conversations.create(stateA, conversationId, { ...stateMetadata(), tripId: secondId });
  const requests: ConversationModelRequest[] = [];
  const model = { converse: vi.fn<ConversationModel["converse"]>(async request => {
    requests.push(structuredClone(request));
    const call = requests.length;
    if (call === 1) return { message: { role: "assistant", content: [{ toolUse: { toolUseId: "discovery-1", name: "search_eval_candidates", input: { perspectives: ["area", "rain", "car-free"] } } }] }, stopReason: "tool_use", metadata: { modelId: "synthetic", latencyMs: 1 } };
    if (call === 2) return { message: { role: "assistant", content: [{ toolUse: { toolUseId: "candidate-1", name: "propose_itinerary_candidate_set", input: candidateToolInput() } }] }, stopReason: "tool_use", metadata: { modelId: "synthetic", latencyMs: 1 } };
    const statement = "外部情報は未確認、または鮮度を確認できていません。移動の成立・空き状況・天気や警報に問題がないとは判断できません。必要な情報を追加確認してください。";
    const claim = { id: "fact-0", statement, kind: "fact", evidenceIds: ["eval-evidence-1"], bindings: [{ evidenceId: "eval-evidence-1", fieldPath: "facts.candidateCount",
      subjectRef: "eval-candidates", applicabilityScope: executionId, transform: "deterministic_calculation" }] };
    return { message: { role: "assistant", content: [{ text: JSON.stringify({ responseText: JSON.stringify({ text: statement, claims: [claim] }), decision: {
      interpretedGoal: "車なしの複数日案を比較し宿を維持する", hardConstraints: [], softPreferences: [], selectedAction: "answer",
      unresolvedFacts: [], reasonCodes: ["evidence_sufficient"], usedEvidenceIds: ["eval-evidence-1"],
    } }) }] }, stopReason: "end_turn", metadata: { modelId: "synthetic", latencyMs: 1, outputMode: "application_strict" } };
  }) };
  const search = syntheticSearchBinding();
  const agent = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model, weather: { search: vi.fn() }, newExecutionId: () => executionId, additionalTools: [search],
    diagnostics: { record: async event => { diagnostics.push(structuredClone(event)); } } });
  const turn = { principal: stateA, conversationId, turnId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", tripId: secondId, userRequest };
  const result = await agent.runConversationTurn(turn);

  const firstContextBlock = requests[0]!.messages[0]!.content.find(block => "text" in block)!;
  const modelContext = JSON.parse(("text" in firstContextBlock ? firstContextBlock.text : "").match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
  expect(modelContext.userRequest).toBe(userRequest);
  const discoveryResult = requests[1]!.messages.at(-1)?.content.find(block => "toolResult" in block);
  expect(discoveryResult).toMatchObject({ toolResult: { toolUseId: "discovery-1", status: "success" } });
  expect(result.publicPlanPresentation).toMatchObject({ version: "public-plan-presentation-v1", candidateOrder: ["normal", "rain"],
    candidateSetRef: { kind: "candidate-set-ref", candidateSetId: executionId, revision: 0, baseTripRevision: 0 }, target: { tripId: secondId, baseTripRevision: 0 } });
  expect(result.presentationReceipt).toMatchObject({ candidateSetRef: { candidateSetId: executionId }, entries: [{ ordinal: 1, candidateRef: "normal" }, { ordinal: 2, candidateRef: "rain" }] });
  expect(diagnostics.map(({ phase }) => phase)).toEqual(expect.arrayContaining(["context", "decision", "tool", "presentation", "save"]));
  expect(JSON.stringify(requests[1])).toContain("eval-evidence-1");
  expect((await state.conversations.history(stateA, conversationId)).items.at(-1)?.publicPlanPresentation).toEqual(result.publicPlanPresentation);
  expect((await trips.repository.get(stateA, secondId))?.items).toEqual(original.items);

  const candidateRepository = new DynamoDbItineraryCandidateRepository("test-trips", trips.client);
  const tripApplication = new TripApplication(trips.repository, trips.repository, trips.clock, { facts: async () => [] });
  const adoption = new PlanCandidateAdoptionApplication(candidateRepository, trips.repository, candidateRepository, tripApplication,
    (draft) => ({ id: `adopted-${draft.componentId}`, type: "activity", title: draft.title, category: "sightseeing", schedule: draft.schedule }), trips.clock.now);
  const adoptionRequest = { operation: "preview" as const, conversationId, candidateSetId: executionId, candidateSetRevision: 0,
    variantId: "rain", tripId: secondId, baseTripRevision: 0, mutationId };
  const preview = await adoption.execute(stateA, adoptionRequest);
  expect(preview).toMatchObject({ status: "confirmation-required", preview: { changes: { added: 1, replaced: 0, removed: 0 } } });
  if (preview.status !== "confirmation-required") throw new Error("preview required");
  const beforeAdoption = (await trips.repository.get(stateA, secondId))!;
  expect(() => boundedTrip(applyTripProposal(beforeAdoption, preview.preview.proposal))).not.toThrow();
  const adopted = await adoption.execute(stateA, { ...adoptionRequest, operation: "confirm" }, { confirmationKey: preview.confirmationKey });
  expect(adopted).toMatchObject({ status: "saved", revision: 1 });
  const readback = await trips.repository.get(stateA, secondId);
  expect(readback?.items.map(({ id }) => id)).toEqual(["hotel", "adopted-activity-rain"]);

  const activity = readback!.items.find(({ id }) => id === "adopted-activity-rain")!;
  await tripApplication.execute(stateA, { version: "trip-api-v1", operation: "mutate", tripId: secondId, baseRevision: 1, mutationId: replanMutationId,
    proposal: { tripId: secondId, baseRevision: 1, summary: "3日目だけ雨天向けに変更", patches: [{ type: "replace", itemId: activity.id,
      item: { ...activity, title: "3日目の屋内展示" } }] } });
  const replanned = await trips.repository.get(stateA, secondId);
  expect(replanned).toMatchObject({ revision: 2, items: [{ id: "hotel", title: "維持する宿" }, { id: "adopted-activity-rain", title: "3日目の屋内展示" }] });
  expect(replanned?.items).toHaveLength(2);
  const expected = parseEpic537FinalExpected(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../tests/fixtures/epic-537-final-eval/expected.json"), "utf8")));
  const expectedInvariants = expected.cases.find(({ caseId }) => caseId === "production-candidate-adopt-replan")!.requiredInvariantIds;
  expect(new Set(expectedInvariants)).toEqual(new Set(["production-loader-used", "raw-request-tail-preserved", "typed-presentation-retained",
    "explicit-adoption-confirmed", "readback-matches", "partial-replan-minimal"]));
});

function syntheticSearchBinding(): ServerAgentToolBinding {
  return {
    descriptor: { name: "search_eval_candidates", description: "複数観点で合成候補を検索する", inputSchema: { type: "object", additionalProperties: false,
      properties: { perspectives: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } } }, required: ["perspectives"] },
      outputSchema: { type: "object", additionalProperties: false, properties: { candidateRefs: { type: "array", items: { type: "string" } } }, required: ["candidateRefs"] } },
    operation: async () => ({ body: { candidateRefs: ["covered-walk", "indoor-gallery"] } }),
    evidence: (_output, context) => [{ id: "eval-evidence-1", category: "external", knowledgeKind: "deterministic_fact", subject: "合成旅行候補",
      facts: { candidateCount: 2, perspectives: ["area", "rain", "car-free"] }, references: [{ sourceType: "external-source", sourceRef: "fixture://epic-537/synthetic-discovery-v1",
        retrievedAt: context.retrievedAt, freshness: "current", summary: "Final Eval用の合成Provider観測" }], observation: { observationId: "eval-evidence-1",
        subjectKey: "eval-candidates", scopeKey: context.executionId, predicate: "candidate_discovery", retrievedAt: context.retrievedAt,
        applicability: "applicable", state: "current", retention: "reference_only" } }],
  };
}

function candidateToolInput() {
  const item = (componentId: string, title: string) => ({ componentId, kind: "activity", title,
    schedule: { type: "relative", dayId: "day-3", part: "afternoon" }, logicalDayId: "day-3", evidenceRefs: [], placement: { afterRef: "hotel" } });
  const variant = (id: string, label: string, componentId: string, title: string) => ({ id, label, timeline: { dayOrder: ["day-1", "day-2", "day-3", "day-4"], itemOrder: [componentId] },
    items: [item(componentId, title)], assumptionRefs: [], assessmentRefs: [], changedComponentIds: [componentId], removedBaseItemIds: [], retainedBaseItemIds: ["hotel"] });
  const publicCandidate = (id: string, label: string, componentId: string, title: string) => ({ variantId: id, label,
    dayOrder: ["day-1", "day-2", "day-3", "day-4"], days: ["day-1", "day-2", "day-3", "day-4"].map(dayRef => ({ dayRef, label: dayRef, status: dayRef === "day-3" ? "planned" : "free",
      entries: dayRef === "day-3" ? [{ entryRef: `entry-${id}`, itemRef: `item-${id}`, role: "visit" }] : [] })),
    items: [{ itemRef: `item-${id}`, sourceRef: componentId, title, kind: "activity", timing: "day", evidenceRefs: [], photoRefs: [] }], unknowns: [],
    workload: { status: "partial" }, cost: { status: "unknown" }, comparisonAssessmentRefs: [], scenarioRefs: ["rain"] });
  return { draft: { coverage: { coveredScopes: ["day-1", "day-2", "day-3", "day-4"], omittedScopes: [], complete: true }, variants: [
    variant("normal", "通常案", "activity-normal", "3日目の屋外散策"), variant("rain", "雨天案", "activity-rain", "3日目の屋内施設"),
  ] }, presentation: { version: "public-plan-presentation-v1", presentationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", candidateSetRef: { kind: "unavailable", reason: "not-retained" },
    candidateOrder: ["normal", "rain"], candidates: [publicCandidate("normal", "通常案", "activity-normal", "3日目の屋外散策"), publicCandidate("rain", "雨天案", "activity-rain", "3日目の屋内施設")],
    evidenceRefs: [], photoRefs: [], coverage: { status: "complete", coveredDayRefs: ["day-1", "day-2", "day-3", "day-4"], omittedDayRefs: [], omittedScopes: [] },
    statements: [{ kind: "proposal", ref: "activity-normal", evidenceRefs: [] }, { kind: "proposal", ref: "activity-rain", evidenceRefs: [] }], comparisonAssessmentRefs: [], scenarioRefs: ["rain"],
    researchOutcome: { status: "complete", requestedMode: "standard", effectiveMode: "standard", budget: { modelCalls: 3, toolCalls: 2, wallClockMs: 3 }, coveredScopes: ["day-1", "day-2", "day-3", "day-4"], remainingScopes: [] } } };
}
