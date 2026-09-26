import { expect, it, vi } from "vitest";
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from "@strands-agents/sdk";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import { StrandsAgentEngine } from "./strands-agent-engine.js";

type Step = { text: string } | { name: string; value: unknown };
class OutputModel extends Model<BaseModelConfig> {
  calls = 0;
  readonly choices: StreamOptions["toolChoice"][] = [];
  private config: BaseModelConfig = { modelId: "synthetic-output" };
  constructor(private readonly steps: Step[]) { super(); }
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(_messages: Message[], options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    this.choices.push(options?.toolChoice);
    const step = this.steps[this.calls++];
    if (!step) throw new Error("Unnecessary model call after final result");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if ("text" in step) {
      yield { type: "modelContentBlockStartEvent" };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: step.text } };
    } else {
      yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: step.name, toolUseId: `tool-${this.calls}` } };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(step.value) } };
    }
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "text" in step ? "endTurn" : "toolUse" };
  }
}
const output = (reply: unknown): Step => ({ name: "strands_structured_output", value: { reply } });
function setup(steps: Step[]) {
  const model = new OutputModel(steps), tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
  const execute = vi.fn(async () => successfulAgentToolResult({ description: "確認済み" }));
  tools.register({ name: "read_place", description: "Read verified place", effect: "read", inputSchema: { type: "object", properties: {}, additionalProperties: false },
    parseInput: () => validAgentToolInput({}), execute });
  const engine = new StrandsAgentEngine({ modelId: "unused", region: "ap-northeast-1", systemPrompt: "Return the requested structure.", maxTurns: 4 }, { model });
  const run = (maxTurns = 4) => engine.run({ executionId: "native-output", userRequest: "場所を確認", tools,
    toolExecutor: new AgentToolExecutor(tools, evidence), limits: { maxTurns, maxToolCalls: 1 } });
  return { model, execute, run };
}
it("lets the SDK end on a validated result without an Application submit Tool or trailing model call", async () => {
  const test = setup([{ name: "read_place", value: {} }, output({ kind: "uncertainty" })]);
  const result = await test.run();
  expect(result.replyProposal).toEqual({ kind: "uncertainty" });
  expect(result.stopReason).toBe("toolUse");
  expect(test.model.calls).toBe(2);
  expect(test.execute).toHaveBeenCalledOnce();
});
it("uses SDK validation feedback for invalid syntax within the existing turn budget", async () => {
  const test = setup([output({ kind: "candidates" }), output({ kind: "uncertainty" })]);
  expect((await test.run()).replyProposal).toEqual({ kind: "uncertainty" });
  expect(test.model.calls).toBe(2);
  expect(test.execute).not.toHaveBeenCalled();
});
it("does not turn a plain-text answer into authority when the SDK forces structured output", async () => {
  const test = setup([{ text: "保存しておきます。" }, output({ kind: "unavailable", operation: "save" })]);
  const result = await test.run();
  expect(result.replyProposal).toEqual({ kind: "unavailable", operation: "save" });
  expect(JSON.stringify(result)).not.toContain("保存しておきます");
  expect(test.model.calls).toBe(2);
  expect(test.execute).not.toHaveBeenCalled();
});
it("bounds repeated invalid structured output without a custom repair loop or fake success", async () => {
  const test = setup([output({ kind: "candidates" }), output({ kind: "candidates" }), output({ kind: "uncertainty" })]);
  const result = await test.run(2);
  expect(result.stopReason).toBe("limitTurns");
  expect(result.replyProposal).toBeUndefined();
  expect(test.model.calls).toBe(2);
});
