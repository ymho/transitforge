import { expect, it, vi } from "vitest";
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
import { createTrip } from "@raiquora/trip/trip";
import { stateDynamoFixture, stateA, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

/** The first two assistant replies are fixed to the reported confirmation question.
 * Otherwise a free model may ask about origin instead, changing what "はい" accepts.
 * The third turn is real Bedrock only in the paid lane; state is always synthetic. */
class ScriptModel extends Model<BaseModelConfig> {
  private config: BaseModelConfig = { modelId: "synthetic-itinerary" };
  private cursor = 0;
  constructor(private readonly steps: { name: string; input: unknown }[]) { super(); }
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(_messages: Message[]): AsyncGenerator<ModelStreamEvent> {
    const step = this.steps[this.cursor++];
    if (!step) throw Error("Unexpected additional model call");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: step.name, toolUseId: `fixture-${this.cursor}` } };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(step.input) } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
  }
}
const reply = (text: string) => ({ name: "strands_structured_output", input: { reply: { kind: "conversation", message: "acknowledgement", text } } });
const live = process.env.AGENT_V2_LIVE === "true";
it(`completes the exact confirmation turn with ${live ? "Bedrock" : "scripted SDK"}, retaining cards and replay`, async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture(), metadata = stateMetadata();
  trips.seed(createTrip(metadata.tripId, "相談中の旅", "2026-10-03T00:00:00Z"), stateA.subject);
  await state.conversations.create(stateA, conversationId, metadata);
  const settings = { modelId: process.env.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0", region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt,
    maxTurns: 6, maxOutputTokens: 4096, maxInvocationOutputTokens: 4096, novaReasoningEffort: "low" as const };
  const prelude = createStrandsServerRuntime(new StrandsAgentEngine(settings, { model: new ScriptModel([
    { name: "update_current_destination", input: { action: "set", place: "出雲大社", quote: "出雲大社にいきたい" } }, reply("行き先を出雲大社として受け止めました。"),
    { name: "update_current_travel_period", input: { action: "set", period: { start: { kind: "relative_date", relation: "tomorrow" }, duration: { unit: "nights", amount: 1 } }, quote: "明日から1泊で行きたい" } },
    reply("旅行期間を明日から1泊に設定しました。出雲大社の観光プランを作成しましょうか？"),
  ]) }));
  const finalRuntime = createStrandsServerRuntime(new StrandsAgentEngine(settings, live ? {} : { model: new ScriptModel([
    { name: "draft_itinerary", input: { variants: [{ label: "1泊の仮旅程", dayCount: 2, items: [
      { kind: "activity", title: "出雲大社の参拝", day: 1 },
      { kind: "stay", title: "宿泊先は未選択", day: 1, endDay: 2 },
      { kind: "transport", title: "帰路は未選択", day: 2 },
    ] }], unknowns: ["移動時刻と宿泊先は未確認"] } }, reply("仮旅程を作成しました。"),
  ]) }));
  let index = 0, execution = 0;
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model: { converse: vi.fn(async () => { throw Error("legacy runtime called"); }) }, weather: { search: vi.fn() },
    newExecutionId: () => `78300000-2222-4000-8000-${String(++execution).padStart(12, "0")}`, runRuntime: input => index < 2 ? prelude(input) : finalRuntime(input),
    limits: { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 2, maxExecutionMs: 60000 },
    diagnostics: { record: async event => { if (live && (event.phase === "execution" || event.phase === "tool")) console.log(JSON.stringify({ phase: "confirmation", reason: event.reason, counts: event.counts, code: event.toolErrorCode })); } },
  });
  for (const userRequest of ["出雲大社にいきたい", "明日から1泊で行きたい", "はい、作成お願いします。"]) {
    const turn = { principal: stateA, conversationId, turnId: `78300000-1111-4000-8000-${String(index + 1).padStart(12, "0")}`, userRequest, uiContext: { calendarDate: "2026-10-03" } };
    const result = await app.runConversationTurn(turn);
    expect(result.status).toBe("completed");
    expect(await app.runConversationTurn(turn)).toEqual(result);
    if (index === 2) {
      const plan = result.publicPlanPresentation!;
      expect(plan?.candidateSetRef.kind).toBe("candidate-set-ref");
      expect(plan.target).toEqual({ tripId: metadata.tripId, baseTripRevision: (await trips.repository.get(stateA, metadata.tripId))!.revision });
      expect(plan.candidates[0]!.days).toHaveLength(2);
      expect(plan.candidates[0]!.items.some(item => item.title.includes("出雲大社"))).toBe(true);
      expect(plan.candidates[0]!.unknowns.length).toBeGreaterThan(0);
      expect((await trips.repository.get(stateA, metadata.tripId))!.items).toEqual([]);
    }
    index++;
  }
  expect((await state.conversations.history(stateA, conversationId)).items).toHaveLength(6);
}, 90_000);
