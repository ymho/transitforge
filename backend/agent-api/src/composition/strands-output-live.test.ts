import { describe, expect, it, vi } from "vitest";
import { stateDynamoFixture, conversationId, secondId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { productionServerTools } from "./production-server-tools.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

/** Paid, explicit opt-in. Real SDK/Bedrock + synthetic providers/state, no production data or writes.
 * Four turns, at most 6 model cycles and 2 reads per turn; 24 cycles total per model.
 * Normal CI skips this lane. No scripted model is used here. */
const enabled = process.env.AGENT_V2_LIVE === "true";
const modelId = process.env.MODEL_ID ?? "amazon.nova-lite-v1:0";
describe.skipIf(!enabled)("V2 native structured output with real Bedrock", () => {
  it("handles greeting, destination, correction and unavailable save through Conversation/replay", async () => {
    const { verifier } = cognitoTokenFixture();
    const principal = await verifier.verify(token());
    const state = stateDynamoFixture(), trips = tripDynamoFixture();
    const { tripId: _tripId, ...metadata } = stateMetadata();
    await state.conversations.create(principal, conversationId, metadata);
    const calls: { query: string }[] = [];
    const searchPlaceMedia = vi.fn(async (input: { query: string }) => {
      calls.push({ query: input.query });
      const label = ["出雲大社", "清水寺"].find((name) => input.query.includes(name));
      if (!label) return { result: { status: "unavailable", freshness: "unknown", evidence: [] } };
      const id = label === "出雲大社" ? "izumo" : "kiyomizu", sourceUrl = `https://example.org/evaluation/${id}`;
      return { result: { status: "available", freshness: "fresh", data: { places: [{ providerPlaceId: id, name: label,
        summary: "散策の対象となる場所です。これは接続検証用の固定資料です。", sourceUrl, openingHoursStatus: "unknown" }] },
        evidence: [{ id: `source-${id}`, provider: "fixture", sourceUrl, retrievedAt: new Date().toISOString() }] } };
    });
    const v1 = { converse: vi.fn(async () => { throw new Error("V1 must not run"); }) };
    let execution = 0;
    const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
      diagnostics: { record: async ({ phase, reason, mode }) => { console.log(JSON.stringify({ phase, reason, mode })); } },
      model: v1, weather: { search: vi.fn() }, newExecutionId: () => `native-live-${++execution}`,
      limits: { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 2, maxExecutionMs: 60000 },
      runRuntime: createStrandsServerRuntime(new StrandsAgentEngine({ modelId, region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt,
        maxTurns: 6, maxOutputTokens: 1024 })),
      additionalTools: productionServerTools({ external: { searchPlaceMedia }, accommodation: vi.fn(), journey: vi.fn() }) });
    const messages = ["おはよう", "出雲大社にいきたい", "やっぱり清水寺に行きたい。候補カードを見せて", "この候補を保存して"];
    const reports: object[] = [];
    for (const [index, userRequest] of messages.entries()) {
      const turnId = `72200000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const started = Date.now(), before = calls.length;
      const result = await app.runConversationTurn({ principal, conversationId, turnId, userRequest });
      const working = await new DynamoDbConversationTurnRepository("test-state", state.client).getWorkingState(principal, conversationId);
      reports.push({ case: index, status: result.status, reads: calls.length - before, cards: result.publicPlacePresentation?.cards.length ?? 0,
        intentRevision: working?.semantic?.overlay.intentRevision ?? 0, durationMs: Date.now() - started });
      console.log(JSON.stringify({ modelId, ...reports.at(-1) }));
      expect(result.status).toBe("completed");
      const beforeReplay = calls.length;
      expect(await app.runConversationTurn({ principal, conversationId, turnId, userRequest })).toEqual(result);
      expect(calls.length).toBe(beforeReplay);
      if (index === 0) expect(calls).toHaveLength(0);
      if (index === 1) {
        expect(working?.semantic?.overlay.intentRevision).toBe(1);
        expect(calls.length).toBeGreaterThan(before);
      }
      if (index === 2) {
        expect(working?.semantic?.overlay.intentRevision).toBe(2);
        expect(result.publicPlacePresentation?.cards.map(({ title }) => title)).toContain("清水寺");
        expect(result.publicPlacePresentation?.cards.some(({ title }) => title.includes("出雲大社"))).toBe(false);
      }
      if (index === 3) expect(result.response).toContain("保存は行っていません");
    }
    expect(v1.converse).not.toHaveBeenCalled();
    const history = await state.conversations.history(principal, conversationId);
    expect(history.items).toHaveLength(8);
    expect(history.items[5]?.publicPlacePresentation?.cards.map(({ title }) => title)).toContain("清水寺");
  }, 280000);
});
