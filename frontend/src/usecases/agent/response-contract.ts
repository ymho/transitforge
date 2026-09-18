import type { AgentModelResponse } from "./model-provider";

/** Wire-format check only. Never interpret arguments or route/execute a text Tool. */
export function invalidResponseContract(response: AgentModelResponse, toolNames: readonly string[]): string | undefined {
  const native = response.message.content.some((block) => block.type === "tool_call");
  const text = response.message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  // Code examples inside fenced blocks are not executable envelopes.
  const visible = text.replace(/```[^\n]*\n[\s\S]*?```/gu, "").trim();
  const names = new Set(["tool_call", "tool_use", "ask_follow_up", ...toolNames]);
  for (const match of visible.matchAll(/<\/?([a-z][a-z0-9_]*)\b/gu)) {
    if (names.has(match[1]!)) return "tool_text_envelope";
  }
  if (/^\s*\{\s*"(?:tool_call|toolUse|tool_use)"\s*:/u.test(visible)) return "tool_text_envelope";
  try {
    const value: unknown = JSON.parse(visible);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const envelope = value as Record<string, unknown>;
      if (typeof envelope.name === "string" && names.has(envelope.name) &&
          ("arguments" in envelope || "input" in envelope)) return "tool_text_envelope";
    }
  } catch { /* Partial envelopes must also be withheld; no input is recovered. */ }
  for (const name of names) {
    if (visible.startsWith(`${name}\n{`) || visible.startsWith(`${name} {`) ||
        visible.startsWith(`{"name":"${name}"`) || visible.startsWith(`{ "name": "${name}"`)) return "tool_text_envelope";
  }
  if (!native && response.decisionSummary?.selectedAction === "use_tool") return "missing_native_tool_use";
  if (!native && !visible && response.decisionSummaryStatus !== undefined &&
      !response.decisionSummary?.inTripAnswerPlan && !response.declaredInTripAnswerPlan) return "empty_user_response";
  return undefined;
}

export const responseContractRepairInstruction = "直前の応答は出力contract違反のため表示・保存・実行していません。必要なToolはConverseのnative toolUseだけで呼び出してください。本文にTool XML/JSONを出さず、回答は実在Evidenceに基づく利用者向け応答contractで返してください。in-trip回答には有効なinTripAnswerPlanが必要です。";
