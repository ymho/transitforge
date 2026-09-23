import { expect, it, vi } from "vitest";
import { ConversationModelProvider } from "./conversation-model-provider.js";
import type { ConversationModel } from "../ports/conversation-model.js";
import { agentTurnPresentationOutputContract } from "@raiquora/agent/agent-output-contract";

it("maps native messages, capability descriptions, call correlation and usage without HTTP", async () => {
  const converse = vi.fn<ConversationModel["converse"]>(async () => ({ message: { role: "assistant", content: [{ text: "こんにちは" }] },
    stopReason: "max_tokens", metadata: { modelId: "configured-model", latencyMs: 12, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } } }));
  const result = await new ConversationModelProvider({ converse }, "turn-id").generate({ modelCallId: "call-id", modelClass: "lightweight",
    messages: [{ role: "assistant", content: [{ type: "tool_call", name: "test", toolCallId: "tool-id", input: { query: "京都" } }] },
      { role: "user", content: [{ type: "tool_result", toolCallId: "tool-id", status: "error", output: { code: "unavailable" } }] }],
    tools: [{ name: "test", description: "short", inputSchema: { type: "object", properties: {} },
      decisionSupport: { capability: "lookup", responsibilityBoundary: "verified sources only" } }],
  });
  expect(converse.mock.calls[0][0]).toMatchObject({ modelClass: "lightweight", trace: { apiRequestId: "turn-id", modelCallId: "call-id" },
    tools: [{ description: expect.stringContaining("verified sources only") }], messages: [
      { role: "assistant", content: [{ toolUse: { toolUseId: "tool-id", name: "test", input: { query: "京都" } } }] },
      { role: "user", content: [{ toolResult: { toolUseId: "tool-id", status: "error", content: [{ json: { code: "unavailable" } }] } }] },
    ] });
  expect(result).toMatchObject({ stopReason: "max_tokens", metadata: { provider: "bedrock", model: "configured-model", latencyMs: 12, usage: { totalTokens: 5 } } });
});

it("decodes provider/application strict JSON once and never falls through to the legacy tag parser", async () => {
  const valid: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "provider_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ responseText: "候補です", decision: { interpretedGoal: "候補提示", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: ["goal_interpreted"] } }) }] } }) };
  await expect(new ConversationModelProvider(valid, "turn").generate({ messages: [] })).resolves.toMatchObject({
    message: { content: [{ type: "text", text: "候補です" }] }, decisionSummaryStatus: "valid", decisionSummary: { selectedAction: "answer" },
  });
  const invalid: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: '<decision_summary>{"selectedAction":"answer"}</decision_summary>legacy' }] } }) };
  const result = await new ConversationModelProvider(invalid, "turn").generate({ messages: [] });
  expect(result.decisionSummaryStatus).toBe("invalid");
  expect(result.message.content).toEqual([{ type: "text", text: '<decision_summary>{"selectedAction":"answer"}</decision_summary>legacy' }]);
});
it("forwards a typed presentation to Application validation instead of model-authored prose", async () => {
  const presentation = { kind: "travel-plan", startDate: null, candidates: [] };
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ responseText: "この文字列は表示しない", presentation,
      decision: { interpretedGoal: "候補提示", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: ["goal_interpreted"] } }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [] });
  expect(result.message.content).toEqual([{ type: "text", text: "この文字列は表示しない" }]);
  expect(result.declaredPresentation).toEqual(presentation);
  expect(result.decisionSummaryStatus).toBe("valid");
});
it("rejects an application-strict response that omits a presentation required by its selected contract", async () => {
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ responseText: "旅行案です",
      decision: { interpretedGoal: "候補提示", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: ["goal_interpreted"] } }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [], outputContract: agentTurnPresentationOutputContract });
  expect(result.decisionSummaryStatus).toBe("invalid");
  expect(result.decisionSummary).toBeUndefined();
});
it("passes malformed Evidence reference metadata to the shared runtime rejection policy", async () => {
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 0 },
    message: { role: "assistant", content: [{ text: '<decision_summary>{"usedEvidenceIds":"invalid"}</decision_summary>回答' }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [] });
  expect(result.invalidUsedEvidenceIds).toBe(true);
  expect(result.message.content).toEqual([{ type: "text", text: "回答" }]);
});
