import { applyTripProposal, type Trip } from "@raiquora/trip/trip";
import { evaluateTripHardConstraints } from "@raiquora/trip/trip-constraint-evaluation";
import { proposeCandidateSelection } from "../../usecases/trip-plan/select-trip-candidate";
import type { AgentTurnObservation } from "../../usecases/agent/agent-turn-outcome";
import type { AgentTrace } from "../../usecases/agent/agent-trace";
import { evaluateTravelProgress, type TravelProgressScenario, type TravelProgressTurn } from "../../usecases/agent/evaluation/travel-progress-evaluation";
import { askProgressFixture, modelAnswer, modelTool, modelTools, progressQuestion, progressSource, type ProgressCaseId } from "./ask-progress-scenarios.fixture";
import { runViewerAgentRuntime, type BedrockAgentConverse } from "./viewer-agent-runtime";
import type { BedrockAgentResponse } from "../http/agent-api/bedrock-agent";
import { activityCandidateFixture } from "../../usecases/trip-plan/activity-selection.fixture";
import { travelPreferenceLabels, type UserProfile } from "@raiquora/trip/travel-profile";

const usualFamily: UserProfile = {
  version: 2, home: { carAvailable: false }, companions: { usual: ["family"], children: [{ ageGroup: "preschool" }, { ageGroup: "elementary" }] },
  travelStyle: { pace: 0.5, novelty: 0.5, crowdTolerance: 0.5, walkingTolerance: 0.5, transferTolerance: 0.5,
    earlyMorningTolerance: 0.5, lateNightTolerance: 0.5, drivingTolerance: 0.5, busTolerance: 0.5 },
  preferences: Object.fromEntries(Object.keys(travelPreferenceLabels).map((key) => [key, 0.5])) as UserProfile["preferences"],
  transport: { maxTypicalTravelMinutes: null }, updatedAt: "2026-09-12T08:00:00Z",
};

const fixtureBases: Record<string, ProgressCaseId> = {
  "A-vague": "A-vague", "B-known-region": "B-known-region", "C-candidate": "C-candidate",
  "D-known-request": "D-known-request", "E-past": "E-past", "F-hard-unknown": "F-hard-unknown",
  "G-consecutive": "G-consecutive", "H-day-trip": "C-candidate", "I-multi-day": "C-candidate", "J-refinement": "C-candidate",
  "K-food": "C-candidate", "L-free-time": "C-candidate",
  "M-known-party": "C-candidate", "N-unknown-child-age": "C-candidate",
  "O-taxi": "C-candidate", "P-air-provisional": "C-candidate",
};

/** Synthetic conversations through the production registry, policies, evidence and presenter.
 * Scripts replace only the model/provider IO; no new production planner or writer.
 * H/I/J start with the existing verified-candidate seam, not an invented V2 item-creation Tool.
 */
