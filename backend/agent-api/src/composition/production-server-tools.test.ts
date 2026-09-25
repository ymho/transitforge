import { expect, it, vi } from "vitest";
import { BedrockConversationModel } from "../adapters/bedrock-conversation-model.js";
import { createTrip } from "@raiquora/trip/trip";
import { createFixedEgressProviderHandler } from "../adapters/fixed-egress-provider-handler.js";
import { createFixedEgressAccommodationOperation } from "./fixed-egress-accommodation.js";
import { productionServerTools } from "./production-server-tools.js";
import { hasStructuredPresentationEvidence } from "@raiquora/agent/grounded-answer";
import { createProductionConversationAgent } from "./production-conversation-agent.js";
import { stateDynamoFixture, stateA, conversationId, secondId } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
const evidenceContext = { retrievedAt: "2026-09-25T00:00:00Z", queryFingerprint: "history",
  executionId: "consultation", toolCallId: "tool-1", toolName: "search_travel_knowledge" };

it("materializes discovery leads into verified page evidence in the same tool round", async () => {
  const url = "https://example.org/kurashiki";
  const readWebPages = vi.fn(async () => ({ webPages: { status: "available", freshness: "fresh",
    data: { pages: [{ url, title: "倉敷観光案内", text: "白壁の町並みを散策できます。" }] },
    evidence: [{ id: "page-1", provider: "safe-reader", sourceUrl: url }] } }));
  const discovery = vi.fn(async () => ({ body: { discovery: { batch: { hits: [{ hitId: "hit-1", sourceRef: url,
    retrievalChannel: "web", text: "検索で見つかった候補", originalRank: 1 }] } } } }));
  const tools = productionServerTools({ external: { readWebPages }, discovery, accommodation: vi.fn(), journey: vi.fn() });
  const search = tools.find((tool) => tool.descriptor.name === "search_travel_knowledge")!;
  const response = await search.operation({}, { requestId: "consultation" });
  const evidence = search.evidence(response.body, evidenceContext);
  expect(readWebPages).toHaveBeenCalledWith({ urls: [url] });
  expect(evidence.filter(hasStructuredPresentationEvidence)).toHaveLength(1);
  expect(evidence.find((item) => item.knowledgeKind === "unverified_information")).toBeDefined();
  expect(evidence.find(hasStructuredPresentationEvidence)?.facts.sourceExcerpt).toContain("白壁の町並み");
});

it("never promotes discovery snippets into verified travel plans when the page read fails", async () => {
  const tools = productionServerTools({ external: { readWebPages: vi.fn(async () => { throw Error("unavailable"); }) },
    discovery: vi.fn(async () => ({ body: { discovery: { batch: { hits: [{ hitId: "hit-1", sourceRef: "https://example.org/lead",
      retrievalChannel: "web", text: "検索結果" }] } } } })), accommodation: vi.fn(), journey: vi.fn() });
  const search = tools.find((tool) => tool.descriptor.name === "search_travel_knowledge")!;
  const response = await search.operation({}, { requestId: "consultation" });
  const evidence = search.evidence(response.body, evidenceContext);
  expect(evidence).toHaveLength(1);
  expect(evidence.some(hasStructuredPresentationEvidence)).toBe(false);
});

it("reads search_web hits before presenting them as verified sources", async () => {
  const url = "https://example.org/history";
  const tools = productionServerTools({ external: { searchWeb: vi.fn(async () => ({ webSearch: { status: "available", freshness: "fresh",
    data: { query: "歴史", results: [{ id: "hit", title: "歴史", url, description: "候補" }] },
    evidence: [{ id: "search-hit", provider: "web", sourceUrl: url }] } })),
  readWebPages: vi.fn(async () => ({ webPages: { status: "available", freshness: "fresh",
    data: { pages: [{ url, title: "観光資料", text: "歴史的な町並みを紹介しています。" }] },
    evidence: [{ id: "read-page", provider: "safe-reader", sourceUrl: url }] } })) }, accommodation: vi.fn(), journey: vi.fn() });
  const search = tools.find((tool) => tool.descriptor.name === "search_web")!;
  const response = await search.operation({ query: "歴史" }, { requestId: "consultation" });
  const evidence = search.evidence(response.body, { ...evidenceContext, toolName: "search_web" });
  expect(evidence.filter(hasStructuredPresentationEvidence)).toHaveLength(1);
  expect(evidence.find(hasStructuredPresentationEvidence)?.facts.sourcePrecision).toBe("read-page");
});

