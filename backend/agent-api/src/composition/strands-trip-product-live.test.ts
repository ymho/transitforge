import { createTrip } from "@raiquora/trip/trip";
import { describe, expect, it, vi } from "vitest";
import { stateDynamoFixture, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { productionServerTools } from "./production-server-tools.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

/** Paid opt-in: real Strands SDK and Bedrock, isolated Trip and fixed travel Providers.
 * Never logs the user's request, model reply, or raw Provider output. */
describe.skipIf(process.env.AGENT_V2_LIVE !== "true")("#758 Bedrock with fixed travel Providers", () => {
  const cases = [
    { id: "destination-interest", request: "出雲大社へ行ってみたい。何が魅力で、近くには何がありますか？", expected: "出雲大社" },
    { id: "experience-discovery", request: "歴史を感じられる場所をいくつか比べてから決めたいです。", expected: "歴史" },
    { id: "concrete-itinerary", request: "10月1日から2泊3日で出雲大社へ行きます。まず日ごとの仮旅程を提案してください。", expected: "出雲大社" },
  ] as const;
  it.each(cases)("assesses $id from public outcome, Evidence and persisted Trip state", async ({ id, request, expected }) => {
    const { verifier } = cognitoTokenFixture(), principal = await verifier.verify(token());
    const state = stateDynamoFixture(), trips = tripDynamoFixture(), tripId = stateMetadata().tripId;
    trips.seed(createTrip(tripId, "相談中の旅", "2026-09-28T00:00:00Z"), principal.subject);
    await state.conversations.create(principal, conversationId, stateMetadata());
    const url = "https://example.org/travel/izumo";
    const discovery = vi.fn(async () => ({ body: { discovery: { batch: { hits: [
      { hitId: "izumo", sourceRef: url, retrievalChannel: "web", text: "出雲大社と周辺を紹介", originalRank: 1 },
      { hitId: "history", sourceRef: "https://example.org/travel/history", retrievalChannel: "web", text: "歴史ある町並み", originalRank: 2 },
    ], coverage: { completedQueries: 1 }, incompleteReasons: [] } } } }));
    const readWebPages = vi.fn(async () => ({ webPages: { status: "available", freshness: "fresh", data: { pages: [
      { url, title: "出雲大社", text: "出雲大社と周辺の参拝先を紹介します。" },
      { url: "https://example.org/travel/history", title: "歴史ある町並み", text: "歴史ある場所を歩く候補です。" },
    ] }, evidence: [{ id: "page", provider: "fixture", sourceUrl: url, retrievedAt: new Date().toISOString() }] } }));
    const searchPlaceMedia = vi.fn(async () => ({ result: { status: "available", freshness: "fresh", data: { places: [
      { providerPlaceId: "izumo", name: "出雲大社", summary: "歴史ある神社", sourceUrl: url,
        openingHoursStatus: "unknown", image: { url: "https://example.org/photo/izumo.jpg",
          descriptionUrl: url, attribution: "Evaluation fixture", hotlinkAllowed: true } },
    ] }, evidence: [{ id: "place", provider: "fixture", sourceUrl: url, retrievedAt: new Date().toISOString() }] } }));
    const tools = productionServerTools({ discovery, external: { readWebPages, searchPlaceMedia },
      accommodation: vi.fn(), journey: vi.fn() });
    let executionCounts: { modelCalls?: number; toolCalls?: number; inputTokens?: number; outputTokens?: number } | undefined;
    const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client,
      tripClient: trips.client,
      diagnostics: { record: async event => { if (event.phase === "execution") executionCounts = event.counts; } },
      weather: { search: vi.fn() }, newExecutionId: () => `product-live-${id}`,
      runRuntime: createStrandsServerRuntime(new StrandsAgentEngine({ modelId: process.env.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0",
        region: process.env.AWS_REGION ?? "ap-northeast-1", systemPrompt: agentV2SystemPrompt, maxTurns: 8, maxOutputTokens: 1024 })),
      limits: { maxIterations: 8, maxModelCalls: 8, maxToolCalls: 4, maxExecutionMs: 60_000 }, additionalTools: tools });
    const turn = { principal, conversationId, turnId: "75800000-0000-4000-8000-000000000001", userRequest: request,
      uiContext: { calendarDate: "2026-09-28" } };
    const start = Date.now(), result = await app.runConversationTurn(turn);
    const saved = await trips.repository.get(principal, tripId);
    const reads = discovery.mock.calls.length + readWebPages.mock.calls.length + searchPlaceMedia.mock.calls.length;
    console.log(JSON.stringify({ scenario: id, status: result.status, durationMs: Date.now() - start, reads,
      modelCalls: executionCounts?.modelCalls ?? null, toolCalls: executionCounts?.toolCalls ?? null,
      inputTokens: executionCounts?.inputTokens ?? null, outputTokens: executionCounts?.outputTokens ?? null,
      cards: result.publicPlacePresentation?.cards.length ?? 0, planCandidates: result.publicPlanPresentation?.candidates.length ?? 0,
      tripRevision: saved?.revision, tripItems: saved?.items.length }));
    expect.soft(result.status).toBe("completed");
    expect.soft(saved?.items, "search/proposal must not silently adopt items").toEqual([]);
    expect.soft(result.response.length).toBeGreaterThan(0);
    if (id === "destination-interest" || id === "experience-discovery") {
      expect.soft(reads, "a useful answer requires a fixed Provider read").toBeGreaterThan(0);
      expect.soft(result.response + JSON.stringify(result.publicPlacePresentation?.cards ?? [])).toContain(expected);
    } else {
      expect.soft(result.publicPlanPresentation?.candidates.length ?? 0, "a concrete request needs a visible provisional plan").toBeGreaterThan(0);
    }
    const beforeReplay = discovery.mock.calls.length;
    expect(await app.runConversationTurn(turn)).toEqual(result);
    expect(discovery.mock.calls.length).toBe(beforeReplay);
    expect((await state.conversations.history(principal, conversationId)).items).toHaveLength(2);
  }, 90_000);
});
