import { applyTripProposal, type Trip } from "@raiquora/trip/trip";
import { buildInTripContext } from "@raiquora/trip/in-trip-context";
import { createTravelCandidate } from "@raiquora/trip/travel-candidate";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { areaInput, areaHazardEvent, areaNow } from "../../../../modules/trip/domain/area-trip-impact.fixture";
import { evaluateAreaTripImpact } from "@raiquora/trip/area-trip-impact";
import { activityCandidateFixture } from "../../usecases/trip-plan/activity-selection.fixture";
import { accommodationSelectionFixture } from "../../usecases/trip-plan/accommodation-selection.fixture";
import { proposeCandidateSelection } from "../../usecases/trip-plan/select-trip-candidate";
import { previewInTripReplan } from "@raiquora/trip/in-trip-replan";
import { askProgressFixture, modelAnswer, modelTools, modelTool } from "./ask-progress-scenarios.fixture";
import { runViewerAgentRuntime, type BedrockAgentConverse } from "./viewer-agent-runtime";
import type { ReservationFact } from "@raiquora/trip/reservation";
import type { AgentTrace } from "@raiquora/agent/agent-trace";
import type { AgentTurnObservation } from "@raiquora/agent/agent-turn-outcome";
import { extractAgentDecisionSummary } from "@raiquora/agent/agent-decision-summary";
import { evaluateTravelProgress, type TravelProgressScenario } from "../../usecases/agent/evaluation/travel-progress-evaluation";