it("compares only a verified journey result from the same server turn", async () => {
  const result = { serviceDate: "2026-09-24", originStation: "京都", destinationStation: "出雲市", searchTimeMinutes: 480, totalMatchCount: 1, matches: [], journeys: [{ departureTimeMinutes: 480, arrivalTimeMinutes: 720, transferCount: 1, legs: [{ serviceUid: "s1", trainNumber: "1M", serviceType: "特急", trainName: "やくも", originStation: "岡山", destinationStation: "出雲市", departureTimeMinutes: 540, arrivalTimeMinutes: 720, scheduledDepartureTimeMinutes: 540, scheduledArrivalTimeMinutes: 720, delayMinutes: 0 }] }] };
  const captured: typeof result[] = [];
  const bindings = productionServerTools({ external: {}, accommodation: vi.fn(), journey: vi.fn(async () => ({ body: result })), onJourneyResult: value => captured.push(value as typeof result) });
  const search = bindings.find(binding => binding.descriptor.name === "search_journeys")!;
  const searched = await search.operation({}, { requestId: "execution" });
  expect(searched.body.searchResultId).toBe("journey-search-1"); expect(captured).toHaveLength(1);
  const compare = bindings.find(binding => binding.descriptor.name === "compare_journeys")!;
  await expect(compare.operation({ searchResultId: "foreign" }, { requestId: "execution" })).resolves.toMatchObject({ statusCode: 404 });
  await expect(compare.operation({ searchResultId: "journey-search-1" }, { requestId: "execution" })).resolves.toMatchObject({ body: { source: "verified-journey-search-result", candidates: [{ candidateId: "journey-1" }] } });
});

it("restores a Trip without Profile, invokes fixed-egress through the existing operation, and persists the grounded final", async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  await trips.repository.create(stateA, createTrip(secondId, "server trip", "2026-09-18T00:00:00Z"));
  const search = vi.fn(async () => [{ kind: "accommodation" as const, provider: "travel-provider", providerItemId: "42", name: "宿",
    checkInDate: "2026-10-01", checkOutDate: "2026-10-02", availability: "unknown" as const }]);
  const provider = createFixedEgressProviderHandler({ search });
  const invoke = vi.fn(async (input: { Payload: Uint8Array }) => ({ StatusCode: 200,
    Payload: new TextEncoder().encode(JSON.stringify(await provider(JSON.parse(new TextDecoder().decode(input.Payload))))) }));
  const converse = vi.fn(async () => converse.mock.calls.length === 1
    ? { output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "accommodation", name: "search_accommodations",
      input: { destination: "京都", checkInDate: "2026-10-01", checkOutDate: "2026-10-02" } } }] } }, stopReason: "tool_use" }
    : { output: { message: { role: "assistant", content: [{ text: JSON.stringify({ kind: "answer", responseText: "候補の宿を確認しました。空室は未確認です。",
      evidenceIds: ["observation:execution:accommodation:search_accommodations:q-8232276c:accommodation:travel-provider:42"] }) }] } }, stopReason: "end_turn" });
  const app = createProductionConversationAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model: new BedrockConversationModel({ converse }, { modelId: "test", systemPrompt: "test" }), weather: { search: vi.fn() }, newExecutionId: () => "execution",
    additionalTools: productionServerTools({ external: {}, accommodation: createFixedEgressAccommodationOperation("provider-arn", { invoke }), journey: vi.fn() }),
  });
  const request = { principal: stateA, conversationId, turnId: secondId, tripId: secondId, userRequest: "京都の宿を調べたい" };
  const final = await app.runConversationTurn(request);
  expect(final.response).toContain("宿泊候補「宿」"); expect(final.response).not.toContain("decision_summary");
  expect(invoke).toHaveBeenCalledTimes(1); expect(search).toHaveBeenCalledWith(expect.objectContaining({ destination: "京都", adults: 1 }), "execution");
  expect(JSON.stringify(converse.mock.calls)).toContain("server trip");
  expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/principal|Bearer|profile/);
  expect((await state.conversations.history(stateA, conversationId)).items.map(m => m.role)).toEqual(["user", "assistant"]);
  expect(await app.runConversationTurn(request)).toEqual(final); expect(invoke).toHaveBeenCalledTimes(1); expect(converse).toHaveBeenCalledTimes(2);
});
