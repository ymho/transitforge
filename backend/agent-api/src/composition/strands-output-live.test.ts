import { describe, expect, it, vi } from "vitest";
import { Agent, BeforeToolCallEvent, ModelMessageEvent, ToolResultEvent } from "@strands-agents/sdk";
import { placeConditionInputSchema, clearConditionInputSchema } from "@raiquora/agent/conversation-condition";
import { stateDynamoFixture, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { productionServerTools } from "./production-server-tools.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

/** Paid opt-in: real SDK/Bedrock + fixed Providers and fixture state, never production data.
 * Four turns, 6 model cycles/2 reads/60 seconds per turn. All semantic failures remain
 * test failures; soft assertions let later turns be measured without hiding them. */
const enabled = process.env.AGENT_V2_LIVE === "true";
const modelId = process.env.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0";
const toolsToObserve = new Set(["set_origin", "set_destination", "clear_origin", "clear_destination", "search_place_media", "strands_structured_output"]);
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
    const engine = new StrandsAgentEngine({ modelId, region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt,
      maxTurns: 6, maxOutputTokens: 1024 }, { createAgent: config => {
      const agent = new Agent(config);
      // Read-only SDK hooks for this synthetic live lane; never alter input, Tools,
      // retries or termination. No user text, IDs, raw Tool data or reasoning is logged.
      console.log(JSON.stringify({ phase: "sdk-tools", names: agent.tools.map(({ name }) => name).filter(name => toolsToObserve.has(name)) }));
      agent.addHook(ModelMessageEvent, ({ stopReason, message }) => {
        console.log(JSON.stringify({ phase: "sdk-model", stopReason,
          tools: message.content.flatMap(block => block.type === "toolUseBlock" && toolsToObserve.has(block.name) ? [block.name] : []) }));
      });
      agent.addHook(BeforeToolCallEvent, ({ toolUse }) => {
        if (!["set_origin", "set_destination", "clear_origin", "clear_destination"].includes(toolUse.name)) return;
        const schema = toolUse.name.startsWith("clear_") ? clearConditionInputSchema : placeConditionInputSchema;
        console.log(JSON.stringify({ phase: "sdk-condition-input", valid: schema.safeParse(toolUse.input).success }));
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
      // Isolate the model/contract with a real production read, not empty unrelated Provider stubs.
      additionalTools: productionServerTools({ external: { searchPlaceMedia }, accommodation: vi.fn(), journey: vi.fn() })
        .filter(({ descriptor }) => descriptor.name === "search_place_media") });
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
      console.log(JSON.stringify({ modelId, case: index, status: result.status, reads: calls.length - before,
        cards: result.publicPlacePresentation?.cards.length ?? 0, intentRevision: working?.semantic?.overlay.intentRevision ?? 0,
        durationMs: Date.now() - started }));
      expect.soft(result.status).toBe("completed");
      const beforeReplay = calls.length;
      expect(await app.runConversationTurn({ principal, conversationId, turnId, userRequest })).toEqual(result);
      expect(calls.length).toBe(beforeReplay);
      if (index === 0) expect.soft(calls).toHaveLength(0);
      if (index === 1) {
        expect.soft(working?.semantic?.overlay.intentRevision, "initial destination must be accepted").toBe(1);
        expect.soft(calls.length).toBeGreaterThan(before);
      }
      if (index === 2) {
        expect.soft(working?.semantic?.overlay.intentRevision, "destination correction must be accepted").toBe(2);
        expect.soft(result.publicPlacePresentation?.cards.map(({ title }) => title)).toContain("清水寺");
        expect.soft(result.publicPlacePresentation?.cards.some(({ title }) => title.includes("出雲大社"))).toBe(false);
      }
      if (index === 3) expect.soft(result.response).toContain("保存は行っていません");
    }
    expect(v1.converse).not.toHaveBeenCalled();
    const history = await state.conversations.history(principal, conversationId);
    expect.soft(successfulTurns).toBe(4);
    expect.soft(history.items).toHaveLength(8);
    expect.soft(history.items[5]?.publicPlacePresentation?.cards.map(({ title }) => title)).toContain("清水寺");
  }, 280000);
});
