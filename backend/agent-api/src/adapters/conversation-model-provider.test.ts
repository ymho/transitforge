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
    message: { role: "assistant", content: [{ text: JSON.stringify({ kind: "answer", responseText: "候補です" }) }] } }) };
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
    message: { role: "assistant", content: [{ text: JSON.stringify({ kind: "answer", responseText: "この文字列は表示しない", presentation }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [] });
  expect(result.message.content).toEqual([{ type: "text", text: "この文字列は表示しない" }]);
  expect(result.declaredPresentation).toEqual(presentation);
  expect(result.decisionSummaryStatus).toBe("valid");
});
it("rejects an application-strict response that omits a presentation required by its selected contract", async () => {
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ kind: "answer", responseText: "旅行案です" }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [], outputContract: agentTurnPresentationOutputContract });
  expect(result.decisionSummaryStatus).toBe("invalid");
  expect(result.decisionSummary).toBeUndefined();
});
it("preserves a recognized presentation when another answer field is invalid", async () => {
  const presentation = { kind: "travel-plan", startDate: null, candidates: [] };
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ kind: "answer", responseText: "旅行案です", presentation,
      evidenceIds: "invalid" }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [], outputContract: agentTurnPresentationOutputContract });
  expect(result).toMatchObject({ decisionSummaryStatus: "invalid", declaredPresentation: presentation,
    message: { content: [{ type: "text", text: "旅行案です" }] } });
  expect(result.decisionSummary).toBeUndefined();
});
it("preserves an independently valid presentation under the base contract when another answer field is invalid", async () => {
  const presentation = { kind: "travel-plan", startDate: null, candidates: [] };
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ kind: "answer", responseText: "旅行案です", presentation,
      evidenceIds: "invalid" }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [] });
  expect(result).toMatchObject({ decisionSummaryStatus: "invalid", declaredPresentation: presentation,
    message: { content: [{ type: "text", text: "旅行案です" }] } });
  expect(result.decisionSummary).toBeUndefined();
});
it("accepts a bounded final Evidence selection and derives the answer decision", async () => {
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ kind: "answer", responseText: "確認済み情報を案内します",
      evidenceIds: ["evidence-1"] }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [] });
  expect(result).toMatchObject({ decisionSummaryStatus: "valid", declaredEvidenceIds: ["evidence-1"],
    message: { content: [{ type: "text", text: "確認済み情報を案内します" }] } });
  expect(result.decisionSummary).toMatchObject({ selectedAction: "answer", usedEvidenceIds: ["evidence-1"] });
});
it("does not preserve Evidence selection from an invalid Tool-routing Decision", async () => {
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ kind: "use_tool", responseText: "Toolを呼びます",
      evidenceIds: ["evidence-1"] }) }] } }) };
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
    message: { role: "assistant", content: [{ text: JSON.stringify({ kind: "answer", responseText: "旅行案です", ...payload }) }] } }) };
  const result = await new ConversationModelProvider(model, "turn").generate({ messages: [], outputContract: agentTurnPresentationOutputContract });
  expect(result.decisionSummaryStatus).toBe("invalid");
  expect(result.declaredPresentation).toBeUndefined();
});
it("bounded-repairs an application-strict presentation embedded in responseText", async () => {
  const presentation = { kind: "travel-plan", startDate: null, candidates: [] };
  const model: ConversationModel = { converse: async () => ({ stopReason: "end_turn", metadata: { modelId: "fixture", latencyMs: 1, outputMode: "application_strict" },
    message: { role: "assistant", content: [{ text: JSON.stringify({ kind: "answer", responseText: JSON.stringify(presentation) }) }] } }) };
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
