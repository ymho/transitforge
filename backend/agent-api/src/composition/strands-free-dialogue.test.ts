import { createTrip } from "@raiquora/trip/trip";
import { expect, it } from "vitest";
import { Agent, Model, AfterToolCallEvent, ModelMessageEvent, type BaseModelConfig, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
import { agentV2StructuredOutputSchema } from "@raiquora/agent/agent-v2-reply";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { stateDynamoFixture, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

const messages = [
  "旅行の人数は全体で3人にします。出発地は次の発言で伝えます。",
  "大阪です。",
  "もし全体4人だったらどうですか。いまの条件は変えずに考えてください。",
  "人数を訂正します。全体4人で行きます。",
  "出発地は未定に戻してください。人数はそのままです。",
  "ありがとう",
];
const say = (text: string) => ({ name: "strands_structured_output", input: { reply: { kind: "conversation", message: "acknowledgement", text } } });
class DialogueModel extends Model<BaseModelConfig> {
  calls = 0;
  private config: BaseModelConfig = { modelId: "scripted-dialogue" };
  private readonly steps = [
    { name: "update_current_party", input: { action: "set", party: { kind: "count", people: 3 }, quote: messages[0] } },
    { name: "strands_structured_output", input: { reply: { kind: "clarification", target: "origin", text: "3人での旅行ですね。出発地が分かったら教えてください。" } } },
    { name: "update_current_origin", input: { action: "set", place: "大阪", quote: messages[1] } }, say("大阪からの出発として反映しました。"),
    { name: "consider_trip_scenario", input: { kind: "party", party: { kind: "count", people: 4 }, quote: messages[2] } },
    { name: "strands_structured_output", input: { reply: { kind: "uncertainty", text: "4人と仮定して考えられます。料金や空室は未確認です。現在の人数は変更していません。" } } },
    { name: "update_current_party", input: { action: "set", party: { kind: "count", people: 4 }, quote: messages[3] } }, say("今回は実際に4人で行く条件へ訂正しました。"),
    { name: "update_current_origin", input: { action: "clear", quote: messages[4] } }, say("出発地だけを未定に戻しました。"), say("どういたしまして。また条件が決まったら教えてください。"),
  ];
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(input: Message[]): AsyncGenerator<ModelStreamEvent> {
    if (this.calls === 2) {
      const payload = JSON.parse((input.at(-1)!.content[0] as { text: string }).text);
      expect(input[0]!.role).toBe("user");
      expect((input[0]!.content[0] as { text: string }).text).toBe(messages[0]);
      expect(input[1]!.role).toBe("assistant");
      expect((input[1]!.content[0] as { text: string }).text).toContain("出発地");
      expect(payload.application.conversation).not.toHaveProperty("messages");
      expect(payload).not.toHaveProperty("userMessage");
      expect((input.at(-1)!.content[1] as { text: string }).text).toBe("大阪です。");
    }
    const step = this.steps[this.calls++];
    if (!step) throw new Error("Unexpected extra model call");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: step.name, toolUseId: `dialogue-${this.calls}` } };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(step.input) } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
  }
}

/** Deterministic and paid live lanes use the same authenticated production-shaped
 * Conversation path. Only synthetic state; never external Providers or production writes. */
