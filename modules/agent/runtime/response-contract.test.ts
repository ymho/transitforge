import { describe, it, expect } from "vitest";
import { invalidResponseContract } from "@raiquora/agent/response-contract";
import type { AgentModelResponse } from "@raiquora/agent/model-provider";
const response = (text: string): AgentModelResponse => ({ message: {role:"assistant",content:[{type:"text",text}]},stopReason:"completed",metadata:{provider:"test"} });
describe("response wire contract", () => {
  it.each(['<tool_call>{"secret":"private"}</tool_call>', '<ask_follow_up>', '{"name":"search_direct_routes","input":', 'search_direct_routes {"origin":"A"}'])('rejects without executing %s', text => {
    expect(invalidResponseContract(response(text), ['search_direct_routes'])).toBe('tool_text_envelope');
  });
  it.each(['こんにちは', 'JSON例: {"name":"太郎"}', '```xml\n<tool_call>例</tool_call>\n```'])('allows ordinary explanation %s', text => {
    expect(invalidResponseContract(response(text), ['search_direct_routes'])).toBeUndefined();
  });
  it("validates typed decision action, Tool and explicit missing requirements", () => {
    const native: AgentModelResponse = { message: { role: "assistant", content: [{ type: "tool_call", toolCallId: "call-1", name: "search_direct_routes", input: {} }] },
      stopReason: "tool_calls", metadata: { provider: "test" }, decisionSummary: { interpretedGoal: "検索", hardConstraints: [], softPreferences: [],
        selectedAction: "answer", unresolvedFacts: [], reasonCodes: [] } };
    expect(invalidResponseContract(native, ["search_direct_routes"])).toBe("decision_action_mismatch");
    const ask = response("確認しますか？"); ask.decisionSummary = { interpretedGoal: "確認", hardConstraints: [], softPreferences: [], selectedAction: "ask_user",
      unresolvedFacts: ["confirmation"], reasonCodes: ["user_confirmation_required"], missingRequirements: [] };
    expect(invalidResponseContract(ask, [])).toBe("decision_missing_requirement_mismatch");
  });
  it("rejects an invalid strict final envelope but preserves observable native toolUse", () => {
    const invalidFinal = response('{"responseText":"案です"}'); invalidFinal.decisionSummaryStatus = "invalid";
    expect(invalidResponseContract(invalidFinal, [])).toBe("invalid_decision_summary");
    const native: AgentModelResponse = { message: { role: "assistant", content: [{ type: "tool_call", toolCallId: "call", name: "search_direct_routes", input: {} }] },
      stopReason: "tool_calls", metadata: { provider: "test" }, decisionSummaryStatus: "invalid" };
    expect(invalidResponseContract(native, ["search_direct_routes"])).toBeUndefined();
  });
  it("allows Application-rendered Evidence selection without trusting invalid advisory metadata", () => {
    const selected = response("このモデル文は事実本文に使わない");
    selected.decisionSummaryStatus = "invalid";
    selected.declaredEvidenceIds = ["evidence-1"];
    expect(invalidResponseContract(selected, [])).toBeUndefined();
  });
});
