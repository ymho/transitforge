import { expect, it, vi } from "vitest";
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { compileEffectiveIntent } from "@raiquora/agent/effective-intent";
import { emptyConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
import { ConditionUpdateRejectedError } from "@raiquora/agent/conversation-condition";
import { StrandsAgentEngine } from "./strands-agent-engine.js";

/** The actual SDK executes each Tool and feeds its unmodified result to the next
 * model request. These assertions do not replace the Application journal tests. */
class ReplayModel extends Model<BaseModelConfig> {
  private config: BaseModelConfig = { modelId: "synthetic-condition-replay" };
  private index = 0;
  readonly messages: Message[][] = [];
  constructor(private readonly inputs: object[]) { super(); }
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(messages: Message[]): AsyncGenerator<ModelStreamEvent> {
    this.messages.push(structuredClone(messages));
    const input = this.inputs[this.index++];
    const name = input ? "update_current_destination" : "strands_structured_output";
    if (this.index > this.inputs.length + 1) throw new Error("Unexpected model retry");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name, toolUseId: `replay-${this.index}` } };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(input ?? { reply: { kind: "uncertainty" } }) } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
  }
}
const first = { action: "set", place: "神戸", quote: "神戸" };
const other = { action: "set", place: "京都", quote: "京都" };
const receipt = { version: "public-semantic-receipt-v1" as const, intentRevision: 1,
  speechAct: "inform" as const, outcome: "accepted" as const, changes: [] };
const effectiveIntent = compileEffectiveIntent({ overlay: emptyConversationIntentOverlay() });
async function run(model: ReplayModel, apply = vi.fn(async () => ({ receipt, effectiveIntent }))) {
  const tools = new AgentToolRegistry();
  const engine = new StrandsAgentEngine({ modelId: "unused", region: "ap-northeast-1", systemPrompt: "test", maxTurns: 5 }, { model });
  const result = await engine.run({ executionId: "replay", userRequest: "神戸ではなく京都", tools,
    toolExecutor: new AgentToolExecutor(tools, new ToolEvidenceRegistry()), conditionController: { apply } });
  return { apply, result };
}
it("reuses only an identical condition request without a second persistence callback", async () => {
  const model = new ReplayModel([first, { ...first }]);
  const { apply, result } = await run(model);
  expect(apply).toHaveBeenCalledOnce();
  expect(result.replyProposal).toEqual({ kind: "uncertainty" });
  const messages = JSON.stringify(model.messages.at(-1));
  expect(messages).not.toContain("condition_conflict");
  expect(messages.match(/public-semantic-receipt-v1/g)).toHaveLength(2);
});
it.each([other, { action: "clear", quote: "未定" }])("rejects a different second payload instead of returning the first payload's success", async next => {
  const model = new ReplayModel([first, next]);
  const { apply, result } = await run(model);
  expect(apply).toHaveBeenCalledOnce();
  expect(result.effectiveIntent).toEqual(effectiveIntent);
  const messages = JSON.stringify(model.messages.at(-1));
  expect(messages).toContain("condition_conflict");
  expect(messages).toContain('"conditionAccepted":false');
  expect(messages).not.toContain("already_applied_this_turn");
  expect(messages.match(/public-semantic-receipt-v1/g)).toHaveLength(1);
});
it("does not cache a rejected first call or block an independent new invocation", async () => {
  const apply = vi.fn(async () => ({ receipt, effectiveIntent }));
  apply.mockRejectedValueOnce(new ConditionUpdateRejectedError("condition_conflict"));
  await run(new ReplayModel([first, other]), apply);
  expect(apply).toHaveBeenCalledTimes(2);
  await run(new ReplayModel([other]), apply);
  expect(apply).toHaveBeenCalledTimes(3);
});
