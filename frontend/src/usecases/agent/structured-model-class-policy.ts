import type { AgentModelClassPolicy } from "./agent-runtime";

/**
 * 構造化Contextだけから、曖昧性の高い初回発見、複雑な既存旅程判断、
 * 結果駆動再計画をdecision classへ送るpolicy。
 * 発話本文、目的地、Tool名は見ず、追加のmodel callも行わない。
 */
export const structuredModelClassPolicy: AgentModelClassPolicy = ({ request, phase }) =>
  phase === "result_driven_replan" ||
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
  const tripContext = context?.tripContext;
  const hasTripContext = tripContext !== undefined && Object.keys(tripContext).length > 0;
  const needsDiscovery = context?.travelProfile !== undefined &&
    context.currentTrip === undefined &&
    context.currentJourney === undefined &&
    (!hasTripContext || tripContext?.planningStage === "inspiration");
  const readyToPlan = tripContext?.planningStage === "planning" &&
    typeof tripContext.startDate === "string" &&
    typeof tripContext.stayNights === "number";
  return needsDiscovery || readyToPlan;
}