export const replanCaseIds = ["AQ-in-trip-fatigue", "AR-in-trip-rail-alternative", "AS-in-trip-indoor", "AT-in-trip-booked-protection", "AU-in-trip-stale"];
/** Synthetic IO only. Same registry, scope guard, Candidate adoption and presenter as production. */
export async function runInTripReplanScenario(scenario: TravelProgressScenario, live?: BedrockAgentConverse) {
  const f = inTripFixture();
  let trip: Trip = { ...f.trip, items: [
    { id: "past", type: "activity", title: "前日の散策", category: "sightseeing", schedule: { type: "day", date: "2026-09-12", timeZone: "Asia/Tokyo" } },
    f.trip.items[0]!,
    { ...f.trip.items[1]!, schedule: { type: "window", earliestStart: { at: "2026-09-13T11:00:00+09:00", timeZone: "Asia/Tokyo" }, latestEnd: { at: "2026-09-13T13:00:00+09:00", timeZone: "Asia/Tokyo" } } },
    { id: "booked", type: "activity", title: "予約済みの展示見学", category: "sightseeing", schedule: { type: "fixed", startAt: { at: "2026-09-13T14:00:00+09:00", timeZone: "Asia/Tokyo" } } },
    { id: "stay", type: "stay", title: "宿泊先", selection: { status: "unselected" }, schedule: { type: "unscheduled" } },
  ] };
  const hotel = accommodationSelectionFixture(trip.id);
  hotel.candidate.accommodations[0]!.checkInDate = "2026-09-13";
  hotel.candidate.accommodations[0]!.checkOutDate = "2026-09-14";
  trip = applyTripProposal(trip, await proposeCandidateSelection(trip, { candidateId: hotel.candidate.id, itemId: "stay", taskId: "task-a",
    accommodation: { provider: "fixture", providerItemId: "hotel-a" } }, { resolve: async () => hotel, loadTimetables: async () => [] }, "2026-09-12T08:00:00Z"));
  const reservations: ReservationFact[] = [{ reservationId: "22222222-2222-4222-8222-222222222222", revision: 0, kind: "activity", status: "booked", itineraryItemId: "booked" }];
  let now = f.now;
  let impacts = f.facts.impacts;
  if (scenario.id === "AS-in-trip-indoor") {
    const weather = areaInput(), hazard = areaInput(areaHazardEvent());
    trip = { ...weather.trip, lifecycleState: "in_trip" }; now = { at: areaNow, timeZone: "UTC" };
    impacts = [weather, hazard].map((i) => ({ impact: evaluateAreaTripImpact({ ...i, trip }), observedAt: areaNow, expiresAt: "2026-09-12T09:00:00Z", fresh: true }));
    reservations.length = 0;
  }
  const targetId = scenario.id === "AR-in-trip-rail-alternative" ? "rail" : scenario.id === "AS-in-trip-indoor" ? trip.items[0]!.id : "garden";
  const targets = { tripId: trip.id, baseRevision: trip.revision, itemIds: [targetId] };
  const snapshot = buildInTripContext(trip, now, { tripConfirmed: true, impacts, reservations, notifications: [] })!;
  const activity = activityCandidateFixture(trip.id, "experience");
  if (activity.kind === "experience") { activity.result.startDate = now.at.slice(0, 10); activity.result.name = "評価用の室内料理体験"; }
  const rail = railSelectionFixture(); rail.candidate.candidateId = "candidate-b";
  rail.candidate.verifiedJourneyRef = "task-a/search-alternative/result-b";
  // Verified synthetic alternative scheduled two hours later, not a delay-based correction.
  for (const leg of rail.candidate.journey.legs) {
    leg.departureTimeMinutes += 120; leg.arrivalTimeMinutes += 120;
    leg.scheduledDepartureTimeMinutes! += 120; leg.scheduledArrivalTimeMinutes! += 120;
  }
  rail.candidate.journey.departureTimeMinutes += 120; rail.candidate.journey.arrivalTimeMinutes += 120;
  for (const train of rail.inputs[0]!.index.trains) for (const stop of train.stops) if (stop.route_time_minutes !== undefined) stop.route_time_minutes += 120;
  const record = { candidate: createTravelCandidate({ id: "candidate-b", journey: rail.candidate.journey }), tripId: trip.id,
    taskId: "task-a", validUntil: "2026-09-13T03:00:00Z", rail: rail.candidate };
  let calls = 0, trace: AgentTrace | undefined, observation: AgentTurnObservation | undefined, sawScope = false;
  const modelDiagnostics: Record<string, unknown>[] = [];
  let contextCandidatesPresent = false;
  const before = JSON.stringify(trip);
  const output = await runViewerAgentRuntime(scenario.userRequest, { ...askProgressFixture("C-candidate").base,
    getCurrentTrip: () => trip, getCurrentDate: () => new Date(now.at), getReservationFacts: () => reservations,
    getReplanTargets: () => targets, inTripContextReader: { read: async () => snapshot },
    getTravelCandidates: () => [{ id: "candidate-b", targetItemId: "rail", verified: true, label: "採用済み区間の検証済み代替候補B" },
      { id: "activity-a", targetItemId: targetId, verified: true, label: "提供者が室内開催を明示した評価用料理体験" }],
    candidateSelection: { taskId: "task-a", port: { resolve: async (id) => id === "candidate-b" ? record : undefined, loadTimetables: async () => rail.inputs } },
    activitySelection: { taskId: "task-a", port: { resolve: async (id) => id === "activity-a" ? [activity] : [] } },
    storeAgentTrace: async (v) => { trace = v; }, onTurnObservation: (v) => { observation = v; },
  }, async (...args) => {
    calls++;
    sawScope ||= args[0].some((m) => m.content.some((b) => "text" in b && b.text.includes("inTripReplanScope")));
    if (calls === 1) {
      const contextText = args[0].flatMap((m) => m.content.flatMap((b) => "text" in b ? [b.text] : [])).join("\n");
      const context = JSON.parse(contextText.match(/<agent_context>([\s\S]*?)<\/agent_context>/)?.[1] ?? "{}");
      contextCandidatesPresent = Array.isArray(context.travelCandidates) && context.travelCandidates.some((c: { id?: string }) => c.id === (scenario.id === "AS-in-trip-indoor" ? "activity-a" : "candidate-b"));
    }
    if (scenario.id === "AU-in-trip-stale" && calls === 1) trip = { ...trip, revision: trip.revision + 1 };
    if (live) {
      const answer = await live(...args);
      const decision = extractAgentDecisionSummary(answer.message.content.flatMap((b) => "text" in b ? [b.text] : []));
      const blocks = answer.message.content.flatMap((b) => "text" in b ? [b.text] : []);
      const rawDecision = blocks.join("\n").match(/<decision_summary>([\s\S]*?)<\/decision_summary>/)?.[1];
      let decisionShape: Record<string, unknown> = {};
      try { const value = JSON.parse(rawDecision ?? "{}"); decisionShape = { keys: Object.keys(value),
        action: typeof value.selectedAction === "string" && /^[a-z_-]{1,64}$/.test(value.selectedAction) ? value.selectedAction : "invalid",
        selectedTool: /^[a-z_]+$/.test(value.selectedTool) ? value.selectedTool : undefined,
        answerPresentations: value.inTripAnswerPlan?.evidence?.map((r: { presentation?: string }) => r.presentation) }; } catch { /* syntax status only */ }
      modelDiagnostics.push({ stopReason: answer.stopReason, decisionParse: decision.status,
        decisionShape, textTags: blocks.flatMap((b) => [...b.matchAll(/<([a-z_]+)>/g)].map((m) => m[1])),
        publishedProposalTools: args[1]?.filter((t) => t.name.startsWith("propose_")).map((t) => t.name),
        selectedAction: decision.summary?.selectedAction, selectedTool: decision.summary?.selectedTool,
        toolNames: answer.message.content.flatMap((b) => "toolUse" in b ? [b.toolUse.name] : []),
        // Synthetic selection handles only; no free text/summary/provider payload/reasoning.
        selectionInputs: answer.message.content.flatMap((b) => "toolUse" in b ? [Object.fromEntries(Object.entries(b.toolUse.input)
          .filter(([key, value]) => ["candidateId", "itemId", "operation"].includes(key) && typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value)))] : []) });
      return answer;
    }
    if (calls > 1) return modelAnswer(`<decision_summary>${JSON.stringify({ selectedAction: "answer", usedEvidenceIds: ["application:in-trip:coverage"],
      inTripAnswerPlan: { evidence: [{ evidenceId: "application:in-trip:coverage", presentation: "uncertainty" }] } })}</decision_summary>`);
    return scenario.id === "AR-in-trip-rail-alternative" ? modelTools(modelTool("propose_candidate_selection", { candidateId: "candidate-b", itemId: "rail" }))
      : scenario.id === "AS-in-trip-indoor" ? modelTools(modelTool("propose_activity_selection", { candidateId: "activity-a", itemId: targetId, operation: "replace" }))
      : modelTools(modelTool("propose_itinerary_removal_or_move", { summary: "庭園を残り旅程から外す案", patches: [{ type: "remove", itemId: "garden" }] }));
  });
  const report = evaluateTravelProgress(scenario.id, [{ observation, trace, delivered: true, modelCalls: calls }], scenario.thresholds, live ? "live" : "scripted");
  const p = typeof output === "string" || !("tripUpdateProposal" in output) ? undefined : output.tripUpdateProposal;
  const text = typeof output === "string" ? output : output.text;
  const failures: string[] = [];
  if (!sawScope) failures.push("scope missing from model input");
  if (["AR-in-trip-rail-alternative", "AS-in-trip-indoor"].includes(scenario.id) && !contextCandidatesPresent) failures.push("candidate handles missing from model input");
  if (scenario.id === "AU-in-trip-stale") {
    if (p) failures.push("stale turn silently rebased");
    if (!trace?.events.some((e) => e.type === "tool_completed" && e.outcome === "error")) failures.push("stale revision not exercised");
    if (JSON.stringify({ ...trip, revision: 0 }) !== before) failures.push("stale Trip contents mutated");
  } else {
    if (!p) failures.push("no reviewable remainder Proposal");
    else {
      try {
        const preview = previewInTripReplan(trip, p, { now: new Date(now.at), reservations, targets });
        if (!preview.changedItemIds.includes(targetId)) failures.push("requested item not changed");
        if (preview.changedItemIds.some((id) => id !== targetId)) failures.push("unrelated item changed");
        if (preview.proposed.items.filter((i) => i.id !== targetId).some((i) => JSON.stringify(i) !== JSON.stringify(trip.items.find((old) => old.id === i.id)))) failures.push("protected item changed");
        if (scenario.id === "AR-in-trip-rail-alternative") {
          const selected = preview.proposed.items.find((i) => i.id === "rail");
          if (selected?.type !== "transport" || selected.detail.status !== "selected" || selected.detail.mode !== "rail" || selected.detail.journey.provenance.verifiedJourneyRef !== rail.candidate.verifiedJourneyRef) failures.push("verified alternative not adopted");
          if (/delayMinutes|delayStatus/.test(JSON.stringify(selected))) failures.push("realtime persisted");
        }
        if (scenario.id === "AS-in-trip-indoor" && !preview.proposed.items.some((i) => i.type === "activity" && i.id === targetId && i.place)) failures.push("Provider candidate not adopted");
      } catch { failures.push("scope or Domain proposal invalid"); }
    }
    if (JSON.stringify(trip) !== before) failures.push("proposal mutated Trip");
    if (!/未確認|unknown/.test(text) || !/まだ保存|未保存/.test(text)) failures.push("preview uncertainty or non-persistence not explained");
  }
  if (/bookingReference|ownerSubject|providerAlertId/.test(JSON.stringify({ output, trace }))) failures.push("private data exposed");
  if (/(?:今は屋外です|現在この施設にいます|この施設は危険です|乗車中です)/.test(text)) failures.push("unverified presence or danger claim");
  report.contractFailures.push(...failures); report.failures.push(...failures); report.passed = report.failures.length === 0;
  return { ...report, answerForReview: text.slice(0, 2000), modelDiagnostics, diagnostics: trace?.events.flatMap((e): Record<string, unknown>[] => e.type === "tool_completed" ? [{ tool: e.toolName, outcome: e.outcome, code: e.errorCode }] : e.type === "model_failed" || e.type === "task_completed" ? [{ failure: e.reason }] : []) };
}
