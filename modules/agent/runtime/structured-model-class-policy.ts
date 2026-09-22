import type { AgentModelClassPolicy } from "@raiquora/agent/agent-runtime";

/**
 * 構造化Contextだけから、曖昧性の高い初回発見、複雑な既存旅程判断、
 * 結果駆動再計画をdecision classへ送るpolicy。
 * 発話本文、目的地、Tool名は見ず、追加のmodel callも行わない。
 */
export const structuredModelClassPolicy: AgentModelClassPolicy = ({ request, phase }) =>
  phase === "result_driven_replan" ||
    request.initialEvidence?.some((e) => e.category === "external" && typeof e.facts.sourceExcerpt === "string" &&
      e.facts.status === "available" && e.facts.freshness === "fresh") ||
    request.context?.currentJourney !== undefined ||
    request.context?.currentTrip !== undefined ||
    requiresTravelDecision(request)
    ? "decision"
    : undefined;

function requiresTravelDecision(
  request: Parameters<AgentModelClassPolicy>[0]["request"],
): boolean {
  const context = request.context;
  if (request.feature !== "concierge") return false;
  if (context === undefined) return true;
  // Absence is treated as an unframed concierge decision, never reconstructed from legacy tripContext fields.
  return context.taskContext === undefined || ["discovery", "draft", "refine"].includes(context.taskContext.phase);
}
