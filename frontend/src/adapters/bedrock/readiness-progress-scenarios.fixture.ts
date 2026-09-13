import { evaluateTripFeasibility } from "@raiquora/trip/trip-feasibility";
import { projectTripReadiness } from "@raiquora/trip/trip-readiness";
import type { ReservationFact } from "@raiquora/trip/reservation";
import { feasibilityStayTrip, feasibilityNow, feasibilityObservation } from "../../../../modules/trip/domain/trip-feasibility.fixture";
import { checklistItem } from "../../../../modules/trip/domain/trip-checklist.fixture";
import { runViewerAgentRuntime, type BedrockAgentConverse } from "./viewer-agent-runtime";
import { askProgressFixture, modelAnswer, modelTool, modelTools } from "./ask-progress-scenarios.fixture";
import { evaluateTravelProgress, type TravelProgressScenario } from "../../usecases/agent/evaluation/travel-progress-evaluation";
import type { AgentTrace } from "../../usecases/agent/agent-trace";
import type { AgentTurnObservation } from "../../usecases/agent/agent-turn-outcome";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";

export const readinessCaseIds = ["AF-preparation-after-ready", "AG-booking-unknown", "AH-repeated-checklist"];
/** Real production runtime/context/tool plus confirmation preview; scripted model IO, not a live quality claim. */
export async function runReadinessProgressScenario(scenario: TravelProgressScenario, live?: BedrockAgentConverse) {
  const f = feasibilityStayTrip(), unknown = scenario.id === "AG-booking-unknown", repeated = scenario.id === "AH-repeated-checklist";
  const trip = { ...f.trip, planningState: "ready" as const };
  const reservations: ReservationFact[] = [{ reservationId: checklistItem().id, revision: 0, itineraryItemId: f.stay.id, kind: "accommodation", status: unknown ? "unknown" : "booked" }];
  const facts = { ...f.facts, reservations, ...(unknown ? { external: [...f.facts.external!, feasibilityObservation({ type: "visit", item: f.stay, available: true, reservationRequired: true })] } : {}) };
  const items = [checklistItem({ tripId: trip.id, status: repeated ? "done" : "open" })];
  const before = JSON.stringify({ trip, items, reservations });
  const evaluation = evaluateTripFeasibility(trip, facts, feasibilityNow), readiness = projectTripReadiness(trip, evaluation, reservations, items);
  let calls = 0, context = "", trace: AgentTrace | undefined, observation: AgentTurnObservation | undefined;
  const response = await runViewerAgentRuntime(scenario.userRequest, { ...askProgressFixture("C-candidate").base,
    getCurrentTrip: () => trip, getReservationFacts: () => reservations, getChecklistItems: () => items, getFeasibilityExternalFacts: () => facts.external,
    getTravelCandidates: () => [], storeAgentTrace: async (v) => { trace = v; }, onTurnObservation: (v) => { observation = v; },
  }, async (...args) => {
    if (!context) context = JSON.stringify(args[0]);
    const n = calls++; if (live) return live(...args);
    if (!unknown && !n) return modelTools(modelTool("propose_preparation_checklist", { suggestions: [
      { category: repeated ? "connectivity" : "documents", title: repeated ? " ＳＩＭ " : "必要な書類を確認する" },
    ] }));
    return modelAnswer(unknown ? "宿は旅程に採用済みですが、予約は未確認です。予約が必要という情報があるため、予約状態を確認しましょう。" :
      repeated ? "SIMは既に準備リストで完了しています。同じ項目を追加したり、未完了に戻したりはしません。" :
      "旅程はreadyですが、SIMの準備はまだ残っています。書類確認の追加案も示します。準備の完了と旅程の成立は別で、宿の正確な時刻や営業条件も未確認です。");
  });
  const report = evaluateTravelProgress(scenario.id, [{ observation, trace, delivered: true, modelCalls: calls }], scenario.thresholds, live ? "live" : "scripted");
  const failures: string[] = [];
  if (!context.includes("tripReadiness") || !context.includes("preparationReadState")) failures.push("readiness missing from model context");
  if (/bookingReference|PRIVATE-TEST-REFERENCE/.test(context)) failures.push("private reservation leaked");
  if (readiness.blocksReady !== unknown || trip.planningState !== "ready") failures.push("preparation coupled to ready certification/state");
  if (unknown && !readiness.booking.some((i) => i.code === "reservation_required") || !unknown && !readiness.planning.some((i) => i.code === "stay_visit_unchecked")) failures.push("booking/unknown policy lost");
  const proposal = typeof response !== "string" && "checklistProposal" in response ? response.checklistProposal : undefined;
  const workspace = createTripWorkspaceController("readiness", () => new Date(feasibilityNow)); let writes = 0;
  workspace.attach("readiness", { getCurrentTrip: () => trip, getReservationFacts: () => reservations, getFeasibilityExternalFacts: () => facts.external,
    checklist: { getItems: () => items, write: async () => { writes++; } } });
  if (repeated) {
    if (proposal) failures.push("duplicate visible proposal");
    workspace.checklist.preview({ tripId: trip.id, suggestions: [{ category: "connectivity", title: "SIM" }] });
    if (workspace.checklist.proposal()) failures.push("duplicate confirmation preview");
  } else if (!unknown) {
    if (!proposal) failures.push("no typed preparation preview");
    else workspace.checklist.preview(proposal);
  }
  if (writes || JSON.stringify({ trip, items, reservations }) !== before) failures.push("unconfirmed suggestion mutated authoritative state");
  if (report.ttfc !== null || report.ttfi !== null) failures.push("preparation mislabeled as candidates/itinerary");
  report.contractFailures.push(...failures); report.failures.push(...failures); report.passed = !report.failures.length;
  return report;
}