async function runDialogue(model?: Model<BaseModelConfig>) {
  const principal = await cognitoTokenFixture().verifier.verify(token());
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const metadata = stateMetadata();
  trips.seed(createTrip(stateMetadata().tripId, "検討中の旅", "2026-09-18T00:00:00Z"), principal.subject);
  await state.conversations.create(principal, conversationId, metadata);
  const profile = await state.profiles.get(principal);
  let calls = 0, writes = 0;
  const textResults: boolean[] = [];
  const engine = new StrandsAgentEngine({ modelId: process.env.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0", region: "ap-northeast-1",
    systemPrompt: agentV2SystemPrompt, maxOutputTokens: 1536, maxInvocationOutputTokens: 4096 }, {
    ...(model ? { model } : {}), createAgent: config => {
      const agent = new Agent(config);
      agent.addHook(ModelMessageEvent, () => { calls++; });
      agent.addHook(AfterToolCallEvent, event => {
        if (event.toolUse.name !== "strands_structured_output") return;
        const parsed = agentV2StructuredOutputSchema.safeParse(event.toolUse.input);
        textResults.push(event.result.status === "success" && parsed.success && "text" in parsed.data.reply && !!parsed.data.reply.text?.trim());
      });
      return agent;
    },
  });
  const runtime = createStrandsServerRuntime(engine);
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model: { converse: async () => { throw new Error("V1 must not run"); } }, weather: { search: async () => { throw new Error("No external Providers"); } },
    newExecutionId: () => "synthetic-free-dialogue", limits: { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 2, maxExecutionMs: 60000 },
    runRuntime: input => runtime({ ...input, ...(input.conditionController ? { conditionController: { ...input.conditionController,
      apply: change => { writes++; return input.conditionController!.apply(change); } } } : {}) }),
  });
  const turns = new DynamoDbConversationTurnRepository("test-state", state.client);
  const working = async () => (await turns.getWorkingState(principal, conversationId))?.semantic?.overlay;
  for (const [index, userRequest] of messages.entries()) {
    const before = await working(), beforeCalls = calls, beforeWrites = writes, beforeText = textResults.length;
    const input = { principal, conversationId, turnId: `73610000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, userRequest };
    const result = await app.runConversationTurn(input), overlay = await working();
    const hasText = textResults.slice(beforeText).some(Boolean);
    if (!model) console.log(JSON.stringify({ case: index, status: result.status, modelCalls: calls - beforeCalls, writerCallbacks: writes - beforeWrites,
      hasText, revision: overlay?.intentRevision }));
    expect.soft(result.status).toBe("completed");
    expect.soft(hasText, `case ${index} free text from native structured output`).toBe(true);
    expect.soft(overlay?.intentRevision).toBe([1, 2, 2, 3, 4, 4][index]);
    expect.soft(overlay?.facts).toEqual([]);
    const savedTrip = await trips.repository.get(principal, stateMetadata().tripId);
    const party = savedTrip?.request.partialConditions?.find(({ target }) => target === "party_size")?.value;
    expect.soft(party).toEqual({ kind: "quantity", amount: index < 3 ? 3 : 4, unit: "people" });
    if (index === 0) expect.soft(result.response).toContain("全体人数：3人");
    const savedOrigin = savedTrip?.request.constraints.find(({ requirement }) => requirement.type === "origin")?.requirement;
    if (index >= 1 && index < 4) expect.soft(savedOrigin).toMatchObject({ type: "origin", place: { name: "大阪" } });
    if (index === 1) expect.soft(result.response).toContain("出発地：大阪");
    if (index === 2 || index === 5) { expect.soft(overlay).toEqual(before); expect.soft(writes).toBe(beforeWrites); expect.soft(result.response).not.toContain("反映済み"); }
    if (index === 3) expect.soft(result.response).toContain("全体人数：4人");
    if (index === 4) { expect.soft(savedOrigin).toBeUndefined(); expect.soft(result.response).toContain("出発地：未定"); }
    const afterCalls = calls;
    expect(await app.runConversationTurn(input)).toEqual(result);
    expect(calls).toBe(afterCalls);
    expect((await state.conversations.history(principal, conversationId)).items.at(-1)?.text).toBe(result.response);
  }
  expect(await state.profiles.get(principal)).toEqual(profile);
}

it("free dialogue follows persisted history and real accepted conditions, with identical replay", () => runDialogue(new DialogueModel()));
it.skipIf(process.env.AGENT_V2_LIVE !== "true")("Nova 2 Lite free dialogue live", () => runDialogue(), 420000);
