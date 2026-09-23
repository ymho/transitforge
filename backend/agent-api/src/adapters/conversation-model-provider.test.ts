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
it("preserves a recognized v2 presentation when only strict Decision metadata is invalid", async () => {
  const presentation = { kind: "travel-plan", startDate: null, candidates: [] };
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ responseText: "旅行案です", presentation,
      decision: { interpretedGoal: "候補提示", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: ["invented_reason"] } }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [], outputContract: agentTurnPresentationOutputContract });
  expect(result).toMatchObject({ decisionSummaryStatus: "invalid", declaredPresentation: presentation,
    message: { content: [{ type: "text", text: "旅行案です" }] } });
  expect(result.decisionSummary).toBeUndefined();
});
it("preserves independently valid final Evidence selection when advisory Decision metadata is invalid", async () => {
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ responseText: "確認済み情報を案内します",
      decision: { interpretedGoal: "案内", hardConstraints: [], softPreferences: [], selectedAction: "answer",
        usedEvidenceIds: ["evidence-1"], unresolvedFacts: [], reasonCodes: ["invented_reason"] } }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [] });
  expect(result).toMatchObject({ decisionSummaryStatus: "invalid", declaredEvidenceIds: ["evidence-1"],
    message: { content: [{ type: "text", text: "確認済み情報を案内します" }] } });
  expect(result.decisionSummary).toBeUndefined();
});
it("does not preserve Evidence selection from an invalid Tool-routing Decision", async () => {
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ responseText: "Toolを呼びます",
      decision: { selectedAction: "use_tool", usedEvidenceIds: ["evidence-1"] } }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [] });
  expect(result.decisionSummaryStatus).toBe("invalid");
  expect(result.declaredEvidenceIds).toBeUndefined();
});
it.each([
  { presentation: { kind: "invented" } },
  { presentation: "travel-plan" },
  { presentation: { kind: "travel-plan" }, extra: true },
])("does not preserve an unrecognized or ambiguous presentation when Decision metadata is invalid", async (payload) => {
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ responseText: "旅行案です", decision: {}, ...payload }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [], outputContract: agentTurnPresentationOutputContract });
  expect(result.decisionSummaryStatus).toBe("invalid");
  expect(result.declaredPresentation).toBeUndefined();
});
it("bounded-repairs an application-strict v2 presentation embedded in responseText", async () => {
  const presentation = { kind: "travel-plan", startDate: null, candidates: [] };
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ responseText: JSON.stringify(presentation),
      decision: { interpretedGoal: "候補提示", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: ["goal_interpreted"] } }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [], outputContract: agentTurnPresentationOutputContract });
  expect(result.decisionSummaryStatus).toBe("valid");
  expect(result.declaredPresentation).toEqual(presentation);
});
it("passes malformed Evidence reference metadata to the shared runtime rejection policy", async () => {
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 0 },
    message: { role: "assistant", content: [{ text: '<decision_summary>{"usedEvidenceIds":"invalid"}</decision_summary>回答' }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [] });
  expect(result.invalidUsedEvidenceIds).toBe(true);
  expect(result.message.content).toEqual([{ type: "text", text: "回答" }]);
});
