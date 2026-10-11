import { describe, expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { stateDynamoFixture, stateA, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { StrandsAgentEngine, strandsProductionReasoning } from "../adapters/strands-agent-engine.js";
import { StrandsScriptedModel } from "../adapters/strands-scripted-model.fixture.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createProductionConversationAgent } from "./production-conversation-agent.js";
import { productionServerTools } from "./production-server-tools.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";
import { serviceAreaSearchScope } from "../usecases/service-area.js";

/** Paid opt-in, two independent requests, at most 20 model calls/300 seconds.
 * The production prompt, SDK, conditions, capabilities and budgets are retained.
 * All storage and travel Providers are fixed fixtures. No production account is touched.
 * Only closed diagnostic fields are printed, never request/reply/Tool input/reasoning. */
const live = process.env.AGENT_V2_LIVE === "true";
describe(`production model-loop diagnosis (${live ? "Bedrock" : "scripted SDK"})`, () => {
  it.each(["verified", "no_candidates"] as const)("finishes the day-trip request with %s research", async scenario => {
    const state = stateDynamoFixture(), trips = tripDynamoFixture(), metadata = stateMetadata();
    const now = "2026-10-11T06:08:00Z", sourceUrl = "https://example.org/model-loop-fixture";
    const urls = Array.from({ length: 12 }, (_, index) => `${sourceUrl}-${index}`);
    let mediaCalls = 0;
    trips.seed(createTrip(metadata.tripId, "明日日帰りで城崎温泉にいきたい", now), stateA.subject);
    await state.conversations.create(stateA, conversationId, metadata);
    const discovery = vi.fn(async () => ({ body: { discovery: { batch: { hits: scenario === "verified" ? urls.map((sourceRef, index) => ({
      hitId: `fixture-${index}`, sourceRef, retrievalChannel: "web", text: "城崎温泉", originalRank: index + 1,
    })) : [], coverage: { completedQueries: 6 }, incompleteReasons: [] } } } }));
    const bindings = productionServerTools({ discovery, external: {
      readWebPages: vi.fn(async ({ urls }: { urls: string[] }) => ({ webPages: { status: "available", freshness: "fresh", data: {
        pages: urls.map(url => ({ url, title: "城崎温泉", text: "城崎温泉は外湯めぐりを楽しめる温泉地です。検証用の固定資料です。" })),
      }, evidence: urls.map((sourceUrl, index) => ({ id: `fixture-page-${index}`, provider: "fixture", sourceUrl, retrievedAt: now })) } })),
      searchPlaceMedia: vi.fn(async () => ({ result: { status: "available", freshness: "fresh", data: { places: urls.slice(0, 4).map((officialWebsiteUrl, index) => ({
        providerPlaceId: `fixture-place-${index}`, name: "城崎温泉", summary: "外湯めぐりを楽しめる温泉地です。検証用の固定資料です。",
        sourceUrl: "https://www.mapbox.com/", officialWebsiteUrl, openingHoursStatus: "unknown",
      })) }, evidence: [{ id: `fixture-place-${++mediaCalls}`, provider: "fixture", sourceUrl: "https://www.mapbox.com/", retrievedAt: now }] } })),
    }, accommodation: vi.fn(async () => ({ statusCode: 503, body: { code: "unavailable" } })),
    journey: vi.fn(async () => ({ statusCode: 503, body: { code: "unavailable" } })) });
    const modelId = process.env.MODEL_ID ?? "jp.anthropic.claude-sonnet-4-6";
    const engine = new StrandsAgentEngine({ modelId, region: "ap-northeast-1", maxTurns: 10,
      maxOutputTokens: 4096, maxInvocationOutputTokens: 8192, ...strandsProductionReasoning(modelId),
      systemPrompt: `${agentV2SystemPrompt}\nSERVICE AREA: The service accepts travel searches only in Japan, within these prefectures: ${serviceAreaSearchScope.prefectures.join("、")}. Do not recommend candidates elsewhere or invent candidates excluded by Tools. An empty filtered response does not prove that no facilities exist. This product boundary is separate from actual rail/OTP coverage.`,
      log: (event, { executionId: _executionId, ...fields }) => console.log(JSON.stringify({ scenario, event, ...fields })),
    }, live ? {} : { model: new StrandsScriptedModel([
      { name: "update_current_travel_period", input: { action: "set", quote: "明日日帰り", period: {
        start: { kind: "relative_date", relation: "tomorrow" }, duration: { amount: 1, unit: "days" },
      } } },
      { name: "update_current_destination", input: { action: "set", quote: "城崎温泉", place: "城崎温泉" } },
      { name: "explore_destination", input: { destination: "城崎温泉" } },
      { name: "strands_structured_output", input: { reply: { kind: "clarification", target: "origin" } } },
    ]) });
    const app = createProductionConversationAgent({ stateTable: "test-state", tripTable: "test-trips",
      stateClient: state.client, tripClient: trips.client, weather: { search: vi.fn() }, additionalTools: bindings,
      newExecutionId: () => "89900000-2222-4000-8000-000000000001", runRuntime: createStrandsServerRuntime(engine),
      limits: { maxIterations: 10, maxModelCalls: 14, maxToolCalls: 16, maxExecutionMs: 150000 },
    });
    let completed = false;
    try {
      const result = await app.runConversationTurn({ principal: stateA, conversationId, tripId: metadata.tripId,
        turnId: "89900000-1111-4000-8000-000000000001", userRequest: "明日日帰りで城崎温泉にいきたい",
        uiContext: { calendarDate: "2026-10-11" } });
      completed = result.status === "completed";
    } catch { /* Failure details are already emitted by bounded engine diagnostics. */ }
    console.log(JSON.stringify({ event: "model_loop_case", scenario, completed, researchCalls: discovery.mock.calls.length }));
    expect(completed, "production-shaped request must complete").toBe(true);
  }, 170000);
});