export async function runTravelProgressScenario(definition: TravelProgressScenario, live?: BedrockAgentConverse) {
  const id = definition.id;
  if (!Object.hasOwn(fixtureBases, id)) throw new Error("Unknown trip progress scenario");
  const scenario = { ...definition, base: fixtureBases[id]! };
  const fixture = askProgressFixture(scenario.base);
  const selectionFixture = askProgressFixture("C-candidate");
  const selection = selectionFixture.base.candidateSelection!;
  const record = structuredClone((await selection.port.resolve("candidate-a"))!);
  const timetables = structuredClone(await selection.port.loadTimetables(record.rail!));
  // Authored dates/station identities agree with the synthetic request, never a real timetable.
  record.rail!.legReferences.forEach((ref) => { ref.serviceDate = "2026-09-21"; });
  timetables.forEach((input) => { input.index.service_date = "2026-09-21"; });
  record.candidate.accommodations = [{ kind: "accommodation", provider: "fixture", providerItemId: "hotel-a", name: "評価用の森の宿A",
    checkInDate: "2026-09-21", checkOutDate: "2026-09-24", availability: "unknown" }];
  record.accommodation = { provider: "fixture", providerItemId: "hotel-a", storageAllowed: true,
    placeRetention: { origin: "provider", provider: "fixture", storage: "permitted", allowedFields: ["ref", "name", "sources", "capturedAt"] },
    source: { id: "hotel-evidence", kind: "accommodation", provider: "fixture", sourceId: "hotel-a", retrievedAt: "2026-09-12T07:55:00Z", confidence: "observed" } };
  const port = { resolve: async (candidateId: string) => candidateId === record.candidate.id ? record : undefined,
    loadTimetables: async () => timetables };
  let trip: Trip = scenario.base === "E-past" ? fixture.trip : { ...fixture.trip, items: selectionFixture.trip.items };
  if (id === "H-day-trip") trip = { ...trip, items: trip.items.filter((i) => i.type === "transport") };
  const partyCase = id === "M-known-party" || id === "N-unknown-child-age";
  const transportCase = id === "O-taxi" || id === "P-air-provisional";
  if (partyCase) trip = { ...trip, request: { ...trip.request, party: { adults: 2, children: id === "N-unknown-child-age" ? [{}] : [],
    composition: id === "M-known-party" ? ["partner"] : ["family"], source: "user" } } };
  const adoption = (candidateId = "candidate-a") => modelTools(modelTool("propose_candidate_selection", { candidateId, itemId: "outbound" }));
  if (["J-refinement", "K-food", "L-free-time"].includes(id)) {
    trip = { ...applyTripProposal(trip, await proposeCandidateSelection(trip,
      { taskId: "task-a", candidateId: "candidate-a", itemId: "outbound" }, port, "2026-09-12T08:00:00Z")), planningState: "itinerary_refinement" };
  }
  if (id === "J-refinement") {
    record.candidate.id = "candidate-b"; record.rail!.candidateId = "candidate-b";
    record.rail!.verifiedJourneyRef = "task-a/search-2/result-1";
    record.rail!.journey.legs[0]!.trainNumber = "9M";
    record.candidate.journey = structuredClone(record.rail!.journey);
    timetables[0]!.index.trains[0]!.train_no = "9M";
    timetables[0]!.contentDigest = "sha256:fixture-b";
    record.rail!.legReferences.forEach((ref) => { ref.contentDigest = "sha256:fixture-b"; });
  }
  const original = structuredClone(trip);
  const activity = activityCandidateFixture(trip.id);
  const research = [...fixture.scripts];
  if (!["C-candidate", "E-past"].includes(scenario.base)) {
    // Keep #425's grounded Web decision and add a genuine typed visible candidate result.
    research.splice(research.length - 1, 0, modelTools(modelTool("search_place_media", { query: "評価用の森の温泉郷", limit: 2 })));
  }
  const plan: Array<{ prompt: string; scripts: BedrockAgentResponse[]; selection?: boolean; chooseVisible?: boolean }> = [];
  if (id === "G-consecutive") plan.push({ prompt: "自然を楽しむ旅行をしたい", scripts: [modelTools(modelTool("ask_follow_up", progressQuestion))] });
  plan.push({ prompt: scenario.userRequest,
    scripts: transportCase ? [modelTools(modelTool("propose_manual_transport", {
      itemId: "transfer", operation: "add", title: id === "O-taxi" ? "ホテルから空港へ" : "東京から札幌へ",
      mode: id === "O-taxi" ? "taxi" : "air", origin: id === "O-taxi" ? "ホテル" : "東京", destination: id === "O-taxi" ? "空港" : "札幌",
      schedule: id === "O-taxi" ? { type: "day", date: "2026-09-22" } : { type: "unscheduled" },
    }))] : partyCase ? [
      ...(id === "M-known-party" ? [modelTools(modelTool("ask_follow_up", { question: "何人ですか", expectedInput: "free-text", requestedRequirement: "party" }))] : []),
      modelTools(modelTool("propose_manual_activity", { itemId: "free", operation: "add", title: "自由時間", category: "free-time", schedule: { type: "unscheduled" } })),
    ] : id === "K-food" ? [modelTools(modelTool("propose_activity_selection", { candidateId: "activity-a", operation: "add", itemId: "meal",
      schedule: { type: "day", date: "2026-09-22" } }))] : id === "L-free-time" ? [modelTools(modelTool("propose_manual_activity", {
        itemId: "free", operation: "add", title: "自由時間", category: "free-time", schedule: { type: "window",
          earliestStart: { at: "2026-09-22T14:00:00+09:00", timeZone: "Asia/Tokyo" },
          latestEnd: { at: "2026-09-22T16:00:00+09:00", timeZone: "Asia/Tokyo" }, durationMinutes: 120 },
      }))] : id === "I-multi-day" ? [modelTools(
      modelTool("propose_candidate_selection", { candidateId: "candidate-a", itemId: "outbound" }, "rail"),
      modelTool("propose_candidate_selection", { candidateId: "candidate-a", itemId: "stay", accommodation: { provider: "fixture", providerItemId: "hotel-a" } }, "hotel"))] :
      id === "J-refinement" ? [adoption("candidate-b")] : research,
    selection: scenario.base === "C-candidate" && id !== "L-free-time" && !partyCase && !transportCase });
  if (id === "B-known-region" || id === "D-known-request") {
    plan.push({ prompt: "提示された候補Aを選びます。具体的な旅程を見たい", scripts: [adoption()], chooseVisible: true });
  }
  const turns: TravelProgressTurn[] = [];
  const history: Array<{ role: "user" | "assistant"; text: string }> = [];
  const invariantFailures: string[] = [];
  let repeatedKnownConditionQuestions = 0;
  for (const step of plan) {
    let observation: AgentTurnObservation | undefined, trace: AgentTrace | undefined;
    let calls = 0;
    const selected = step.selection || step.chooseVisible && turns.some((t) => t.observation?.progress.some((p) => p.kind === "candidates"));
    const prompt = step.chooseVisible && !selected ? "具体的な候補と旅程のたたき台を見たい" : step.prompt;
    const response = await runViewerAgentRuntime(prompt, { ...fixture.base,
      previousAssistantTurn: turns.at(-1)?.observation?.outcome,
      getConversationContext: () => ({ messages: [...history] }),
      getCurrentTrip: () => trip,
      ...(partyCase ? { getUserProfile: () => structuredClone(usualFamily) } : {}),
      getTravelCandidates: () => [{ id: record.candidate.id, targetItemId: "outbound", label: "評価用候補A/Bの検証済み移動", verified: true,
        accommodation: { provider: "fixture", providerItemId: "hotel-a", targetItemId: "stay" } },
        ...(id === "K-food" ? [{ id: activity.candidateId, targetItemId: "meal", label: "評価用の森の食堂・検証済みの食事候補", kind: "restaurant" }] : [])],
      candidateSelection: { taskId: "task-a", port },
      activitySelection: { taskId: "task-a", port: { resolve: async (candidateId) => candidateId === activity.candidateId ? [activity] : [] } },
      searchPlaceMedia: async () => ({ result: { status: "available", freshness: "fresh", evidence: [{ ...progressSource, kind: "place" }],
        data: { places: [{ providerPlaceId: "candidate-a", name: "候補A・評価用の森の温泉郷", summary: "森林の散策路と温泉を楽しめる架空地域", sourceUrl: "https://example.com/nature", openingHoursStatus: "unknown" }] } } }),
      onTurnObservation: (value) => { observation = value; }, storeAgentTrace: async (value) => { trace = value; },
    }, async (...args) => live ? (calls++, live(...args)) : step.scripts[calls++] ?? modelAnswer("検証した内容を案として提示します。"));
    turns.push({ observation, trace, delivered: true, ...(selected ? { candidateSelected: { targetItemId: id === "K-food" ? "meal" : "outbound" } } : {}), modelCalls: calls });
    history.push({ role: "user", text: prompt }, { role: "assistant", text: typeof response === "string" ? response : response.text });
    const preview = typeof response !== "string" && "tripUpdateProposal" in response ? applyTripProposal(trip, response.tripUpdateProposal) : trip;
    if (transportCase) {
      const added = preview.items.find((i) => i.id === "transfer");
      if (added?.type !== "transport" || added.detail.status !== "selected" || added.detail.mode !== (id === "O-taxi" ? "taxi" : "air") ||
          added.detail.provenance.type !== "manual" ||
          added.detail.origin.name !== (id === "O-taxi" ? "ホテル" : "東京") || added.detail.destination.name !== (id === "O-taxi" ? "空港" : "札幌") ||
          added.schedule.type !== (id === "O-taxi" ? "day" : "unscheduled") || observation?.outcome !== "progress") invariantFailures.push("transport: mode/endpoints/schedule/progress lost");
      if (JSON.stringify(preview.items.filter((i) => i.id !== "transfer")) !== JSON.stringify(original.items)) invariantFailures.push("transport: changed existing items");
    }
    if (partyCase) {
      if (JSON.stringify(preview.request.party) !== JSON.stringify(original.request.party)) invariantFailures.push("party: known party changed or age fabricated");
      if (observation?.outcome !== "progress" || !preview.items.some((i) => i.type === "activity")) invariantFailures.push("party: unnecessary question or no draft");
    }
    if (id === "K-food" || id === "L-free-time") {
      const added = preview.items.find((i) => i.id === (id === "K-food" ? "meal" : "free"));
      const patches = typeof response !== "string" && "tripUpdateProposal" in response ? response.tripUpdateProposal.patches : [];
      if (!added || added.type !== "activity" || !patches.some((p) => p.type === "add" && p.item.id === added.id) ||
          preview.planningState !== "itinerary_refinement") invariantFailures.push("activity: add/refinement preview missing");
      if (id === "K-food" && (added?.type !== "activity" || added.category !== "food" || added.place?.ref?.providerPlaceId !== "restaurant-a")) invariantFailures.push("food: resolved place missing");
      if (id === "L-free-time" && (added?.type !== "activity" || added.category !== "free-time" || added.place !== undefined ||
          added.schedule.type !== "window" || added.schedule.durationMinutes !== 120 || observation?.outcome !== "progress")) invariantFailures.push("free-time: fake place/fixed time or unnecessary question");
      if (JSON.stringify(preview.items.filter((i) => i.id !== added?.id)) !== JSON.stringify(original.items)) invariantFailures.push("activity: changed existing items");
    }
    if (id === "I-multi-day" && !preview.items.some((i) => i.type === "stay" && i.selection.status === "selected")) invariantFailures.push("multi-day: selected stay preview missing");
    if (id === "J-refinement" && (preview.planningState !== "itinerary_refinement" || JSON.stringify(preview.items) === JSON.stringify(trip.items))) invariantFailures.push("refinement: concrete replacement missing");
    if (id === "E-past" && (JSON.stringify(preview.request) !== JSON.stringify(original.request) || observation?.progress.length)) invariantFailures.push("past: changed request or false progress");
    if (id === "F-hard-unknown" && (!evaluateTripHardConstraints(preview).some((c) => c.constraintId === "return-deadline" && c.status === "unknown") || observation?.outcome !== "ask_and_progress")) invariantFailures.push("hard unknown: lost unknown condition or ask_and_progress");
    const successful = new Set(trace?.events.flatMap((e) => e.type === "tool_completed" && e.outcome === "success" ? [e.toolCallId] : []));
    for (const event of trace?.events ?? []) {
      if (event.type !== "tool_called" || event.toolName !== "ask_follow_up" || !successful.has(event.toolCallId)) continue;
      const input = event.input.value as Record<string, unknown> | undefined;
      if (scenario.base !== "A-vague" && input && (["origin", "dates"].includes(String(input.requestedRequirement)) || input.expectedInput === "departure-date")) repeatedKnownConditionQuestions++;
      if (partyCase && input?.requestedRequirement === "party") repeatedKnownConditionQuestions++;
    }
    if (JSON.stringify(trip) !== JSON.stringify(original)) invariantFailures.push("source Trip was mutated");
  }
  const report = evaluateTravelProgress(id, turns, scenario.thresholds, live ? "live" : "scripted");
  report.repeatedKnownConditionQuestions = repeatedKnownConditionQuestions;
  if (repeatedKnownConditionQuestions) invariantFailures.push("repeated known Request condition");
  report.contractFailures = [...new Set(invariantFailures)];
  report.failures.push(...report.contractFailures);
  if (report.failures.length && !report.failureReasons.length) report.failureReasons.push("unknown");
  report.passed = report.failures.length === 0;
  return report;
}
