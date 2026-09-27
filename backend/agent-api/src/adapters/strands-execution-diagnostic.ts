import type { AgentDiagnosticReason, AgentExecutionCounts, AgentExecutionDiagnostic, AgentExecutionStopReason } from "../ports/agent-diagnostics.js";

const reasons: Record<AgentExecutionStopReason, AgentDiagnosticReason> = {
  endTurn: "completed", toolUse: "completed", stopSequence: "completed",
  limitTurns: "iteration_budget", limitTotalTokens: "total_token_budget", limitOutputTokens: "output_token_budget",
  maxTokens: "model_output_limit", modelContextWindowExceeded: "context_window_limit",
  cancelled: "cancelled", contentFiltered: "provider_refusal", guardrailIntervened: "provider_refusal",
  unknown: "failed", not_recorded: "failed",
};
const countKeys = ["modelCalls", "toolCalls", "inputTokens", "outputTokens", "totalTokens"] as const;

/** Copy only closed operational fields. Never serialize an SDK result, trace,
 * lastMessage, exception, Tool payload or caller-supplied extra property. */
export function strandsExecutionDiagnostic(input: { stopReason?: unknown; limitReason?: unknown; metrics?: unknown } = {}): AgentExecutionDiagnostic {
  const stopReason: AgentExecutionStopReason = input.stopReason === undefined ? "not_recorded" :
    typeof input.stopReason === "string" && Object.hasOwn(reasons, input.stopReason)
      ? input.stopReason as AgentExecutionStopReason : "unknown";
  const limitReason = input.limitReason === "tool_calls" || input.limitReason === "deadline" ? input.limitReason : undefined;
  const counts: AgentExecutionCounts = {};
  if (input.metrics && typeof input.metrics === "object" && !Array.isArray(input.metrics)) {
    for (const key of countKeys) {
      const value = (input.metrics as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) counts[key] = value;
    }
  }
  return {
    stopReason,
    reason: limitReason === "deadline" ? "deadline" : limitReason === "tool_calls" ? "tool_budget" : reasons[stopReason],
    ...(limitReason ? { limitReason } : {}),
    ...(Object.keys(counts).length ? { counts } : {}),
  };
}
