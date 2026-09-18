import { bookedReservationChanges, reservationFact } from "@raiquora/trip/reservation";
import { reservationFixture } from "../../../../modules/trip/domain/reservation.fixture";
import { multiCityTrip } from "../../../../modules/trip/domain/trip-places.fixture";
import { runViewerAgentRuntime, type BedrockAgentConverse } from "./viewer-agent-runtime";
import { askProgressFixture, modelAnswer, modelTool, modelTools } from "./ask-progress-scenarios.fixture";
import { evaluateTravelProgress, type TravelProgressScenario } from "../../usecases/agent/evaluation/travel-progress-evaluation";
import type { AgentTrace } from "@raiquora/agent/agent-trace";
import type { AgentTurnObservation } from "@raiquora/agent/agent-turn-outcome";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";

/** AB: real Context/Tool/Proposal/confirmation paths, authored model IO (not live quality evidence). */
export async function runReservationProgressScenario(scenario: TravelProgressScenario, live?: BedrockAgentConverse) {
  const trip = multiCityTrip(), original = JSON.stringify(trip), base = askProgressFixture("C-candidate").base;
  const reservation = reservationFixture({ tripId: trip.id });
  const facts = [reservationFact(reservation)];
  let calls = 0, context = "", trace: AgentTrace | undefined, observation: AgentTurnObservation | undefined;
  const response = await runViewerAgentRuntime(scenario.userRequest, { ...base,
    getCurrentTrip: () => trip, getUiFocus: () => ({ itemId: "activity" }), getReservationFacts: () => facts,
    getTravelCandidates: () => [], storeAgentTrace: async (v) => { trace = v; }, onTurnObservation: (v) => { observation = v; },
  }, async (...args) => {
    if (!context) context = JSON.stringify(args[0]);
    const n = calls++;
    if (live) return live(...args);
    if (!n) return modelTools(modelTool("propose_manual_activity", { operation: "replace", itemId: "activity", title: "散策を短くする案", category: "sightseeing",
      schedule: { type: "day", date: "2026-09-24", timeZone: "Europe/Zurich" } }));
    return modelAnswer("予約済みの予定の変更案です。予約は変更・取消されません。予約への影響を確認してから、この変更案を反映してよいか明示確認をお願いします。");
  });
  const report = evaluateTravelProgress(scenario.id, [{ observation, trace, delivered: true, modelCalls: calls }], scenario.thresholds, live ? "live" : "scripted");
  const failures: string[] = [];
  const proposal = typeof response !== "string" && "tripUpdateProposal" in response ? response.tripUpdateProposal : undefined;
  if (!context.includes('booked') || !context.includes('reservations')) failures.push("booking context missing");
  if (/PRIVATE-TEST-REFERENCE|bookingReference|bookingUrl/.test(context)) failures.push("private booking data sent to model");
  if (JSON.stringify(trip) !== original || reservation.status !== "booked") failures.push("source booking/Trip mutated");
  if (!JSON.stringify(response).includes("確認")) failures.push("booking change confirmation absent");
  if (!proposal || !bookedReservationChanges(proposal, facts).length) failures.push("no reviewable booked-item proposal");
  else {
    let written = false;
    const workspace = createTripWorkspaceController("AB");
    workspace.attach("AB", { getCurrentTrip: () => trip, getReservationFacts: () => facts, confirmProposal: async () => { written = true; } });
    workspace.preview(proposal);
    try { await workspace.confirm(); failures.push("implicit confirmation accepted"); } catch { /* expected */ }
    if (written) failures.push("booked item silently written");
  }
  report.contractFailures.push(...failures); report.failures.push(...failures); report.passed = !report.failures.length;
  return report;
}
