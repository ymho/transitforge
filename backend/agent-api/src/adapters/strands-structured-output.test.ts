import { expect, it, vi } from "vitest";
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from "@strands-agents/sdk";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import type { Evidence } from "@raiquora/agent/evidence-model";
import { admitAgentV2Reply } from "@raiquora/agent/agent-v2-publication";
import { StrandsAgentEngine } from "./strands-agent-engine.js";

type Step = { text: string } | { name: string; value: unknown };
class OutputModel extends Model<BaseModelConfig> {
  calls = 0;
  readonly choices: StreamOptions["toolChoice"][] = [];
  readonly messages: string[] = [];
  private config: BaseModelConfig = { modelId: "synthetic-output" };
  constructor(private readonly steps: Step[]) { super(); }
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(_messages: Message[], options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    this.choices.push(options?.toolChoice);
    this.messages.push(JSON.stringify(_messages));
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
function setup(steps: Step[], observations: Evidence[] = []) {
  const model = new OutputModel(steps), tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
  const execute = vi.fn(async () => successfulAgentToolResult({ description: "確認済み" }));
  tools.register({ name: "read_place", description: "Read verified place", effect: "read", inputSchema: { type: "object", properties: {}, additionalProperties: false },
    parseInput: () => validAgentToolInput({}), execute });
  evidence.register("read_place", () => observations);
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

const page: Evidence = { id: "verified-page", category: "external", knowledgeKind: "deterministic_fact",
  subject: "合成神社", facts: { sourceExcerpt: "庭園を散策できる神社です。" },
  references: [{ sourceType: "external-source", sourceRef: "https://example.test/shrine",
    retrievedAt: "2026-09-29T00:00:00Z", freshness: "current", summary: "合成資料" }] };
const groundedReply = { kind: "answer", references: [{ evidenceId: page.id, field: "sourceExcerpt" }],
  sections: [{ heading: "見どころ", text: "境内の庭園を散策できます。" }],
  nextQuestion: { target: "origin", text: "どこから出発しますか？" } };

it.each([
  { evidenceId: page.id, field: "access" },
  { evidenceId: "invented-page", field: "sourceExcerpt" },
  { evidenceId: page.id, field: "sourceUrl" },
])("lets the SDK correct an inadmissible reference before ending the turn: %j", async reference => {
  const test = setup([{ name: "read_place", value: {} },
    output({ ...groundedReply, references: [reference] }), output(groundedReply)], [page]);
  const result = await test.run();
  expect(result.replyProposal).toEqual(groundedReply);
  expect(test.model.calls).toBe(3);
  expect(test.execute).toHaveBeenCalledOnce();
  expect(test.model.messages[2]).toContain("select an exact reference");
  const published = admitAgentV2Reply(result.replyProposal, { executionId: "native-output", evidence: result.evidence });
  expect(published.text).toContain("どこから出発しますか？");
  expect(published.proof.references).toEqual(groundedReply.references);
});

it("does not publish repeated invalid references when the native turn budget is exhausted", async () => {
  const invalid = output({ ...groundedReply, references: [{ evidenceId: page.id, field: "access" }] });
  const test = setup([{ name: "read_place", value: {} }, invalid, invalid, output(groundedReply)], [page]);
  const result = await test.run(3);
  expect(result.stopReason).toBe("limitTurns");
  expect(result.replyProposal).toBeUndefined();
  expect(test.model.calls).toBe(3);
  expect(test.execute).toHaveBeenCalledOnce();
});

it("never fabricates an operation receipt while providing native validation feedback", async () => {
  const test = setup([output({ kind: "operation_result", receiptId: "model-invented" }),
    output({ kind: "unavailable", operation: "save" })]);
  expect((await test.run()).replyProposal).toEqual({ kind: "unavailable", operation: "save" });
  expect(test.model.messages[1]).toContain("invalid_receipt");
  expect(test.execute).not.toHaveBeenCalled();
});
