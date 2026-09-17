import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import { areaInput, areaHazardEvent, areaNow } from "../../../../modules/trip/domain/area-trip-impact.fixture";
import { hazardInformation } from "../../../../modules/trip/domain/hazard-alert.fixture";
import { buildInTripContext } from "@raiquora/trip/in-trip-context";
import { evaluateAreaTripImpact } from "@raiquora/trip/area-trip-impact";
import { runViewerAgentRuntime, type BedrockAgentConverse } from "./viewer-agent-runtime";
import { askProgressFixture, modelAnswer, modelTools, modelTool } from "./ask-progress-scenarios.fixture";
import type { AgentTrace } from "../../usecases/agent/agent-trace";
import type { AgentTurnObservation } from "../../usecases/agent/agent-turn-outcome";
import { evaluateTravelProgress, type TravelProgressScenario } from "../../usecases/agent/evaluation/travel-progress-evaluation";

export const inTripToolCases = {
  "AN-in-trip-weather-needed": { tool: "search_weather_forecast", input: { location: "大阪市", startDate: "2026-09-14" } },
  "AO-in-trip-alternative-needed": { tool: "search_direct_routes", input: { originStation: "京都", destinationStation: "大阪", departureTimeMinutes: 600 } },
  "AP-in-trip-alert-needed": { tool: "search_travel_alerts", input: { area: "大阪府" } },
};

/** All three provider seams are available in all cases; no capability is hidden by the question. */
export async function runInTripToolScenario(scenario: TravelProgressScenario, live?: BedrockAgentConverse) {
  const expected = inTripToolCases[scenario.id as keyof typeof inTripToolCases];
  const f = inTripFixture(); let trip = f.trip, snapshot = f.snapshot;
  if (scenario.id === "AP-in-trip-alert-needed") {
    const area = areaInput(areaHazardEvent()); trip = { ...area.trip, lifecycleState: "in_trip" };
    snapshot = buildInTripContext(trip, { at: areaNow, timeZone: "UTC" }, { tripConfirmed: true, impacts: [{
      impact: evaluateAreaTripImpact({ ...area, trip }), fresh: false, observedAt: "2026-09-12T06:00:00Z", expiresAt: "2026-09-12T07:00:00Z",
    }] })!;
  }
  let trace: AgentTrace | undefined, observation: AgentTurnObservation | undefined, calls = 0;
  const before = JSON.stringify({ trip, snapshot });
  const response = await runViewerAgentRuntime(scenario.userRequest, {
    ...askProgressFixture("C-candidate").base, candidateSelection: undefined, getTravelCandidates: () => [],
    getCurrentTrip: () => trip, getCurrentDate: () => new Date(snapshot.now.at), inTripContextReader: { read: async () => snapshot },
    searchWeatherForecast: async () => ({ forecast: { status: "unavailable", freshness: "unknown", evidence: [] } }),
    searchHazardAlerts: async () => ({ alerts: hazardInformation() }),
    // No invented alternative route in this fixture. Testing the decision to search, not real provider coverage.
    searchDirectRoutes: async () => ({ originStation: "京都", results: [] }),
    storeAgentTrace: async (v) => { trace = v; }, onTurnObservation: (v) => { observation = v; },
  }, async (...args) => {
    calls++;
    return live ? live(...args) : calls === 1 ? modelTools(modelTool(expected.tool, expected.input))
      : modelAnswer("新しい情報の照会結果を確認しました。未確認の範囲を安全とは扱いません。旅程は変更していません。");
  });
  const report = evaluateTravelProgress(scenario.id, [{ observation, trace, delivered: true, modelCalls: calls }], scenario.thresholds, live ? "live" : "scripted");
  const failures: string[] = [];
  if (!trace?.events.some((e) => e.type === "tool_called" && e.toolName === expected.tool)) failures.push(`required Tool not called: ${expected.tool}`);
  if (!trace?.events.some((e) => e.type === "tool_completed" && e.toolName === expected.tool && e.outcome === "success")) failures.push(`required Tool did not execute successfully: ${expected.tool}`);
  if (JSON.stringify({ trip, snapshot }) !== before) failures.push("read-only Trip changed");
  const text = typeof response === "string" ? response : response.text;
  if (!text.trim() || /案内を完了できません|安全な実行上限/.test(text)) failures.push("response failed");
  report.contractFailures.push(...failures); report.failures.push(...failures); report.passed = report.failures.length === 0;
  return report;
}
