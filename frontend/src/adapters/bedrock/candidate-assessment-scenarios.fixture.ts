import { candidateAssessmentFixture, assessmentAt, assessedInformation, assessmentSource, forecastFixture } from "../../../../modules/trip/domain/candidate-assessment.fixture";
import { resolvedPlace } from "../../../../modules/trip/domain/trip-places.fixture";
import { runViewerAgentRuntime, type BedrockAgentConverse } from "./viewer-agent-runtime";
import { askProgressFixture, modelGroundedAnswer, modelTool, modelTools } from "./ask-progress-scenarios.fixture";
import { evaluateTravelProgress, type TravelProgressScenario } from "../../usecases/agent/evaluation/travel-progress-evaluation";
import type { AgentTrace } from "@raiquora/agent/agent-trace";
import type { AgentTurnObservation } from "@raiquora/agent/agent-turn-outcome";
import type { TravelCandidateAssessment } from "@raiquora/trip/travel-candidate-assessment";

export const candidateAssessmentCaseIds = ["V-weather-comparison", "W-weather-unavailable", "X-hazard", "Y-geographic-mismatch", "Z-price-partial"];

/** Only model/provider IO is synthetic. Runs the production registry, Domain and grounding policy. */
export async function runCandidateAssessmentScenario(scenario: TravelProgressScenario, live?: BedrockAgentConverse) {
  const a = candidateAssessmentFixture(), b = candidateAssessmentFixture("candidate-b");
  if (scenario.id === "V-weather-comparison") a.facts.weather!.result.data = forecastFixture(80);
  if (scenario.id === "W-weather-unavailable") {
    a.facts.weather!.result = { status: "unavailable", freshness: "unknown", evidence: [], failure: { code: "timeout", message: "Synthetic timeout", retryable: true } };
    b.facts.weather!.target.endDate = "2026-10-01";
  }
  if (scenario.id === "X-hazard") a.facts.hazard = { place: a.destination.ref!, result: assessedInformation({ area: "Synthetic Vienna", alerts: [
    { providerAlertId: "warning", category: "warning", severity: "warning", title: "Synthetic warning", summary: "注意情報", issuedAt: "2026-09-12T07:50:00Z", sourceUrl: "https://example.com/warning" },
  ] }, [assessmentSource("hazard", "safety-alert")]) };
  if (scenario.id === "Y-geographic-mismatch") {
    const other = resolvedPlace("Vienna", "same-name-other-region");
    a.facts.places = assessedInformation({ destinations: [other], complete: true }, other.sources);
  }
  if (scenario.id === "Z-price-partial") {
    a.candidate.accommodations = [...a.candidate.accommodations, { ...a.candidate.accommodations[0]!, providerItemId: "other", price: {
      price: { currency: "JPY", amountMinor: 10000 }, observedAt: "2026-09-12T07:54:00Z" } }];
    a.facts.prices!.data!.items.push({ provider: "fixture", providerItemId: "other", observation: a.candidate.accommodations[1]!.price! });
    a.facts.prices!.evidence.push(assessmentSource("other-price", "accommodation", "fixture", "other"));
    a.candidate.experiences = [{ kind: "experience", provider: "fixture", providerItemId: "unpriced", name: "未取得の料金", startDate: "2026-09-13" }];
    delete a.facts.weather;
  }
  const before = JSON.stringify(a.trip), f = askProgressFixture("C-candidate");
  let calls = 0, trace: AgentTrace | undefined, observation: AgentTurnObservation | undefined, acquisitionCalls = 0;
  const assessments = new Map<string, TravelCandidateAssessment>();
  const response = await runViewerAgentRuntime(scenario.userRequest, { ...f.base, getCurrentTrip: () => a.trip,
    getTravelCandidates: () => [a, b].map((value) => ({ id: value.candidate.id, label: value.destination.name })),
    candidateSelection: { taskId: "task", port: { resolve: async (id) => {
      const v = [a, b].find((value) => value.candidate.id === id);
      return v ? { candidate: v.candidate, tripId: a.trip.id, taskId: "task", validUntil: "2026-09-13T08:00:00Z", assessmentFacts: v.facts } : undefined;
    }, loadTimetables: async () => { acquisitionCalls++; return []; } } },
    getCurrentDate: () => new Date(assessmentAt),
    onTurnObservation: (value) => { observation = value; }, storeAgentTrace: async (value) => { trace = value; },
  }, async (...args) => {
    for (const message of args[0]) for (const block of message.content) {
      if (!("toolResult" in block)) continue;
      for (const content of block.toolResult.content) {
        const result = content.json as { assessment?: TravelCandidateAssessment } | undefined;
        if (result?.assessment) assessments.set(result.assessment.candidateId, result.assessment);
      }
    }
    const call = calls++;
    if (live) return live(...args);
    if (call === 0) return modelTools(...[a, b].map((v) => modelTool("assess_travel_candidate", { candidateId: v.candidate.id }, v.candidate.id)));
    return modelGroundedAnswer(args[0]);
  });
  const report = evaluateTravelProgress(scenario.id, [{ observation, trace, delivered: true, modelCalls: calls }], scenario.thresholds, live ? "live" : "scripted");
  const failures: string[] = [];
  const aa = assessments.get(a.candidate.id), bb = assessments.get(b.candidate.id);
  if (!aa || !bb) failures.push("candidate comparison not delivered to model");
  if (aa && bb) {
    if (scenario.id === "V-weather-comparison" && (aa.weather.status !== "poor" || bb.weather.status !== "favorable" || !aa.weather.evidenceIds.length)) failures.push("weather facts/refs lost");
    if (scenario.id === "W-weather-unavailable" && (aa.weather.status !== "unavailable" || bb.weather.status !== "unknown" || !bb.weather.reasonCodes.includes("forecast-range-out"))) failures.push("unavailable became favorable");
    if (scenario.id === "X-hazard" && (aa.hazard.status !== "present" || !aa.caveats.some((c) => c.code === "hazard-present"))) failures.push("hazard lost");
    if (scenario.id === "Y-geographic-mismatch" && (aa.relevance.status !== "questionable" || aa.constraintStatus !== "violated")) failures.push("geographic mismatch ignored");
    if (scenario.id === "Z-price-partial" && (aa.price.comparability !== "mixed-currency" || aa.price.subtotals.length !== 2 || !aa.price.unpricedItemCount || !aa.partial)) failures.push("fake price total or missing partial");
  }
  if (JSON.stringify(a.trip) !== before || acquisitionCalls) failures.push("assessment wrote Trip or acquired extra data");
  if (!live && (calls !== 2 || report.toolCalls !== 2)) failures.push("unexpected model/tool calls");
  if (typeof response !== "string" && "tripUpdateProposal" in response) failures.push("comparison unexpectedly adopted a candidate");
  report.contractFailures.push(...failures); report.failures.push(...failures); report.passed = !report.failures.length;
  return report;
}
