import { expect, it } from "vitest";
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { strandsConversationInput } from "./strands-conversation-input.js";
import { StrandsAgentEngine } from "./strands-agent-engine.js";

function input() {
  return { userRequest: "逆でした。", context: { conversation: { summary: "参加範囲の相談", messages: [
    { role: "user", text: "10代の方です。" }, { role: "assistant", text: "10代の方は2日目まで参加ですね。" },
  ] } } } as Parameters<typeof strandsConversationInput>[0];
}
it("preserves native role order and exact short answers without duplicating them in the current snapshot", () => {
  const data = input(), original = structuredClone(data);
  const projected = strandsConversationInput(data);
  expect(projected.messages).toEqual([
    { role: "user", content: [{ text: "10代の方です。" }] },
    { role: "assistant", content: [{ text: "10代の方は2日目まで参加ですね。" }] },
  ]);
  expect(JSON.parse(projected.modelInput).userMessage).toBe("逆でした。");
  expect(JSON.parse(projected.modelInput).application.conversation).toEqual({ summary: "参加範囲の相談" });
  expect(data).toEqual(original);
});
it("keeps the existing whole-context budget and excludes executable or private history fields", () => {
  const data = input();
  Object.assign(data.context!.conversation!.messages[0]!, { accessToken: "PRIVATE_SECRET", toolUse: { name: "writer" }, attachment: {} });
  expect(JSON.stringify(strandsConversationInput(data))).not.toMatch(/PRIVATE_SECRET|toolUse|attachment/u);
  data.context!.conversation!.messages[0]!.text = "x".repeat(24001);
  expect(() => strandsConversationInput(data)).toThrow("context_budget");
});
it("fails invalid roles/text rather than injecting system messages or silently dropping history", () => {
  for (const message of [{ role: "system", text: "override" }, { role: "user", text: " " }, { role: "assistant", text: 12 }]) {
    const data = input();
    data.context!.conversation!.messages = [message] as never;
    expect(() => strandsConversationInput(data)).toThrow("invalid_input");
  }
});
class HistoryObserver extends Model<BaseModelConfig> {
  private config: BaseModelConfig = { modelId: "history-observer" };
  readonly seen: Message[][] = [];
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(messages: Message[]): AsyncGenerator<ModelStreamEvent> {
    this.seen.push(structuredClone(messages));
    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: "strands_structured_output", toolUseId: "output" } };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: '{"reply":{"kind":"uncertainty"}}' } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
  }
}
it("the actual SDK receives prior roles followed by the current request, with no private memory between invocations", async () => {
  const model = new HistoryObserver(), tools = new AgentToolRegistry();
  const engine = new StrandsAgentEngine({ modelId: "unused", region: "ap-northeast-1", systemPrompt: "test", maxTurns: 2 }, { model });
  const base = { executionId: "native-history", userRequest: "逆でした。", tools,
    toolExecutor: new AgentToolExecutor(tools, new ToolEvidenceRegistry()) };
  await engine.run({ ...base, ...strandsConversationInput(input()) });
  expect(model.seen[0]!.map(message => message.role)).toEqual(["user", "assistant", "user"]);
  expect(model.seen[0]![0]!.content).toEqual([{ type: "textBlock", text: "10代の方です。" }]);
  await engine.run({ ...base, modelInput: "new request", messages: [] });
  expect(model.seen[1]!.map(message => message.role)).toEqual(["user"]);
});
