import { applyTripProposal } from "@raiquora/trip/trip";
import { multiCityTrip } from "../../../../modules/trip/domain/trip-places.fixture";
import { runViewerAgentRuntime, type BedrockAgentConverse } from "./viewer-agent-runtime";
import { askProgressFixture, modelAnswer, modelTool, modelTools } from "./ask-progress-scenarios.fixture";
import { evaluateTravelProgress, type TravelProgressScenario } from "../../usecases/agent/evaluation/travel-progress-evaluation";
import type { AgentTrace } from "@raiquora/agent/agent-trace";
import type { AgentTurnObservation } from "@raiquora/agent/agent-turn-outcome";

/** AA exercises the production Context / registry / validated proposal path. No intent router. */
export async function runFocusedItemScenario(scenario: TravelProgressScenario, live?: BedrockAgentConverse) {
  const base = multiCityTrip();
  const trip = { ...base, items: base.items.map((item) => item.id !== "activity" ? item : { ...item,
    schedule: { type: "window" as const, earliestStart: { at: "2026-09-24T09:00:00+02:00", timeZone: "Europe/Zurich" },
      latestEnd: { at: "2026-09-24T13:00:00+02:00", timeZone: "Europe/Zurich" }, durationMinutes: 60 } }) };
  const original = structuredClone(trip), fixture = askProgressFixture("C-candidate");
  let calls = 0, trace: AgentTrace | undefined, observation: AgentTurnObservation | undefined, context = "";
  const response = await runViewerAgentRuntime(scenario.userRequest, { ...fixture.base,
    getCurrentTrip: () => trip, getUiFocus: () => ({ itemId: "activity" }), getTravelCandidates: () => [],
    onTurnObservation: (value) => { observation = value; }, storeAgentTrace: async (value) => { trace = value; },
  }, async (...args) => {
    if (!context) context = JSON.stringify(args[0]);
    const call = calls++;
    if (live) return live(...args);
    if (call === 0) return modelTools(modelTool("propose_manual_activity", { itemId: "activity", operation: "replace", title: "Zürichをゆっくり散策", category: "sightseeing",
      schedule: { type: "window", earliestStart: { at: "2026-09-24T09:00:00+02:00", timeZone: "Europe/Zurich" },
        latestEnd: { at: "2026-09-24T13:00:00+02:00", timeZone: "Europe/Zurich" }, durationMinutes: 120 } }));
    return modelAnswer("選択した散策の時間を長めにする変更案です。他の予定と場所は変えていません。");
  });
  const report = evaluateTravelProgress(scenario.id, [{ observation, trace, delivered: true, modelCalls: calls }], scenario.thresholds, live ? "live" : "scripted");
  const failures: string[] = [];
  const proposal = typeof response !== "string" && "tripUpdateProposal" in response ? response.tripUpdateProposal : undefined;
  if (!proposal) failures.push("focused item: no concrete proposal");
  else {
    const after = applyTripProposal(trip, proposal), oldItem = original.items.find((i) => i.id === "activity")!, item = after.items.find((i) => i.id === "activity");
    if (item?.type !== "activity" || oldItem.type !== "activity" || JSON.stringify(item.place) !== JSON.stringify(oldItem.place) ||
        item.schedule.type !== "window" || (item.schedule.durationMinutes ?? 0) <= 60) failures.push("focused item: no slower plan or adopted place lost");
    if (JSON.stringify(after.items.filter((i) => i.id !== "activity")) !== JSON.stringify(original.items.filter((i) => i.id !== "activity")) ||
        JSON.stringify(after.request) !== JSON.stringify(original.request)) failures.push("focused item: unrelated item/request changed");
  }
  if (!context.includes("uiFocus") || !context.includes("activity") || !context.includes("Zürich")) failures.push("focused item: missing structured context");
  if (JSON.stringify(trip) !== JSON.stringify(original)) failures.push("focused item: mutated source");
  if (observation?.outcome !== "progress") failures.push("focused item: question without progress");
  report.contractFailures.push(...failures); report.failures.push(...failures); report.passed = !report.failures.length;
  return report;
}
