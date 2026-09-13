import { evaluateTripFeasibility } from "@raiquora/trip/trip-feasibility";
import { applyTripProposal } from "@raiquora/trip/trip";
import { reservationFact } from "@raiquora/trip/reservation";
import { reservationFixture } from "../../../../modules/trip/domain/reservation.fixture";
import { requestTrip } from "../../../../modules/trip/domain/trip-request.fixture";
import { feasibilityActivity, feasibilityInstant, feasibilityNow } from "../../../../modules/trip/domain/trip-feasibility.fixture";
import { runViewerAgentRuntime, type BedrockAgentConverse } from "./viewer-agent-runtime";
import { askProgressFixture, modelAnswer, modelTool, modelTools } from "./ask-progress-scenarios.fixture";
import { evaluateTravelProgress, type TravelProgressScenario } from "../../usecases/agent/evaluation/travel-progress-evaluation";
import type { AgentTrace } from "../../usecases/agent/agent-trace";
import type { AgentTurnObservation } from "../../usecases/agent/agent-turn-outcome";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";

export const feasibilityCaseIds = ["AC-impossible-itinerary", "AD-reservation-conflict", "AE-unknown-facts"];
/** Model IO is scripted; actual Runtime Context, Tool/Proposal and deterministic confirmation run. */
export async function runFeasibilityProgressScenario(scenario: TravelProgressScenario, live?: BedrockAgentConverse) {
  const unknown = scenario.id === "AE-unknown-facts", booking = scenario.id === "AD-reservation-conflict";
  const item = unknown ? { ...feasibilityActivity(), schedule: { type: "unscheduled" as const } } : feasibilityActivity();
  const trip = requestTrip(undefined, scenario.id === "AC-impossible-itinerary" ? [item, feasibilityActivity("overlap")] : [item]);
  const reservations = unknown ? undefined : booking ? [reservationFact(reservationFixture({ startsAt: feasibilityInstant(11), endsAt: feasibilityInstant(12) }))] : [];
  const input = { tripId: trip.id, tripRevision: trip.revision, reservations };
  const before = JSON.stringify(trip), evaluation = evaluateTripFeasibility(trip, input, feasibilityNow);
  const expected = unknown ? "unknown" : "infeasible", target = scenario.id === "AC-impossible-itinerary" ? "overlap" : "activity";
  let calls = 0, context = "", trace: AgentTrace | undefined, observation: AgentTurnObservation | undefined;
  const response = await runViewerAgentRuntime(scenario.userRequest, { ...askProgressFixture("C-candidate").base,
    getCurrentTrip: () => trip, getUiFocus: () => ({ itemId: target }), getReservationFacts: () => reservations,
    getTravelCandidates: () => [], storeAgentTrace: async (v) => { trace = v; }, onTurnObservation: (v) => { observation = v; },
  }, async (...args) => {
    if (!context) context = JSON.stringify(args[0]);
    const n = calls++;
    if (live) return live(...args);
    if (!n) return modelTools(modelTool("propose_manual_activity", { operation: "replace", itemId: target, title: "日時を調整する案", category: "free-time",
      schedule: unknown ? { type: "day", date: "2026-09-14", timeZone: "Asia/Tokyo" } :
        { type: "fixed", startAt: feasibilityInstant(11), endAt: feasibilityInstant(12) } }));
    return modelAnswer(unknown ? "日時と予約は未確認です。日付だけを仮置きする変更案です。成立はまだ確認できません。" :
      booking ? "予約の固定日時と予定が不一致です。予約時刻に合わせる変更案です。予約自体は変更せず、影響を確認してください。" :
      "予定の時間が重なり不成立です。後の予定をずらす変更案を示します。確認前に自動適用しません。");
  });
  const report = evaluateTravelProgress(scenario.id, [{ observation, trace, delivered: true, modelCalls: calls }], scenario.thresholds, live ? "live" : "scripted");
  const failures: string[] = [];
  const proposal = typeof response !== "string" && "tripUpdateProposal" in response ? response.tripUpdateProposal : undefined;
  if (evaluation.status !== expected || !context.includes("tripFeasibility") || !context.includes(expected)) failures.push("deterministic feasibility missing from model context");
  if (/PRIVATE-TEST-REFERENCE|bookingReference|providerItemId/.test(context)) failures.push("private reservation leaked");
  if (!proposal) failures.push("no reviewable correction proposal");
  else {
    const proposed = applyTripProposal(trip, proposal), after = evaluateTripFeasibility(proposed, input, feasibilityNow);
    if (unknown ? after.status !== "unknown" : after.status !== "feasible") failures.push("proposal does not preserve unknown or resolve the proven conflict");
  }
  if (JSON.stringify(trip) !== before || evaluateTripFeasibility(trip, input, feasibilityNow).status !== expected) failures.push("model mutated/cleared authoritative evaluation");
  const workspace = createTripWorkspaceController("feasibility", () => new Date(feasibilityNow)); let written = false;
  workspace.attach("feasibility", { getCurrentTrip: () => trip, getReservationFacts: () => reservations, confirmProposal: async () => { written = true; } });
  workspace.propose("モデルが問題ないと主張", [{ type: "planning", state: "ready" }]);
  try { await workspace.confirm(); failures.push("invalid ready accepted"); } catch { /* deterministic gate, not model confidence */ }
  if (written) failures.push("unknown/infeasible Trip written as ready");
  report.contractFailures.push(...failures); report.failures.push(...failures); report.passed = !report.failures.length;
  return report;
}
