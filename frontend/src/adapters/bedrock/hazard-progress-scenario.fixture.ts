import { evaluateTripFeasibility } from "@raiquora/trip/trip-feasibility";
import { feasibilityStayTrip, feasibilityNow } from "../../../../modules/trip/domain/trip-feasibility.fixture";
import { checklistItem } from "../../../../modules/trip/domain/trip-checklist.fixture";
import { hazardAlert, hazardInformation } from "../../../../modules/trip/domain/hazard-alert.fixture";
import { runViewerAgentRuntime, type BedrockAgentConverse } from "./viewer-agent-runtime";
import { askProgressFixture, modelGroundedAnswer, modelTool, modelTools } from "./ask-progress-scenarios.fixture";
import { evaluateTravelProgress, type TravelProgressScenario } from "../../usecases/agent/evaluation/travel-progress-evaluation";
import type { AgentTrace } from "../../usecases/agent/agent-trace";
import type { AgentTurnObservation } from "../../usecases/agent/agent-turn-outcome";

/** AI: scripted provider/model IO through the production registry, evidence, context and policies. */
export async function runHazardProgressScenario(scenario: TravelProgressScenario, live?: BedrockAgentConverse) {
  const f = feasibilityStayTrip(), trip = { ...f.trip, planningState: "ready" as const };
  const items = [checklistItem({ tripId: trip.id, status: "done" }), checklistItem({ tripId: trip.id, id: "22222222-2222-4222-8222-222222222222", status: "not-needed" })];
  const before = JSON.stringify({ trip, items, facts: f.facts });
  const evaluation = evaluateTripFeasibility(trip, f.facts, feasibilityNow);
  const alerts = hazardInformation([hazardAlert({ severity: "emergency" })]);
  let calls = 0, providerCalls = 0, trace: AgentTrace | undefined, observation: AgentTurnObservation | undefined;
  let toolObservation: unknown, description = "";
  const response = await runViewerAgentRuntime(scenario.userRequest, { ...askProgressFixture("C-candidate").base,
    getCurrentTrip: () => trip, getTravelCandidates: () => [], getChecklistItems: () => items,
    getReservationFacts: () => f.facts.reservations, getFeasibilityExternalFacts: () => f.facts.external,
    getCurrentDate: () => new Date(feasibilityNow),
    searchHazardAlerts: async () => { providerCalls++; return { alerts }; },
    storeAgentTrace: async (value) => { trace = value; }, onTurnObservation: (value) => { observation = value; },
  }, async (...args) => {
    description = args[1]?.find((t) => t.name === "search_travel_alerts")?.description ?? description;
    for (const message of args[0]) for (const block of message.content) {
      if ("toolResult" in block) for (const content of block.toolResult.content) {
        const json = content.json as { alerts?: unknown };
        if (json?.alerts) toolObservation = json.alerts;
      }
    }
    const call = calls++;
    if (live) return live(...args);
    if (!call) return modelTools(modelTool("search_travel_alerts", { area: "大阪府" }));
    return modelGroundedAnswer(args[0]);
  });
  const report = evaluateTravelProgress(scenario.id, [{ observation, trace, delivered: true, modelCalls: calls }], scenario.thresholds, live ? "live" : "scripted");
  const failures: string[] = [];
  const projected = toolObservation as { data?: { area?: string; alerts?: Array<{ severity: string }> }; evidence?: Array<{ id: string }> } | undefined;
  if (!projected?.data?.alerts?.some((a) => a.severity === "emergency") || projected.data.area !== "大阪府" || !projected.evidence?.length) failures.push("public hazard/evidence/scope not delivered");
  if (!description.includes("TripImpact") || !description.includes("未評価")) failures.push("public hazard/impact boundary missing from capability");
  if (JSON.stringify({ trip, items, facts: f.facts }) !== before ||
      JSON.stringify(evaluateTripFeasibility(trip, f.facts, feasibilityNow)) !== JSON.stringify(evaluation)) failures.push("hazard changed Trip/checklist/reservation/feasibility");
  if (typeof response === "string" || !("external" in response) || !response.external?.alerts?.evidence.length) failures.push("visible hazard evidence lost");
  if (typeof response !== "string" && ("tripUpdateProposal" in response || "checklistProposal" in response)) failures.push("search implicitly created a mutation proposal");
  const tools = trace?.events.filter((event) => event.type === "tool_called");
  if (!live && (calls !== 2 || providerCalls !== 1 || report.toolCalls !== 1)) failures.push("unexpected calls");
  if (tools?.some((event) => event.toolName !== "search_travel_alerts")) failures.push("hazard lookup unexpectedly invoked another action");
  if (report.ttfc !== null || report.ttfi !== null) failures.push("hazard mislabeled as candidate/itinerary generation");
  report.contractFailures.push(...failures); report.failures.push(...failures); report.passed = !report.failures.length;
  return report;
}
