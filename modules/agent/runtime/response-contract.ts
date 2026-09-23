import type { AgentModelContent, AgentModelResponse } from "./model-provider";
import { semanticDecisionFromSummary } from "./semantic-decision";

/** Wire-format check only. Never interpret arguments or route/execute a text Tool. */
export function invalidResponseContract(response: AgentModelResponse, toolNames: readonly string[]): string | undefined {
  const nativeCalls = response.message.content.filter((block): block is Extract<AgentModelContent, { type: "tool_call" }> => block.type === "tool_call");
  const native = nativeCalls.length > 0;
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
  const decision = response.decisionSummary ? semanticDecisionFromSummary(response.decisionSummary) : undefined;
  // Native toolUse, an in-trip plan, and independently validated Evidence IDs have
  // observable typed semantics. Otherwise an invalid strict envelope must be
  // repaired before any legacy presentation parser can see it.
  if (!native && response.decisionSummaryStatus === "invalid" && !response.declaredInTripAnswerPlan && response.declaredEvidenceIds === undefined) return "invalid_decision_summary";
  if (!native && decision?.action === "use_tool") return "missing_native_tool_use";
  if (native && decision && decision.action !== "use_tool") return "decision_action_mismatch";
  if (native && decision?.action === "use_tool" && nativeCalls.some((call) => call.name !== decision.toolName)) return "decision_tool_mismatch";
  if (decision?.action === "ask" && response.decisionSummary?.missingRequirements !== undefined &&
    !decision.missingRequirements.some((item) => item.action === "ask" &&
      (item.resolution === "user_decision" || item.resolution === "authorization"))) return "decision_missing_requirement_mismatch";
  if (!native && !visible && response.decisionSummaryStatus !== undefined &&
      !response.decisionSummary?.inTripAnswerPlan && !response.declaredInTripAnswerPlan) return "empty_user_response";
  return undefined;
}

export const responseContractRepairInstruction = "直前の応答は出力contract違反のため表示・保存・実行していません。必要なToolはConverseのnative toolUseだけで呼び出してください。本文にTool XML/JSONを出さず、通常の利用者向け回答を返してください。usedEvidenceIdsには実際に提供済みのEvidence IDだけを指定し、未取得の参照は含めないでください。in-trip回答には有効なinTripAnswerPlanが必要です。";
