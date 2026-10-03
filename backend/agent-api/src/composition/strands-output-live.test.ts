import { admitAgentV2Reply, agentV2CandidateReferences } from "@raiquora/agent/agent-v2-publication";
import { createTrip } from "@raiquora/trip/trip";
import { describe, expect, it, vi } from "vitest";
import { Agent, BeforeToolCallEvent, ModelMessageEvent, ToolResultEvent } from "@strands-agents/sdk";
import { placeConditionUpdateInputSchema } from "@raiquora/agent/conversation-condition";
import { stateDynamoFixture, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { productionServerTools } from "./production-server-tools.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

function fixedDestinationProviders() {
  const calls: { query: string }[] = [];
  const source = (label: string) => `https://example.org/evaluation/${label === "出雲大社" ? "izumo" : "kiyomizu"}`;
  const discovery = vi.fn(async (input: { facets?: { value: string }[] }) => {
    const label = ["出雲大社", "清水寺"].find(name => input.facets?.some(facet => facet.value.includes(name)));
    return { body: { discovery: { batch: { hits: label ? [{ hitId: `fixture-${label}`, sourceRef: source(label),
      retrievalChannel: "web", text: label, originalRank: 1 }] : [], coverage: { completedQueries: 1 }, incompleteReasons: [] } } } };
  });
  const readWebPages = vi.fn(async (input: { urls: string[] }) => ({ webPages: {
    status: "available", freshness: "fresh", data: { pages: input.urls.flatMap(url => {
      const label = ["出雲大社", "清水寺"].find(name => source(name) === url);
      return label ? [{ url, title: label, text: `${label}は散策の対象となる場所です。これは接続検証用の固定資料です。` }] : [];
    }) }, evidence: input.urls.map(url => ({ id: `fixture-page-${url}`, provider: "fixture", sourceUrl: url, retrievedAt: new Date().toISOString(), validUntil: "2099-10-03T00:00:00Z" })),
  } }));
  const searchPlaceMedia = vi.fn(async (input: { query: string }) => {
    calls.push({ query: input.query });
    const label = ["出雲大社", "清水寺"].find((name) => input.query.includes(name));
    if (!label) return { result: { status: "unavailable", freshness: "unknown", evidence: [] } };
    const id = label === "出雲大社" ? "izumo" : "kiyomizu", sourceUrl = `https://places.example/evaluation/${id}`;
    return { result: { status: "available", freshness: "fresh", data: { places: [{ providerPlaceId: id, name: label,
      summary: "散策の対象となる場所です。これは接続検証用の固定資料です。", sourceUrl, officialWebsiteUrl: source(label), openingHoursStatus: "unknown" }] },
      evidence: [{ id: `source-${id}`, provider: "fixture", sourceUrl, retrievedAt: new Date().toISOString(), validUntil: "2099-10-03T00:00:00Z" }] } };
  });
  return { calls, discovery, readWebPages, searchPlaceMedia };
}

it.each(["出雲大社", "清水寺"])("fixed purpose Providers offer a publishable %s card before any model call", async destination => {
  const providers = fixedDestinationProviders();
  const binding = productionServerTools({ external: providers, discovery: providers.discovery, accommodation: vi.fn(), journey: vi.fn() })
    .find(({ descriptor }) => descriptor.name === "explore_destination")!;
  const response = await binding.operation({ destination }, { requestId: "synthetic-fixture" });
  const evidence = binding.evidence(response.body, { executionId: "synthetic-fixture", toolCallId: "read-1", toolName: "explore_destination",
    queryFingerprint: "synthetic", retrievedAt: "2026-10-03T00:00:00Z" });
  const candidates = agentV2CandidateReferences(evidence);
  expect(candidates).toHaveLength(1);
  const reply = admitAgentV2Reply({ kind: "candidates", evidenceIds: candidates.map(({ evidenceId }) => evidenceId), commentary: "確認した候補です。" },
    { executionId: "synthetic-fixture", evidence });
  expect(reply.publicPlacePresentation?.cards.map(({ title }) => title)).toEqual([destination]);
});

/** Paid opt-in: real SDK/Bedrock + fixed Providers and fixture state, never production data.
 * Four turns, 6 model cycles/2 reads/60 seconds/4096 output tokens per turn. All semantic failures remain
 * test failures; soft assertions let later turns be measured without hiding them. */
const enabled = process.env.AGENT_V2_LIVE === "true";
const modelId = process.env.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0";
const toolsToObserve = new Set(["update_current_origin", "update_current_destination", "explore_destination", "search_place_media", "strands_structured_output"]);
describe.skipIf(!enabled)("V2 native structured output with real Bedrock", () => {
  it("handles greeting, destination, correction and unavailable save through Conversation/replay", async () => {
    const { verifier } = cognitoTokenFixture();
    const principal = await verifier.verify(token());
    const state = stateDynamoFixture(), trips = tripDynamoFixture();
    const metadata = stateMetadata();
    trips.seed(createTrip(stateMetadata().tripId, "検討中の旅", "2026-09-18T00:00:00Z"), principal.subject);
    await state.conversations.create(principal, conversationId, metadata);
    const { calls, discovery, readWebPages, searchPlaceMedia } = fixedDestinationProviders();
    const v1 = { converse: vi.fn(async () => { throw new Error("V1 must not run"); }) };
    let execution = 0;
    const engine = new StrandsAgentEngine({ modelId, region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt,
      maxTurns: 6, maxOutputTokens: 4096, maxInvocationOutputTokens: 4096,
      ...(modelId === "jp.amazon.nova-2-lite-v1:0" ? { novaReasoningEffort: "low" as const } : {}) }, { createAgent: config => {
      const agent = new Agent(config);
      // Read-only SDK hooks for this synthetic live lane; never alter input, Tools,
      // retries or termination. No user text, IDs, raw Tool data or reasoning is logged.
      console.log(JSON.stringify({ phase: "sdk-tools", names: agent.tools.map(({ name }) => name).filter(name => toolsToObserve.has(name)) }));
      agent.addHook(ModelMessageEvent, ({ stopReason, message }) => {
        console.log(JSON.stringify({ phase: "sdk-model", stopReason,
          tools: message.content.flatMap(block => block.type === "toolUseBlock" && toolsToObserve.has(block.name) ? [block.name] : []) }));
      });
      agent.addHook(BeforeToolCallEvent, ({ toolUse }) => {
        if (!["update_current_origin", "update_current_destination"].includes(toolUse.name)) return;
        console.log(JSON.stringify({ phase: "sdk-condition-input", valid: placeConditionUpdateInputSchema.safeParse(toolUse.input).success }));
      });
      agent.addHook(ToolResultEvent, ({ result }) => {
        const block = result.content.find(item => item.type === "jsonBlock");
        const payload = block?.type === "jsonBlock" && block.json && typeof block.json === "object" ? block.json as Record<string, unknown> : undefined;
        const error = payload?.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : undefined;
        const code = ["invalid_condition", "invalid_source", "condition_conflict", "condition_unavailable", "invalid_input", "precondition_failed"].includes(String(error?.code)) ? error?.code : undefined;
        console.log(JSON.stringify({ phase: "sdk-tool-result", status: result.status, code,
          candidateCount: Array.isArray(payload?.candidateReferences) ? payload.candidateReferences.length : undefined }));
      });
      return agent;
    } });
    const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
      diagnostics: { record: async ({ phase, reason, mode }) => { console.log(JSON.stringify({ phase, reason, mode })); } },
      model: v1, weather: { search: vi.fn() }, newExecutionId: () => `native-live-${++execution}`,
      limits: { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 2, maxExecutionMs: 60000 },
      runRuntime: createStrandsServerRuntime(engine),
      // Use the production purpose read and its source/media projection. The
      // prompt calls explore_destination; a media-only fixture hides that contract.
      additionalTools: productionServerTools({ external: { searchPlaceMedia, readWebPages }, discovery, accommodation: vi.fn(), journey: vi.fn() })
        .filter(({ descriptor }) => ["explore_destination", "search_place_media"].includes(descriptor.name)) });
    const messages = ["おはよう", "出雲大社にいきたい", "やっぱり清水寺に行きたい。候補カードを見せて", "この候補を保存して"];
    let successfulTurns = 0;
    for (const [index, userRequest] of messages.entries()) {
      const turnId = `72200000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const started = Date.now(), before = calls.length;
      let result;
      try { result = await app.runConversationTurn({ principal, conversationId, turnId, userRequest }); }
      catch {
        console.log(JSON.stringify({ modelId, case: index, status: "execution_failed", durationMs: Date.now() - started }));
        expect.soft(false, `case ${index} must complete`).toBe(true);
        continue;
      }
      successfulTurns += 1;
      const working = await new DynamoDbConversationTurnRepository("test-state", state.client).getWorkingState(principal, conversationId);
      const savedTrip = await trips.repository.get(principal, stateMetadata().tripId);
      console.log(JSON.stringify({ modelId, case: index, status: result.status, reads: calls.length - before,
        cards: result.publicPlacePresentation?.cards.length ?? 0, intentRevision: working?.semantic?.overlay.intentRevision ?? 0,
        tripRevision: savedTrip?.revision,
        durationMs: Date.now() - started }));
      expect.soft(result.status).toBe("completed");
      const beforeReplay = calls.length;
      expect(await app.runConversationTurn({ principal, conversationId, turnId, userRequest })).toEqual(result);
      expect(calls.length).toBe(beforeReplay);
      if (index === 0) expect.soft(calls).toHaveLength(0);
      if (index === 1) {
        expect.soft(savedTrip?.request.constraints.some(({ requirement }) => requirement.type === "destinations" &&
          requirement.places.some(({ name }) => name === "出雲大社")), "initial destination must be adopted into Trip").toBe(true);
        expect.soft(working?.semantic?.overlay.facts.some(({ target }) => target === "destination"),
          "adopted destination must not remain as a second authority").toBe(false);
      }
      if (index === 2) {
        expect.soft(savedTrip?.request.constraints.filter(({ requirement }) => requirement.type === "destinations")
          .flatMap(({ requirement }) => requirement.type === "destinations" ? requirement.places.map(({ name }) => name) : []),
        "destination correction must replace the Trip condition").toEqual(["清水寺"]);
        expect.soft(working?.semantic?.overlay.facts.some(({ target }) => target === "destination"),
          "adopted correction must not remain as a second authority").toBe(false);
        expect.soft(result.publicPlacePresentation?.cards.map(({ title }) => title)).toContain("清水寺");
        expect.soft(result.publicPlacePresentation?.cards.some(({ title }) => title.includes("出雲大社"))).toBe(false);
      }
      if (index === 3) expect.soft(savedTrip?.items, "an unavailable save must not mutate the Trip itinerary").toEqual([]);
    }
    expect(v1.converse).not.toHaveBeenCalled();
    const history = await state.conversations.history(principal, conversationId);
    expect.soft(successfulTurns).toBe(4);
    expect.soft(history.items).toHaveLength(8);
    expect.soft(history.items[5]?.publicPlacePresentation?.cards.map(({ title }) => title)).toContain("清水寺");
  }, 280000);
});

// Regression for the reported three-turn path. Fixed Providers/state, production
// SDK/prompt/proposal Tool, unchanged 4096 cumulative output budget.
describe.skipIf(!enabled)("V2 itinerary proposal conversation with real Bedrock", () => {
  it("accepts destination and one night, then retains and displays the requested plan", async () => {
    const { verifier } = cognitoTokenFixture(), principal = await verifier.verify(token());
    const state = stateDynamoFixture(), trips = tripDynamoFixture(), metadata = stateMetadata();
    trips.seed(createTrip(metadata.tripId, "検討中の旅", "2026-10-03T00:00:00Z"), principal.subject);
    await state.conversations.create(principal, conversationId, metadata);
    const providers = fixedDestinationProviders();
    let execution = 0;
    const observed = new Set(["draft_itinerary", "explore_destination", "update_current_destination", "update_current_travel_period", "strands_structured_output"]);
    const engine = new StrandsAgentEngine({ modelId, region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt,
      maxTurns: 6, maxOutputTokens: 4096, maxInvocationOutputTokens: 4096,
      ...(modelId === "jp.amazon.nova-2-lite-v1:0" ? { novaReasoningEffort: "low" as const } : {}) }, {
      createAgent: config => {
        const agent = new Agent(config);
        agent.addHook(BeforeToolCallEvent, ({ toolUse }) => {
          if (!observed.has(toolUse.name)) return;
          const input = toolUse.input as Record<string, unknown>;
          console.log(JSON.stringify({ phase: "itinerary-tool", name: toolUse.name,
            ...(toolUse.name === "draft_itinerary" ? { hasDraft: !!input.draft, hasPresentation: !!input.presentation,
              inputBytes: Buffer.byteLength(JSON.stringify(input)) } : {}) }));
        });
        return agent;
      },
    });
    const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
      model: { converse: vi.fn(async () => { throw Error("legacy runtime called"); }) }, weather: { search: vi.fn() },
      newExecutionId: () => `itinerary-live-${++execution}`, runRuntime: createStrandsServerRuntime(engine),
      limits: { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 2, maxExecutionMs: 60000 },
      diagnostics: { record: async event => {
        if (event.phase === "execution") console.log(JSON.stringify({ phase: "itinerary-execution", reason: event.reason, counts: event.counts }));
        if (event.phase === "tool") console.log(JSON.stringify({ phase: "itinerary-tool-result", name: observed.has(event.refs?.[0] ?? "") ? event.refs![0] : "other",
          reason: event.reason, code: event.toolErrorCode }));
      } },
      additionalTools: productionServerTools({ external: providers, discovery: providers.discovery, accommodation: vi.fn(), journey: vi.fn() })
        .filter(({ descriptor }) => ["explore_destination", "search_place_media"].includes(descriptor.name)) });
    for (const [index, userRequest] of ["出雲大社にいきたい", "明日から1泊で行きたい", "はい、作成お願いします。"].entries()) {
      const turn = { principal, conversationId, turnId: `78300000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        userRequest, uiContext: { calendarDate: "2026-10-03" } };
      const result = await app.runConversationTurn(turn);
      console.log(JSON.stringify({ phase: "itinerary-turn", index, status: result.status,
        candidates: result.publicPlanPresentation?.candidates.length ?? 0 }));
      expect(result.status).toBe("completed");
      const saved = await trips.repository.get(principal, metadata.tripId);
      expect(saved?.items).toEqual([]);
      expect(await app.runConversationTurn(turn)).toEqual(result);
      if (index === 2) {
        const plan = result.publicPlanPresentation;
        expect(plan?.candidateSetRef.kind).toBe("candidate-set-ref");
        expect(plan?.candidates.length).toBeGreaterThan(0);
        expect(plan!.candidates[0]!.days.length).toBeGreaterThanOrEqual(2);
        expect(plan!.candidates[0]!.items.some(item => item.title.includes("出雲大社"))).toBe(true);
        expect(plan!.candidates[0]!.unknowns.length).toBeGreaterThan(0);
      }
    }
    expect((await state.conversations.history(principal, conversationId)).items).toHaveLength(6);
  }, 210_000);
});
