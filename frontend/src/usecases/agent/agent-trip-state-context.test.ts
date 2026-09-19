import { describe, expect, it } from "vitest";
import { createAgentContextSnapshot } from "@raiquora/agent/agent-context-snapshot";
import { agentDecisionContextText, buildAgentDecisionContext } from "@raiquora/agent/agent-decision-context";
import type { AgentToolDescriptor } from "@raiquora/agent/tool-contract";
import { requestTrip, requestRailItem } from "../../../../modules/trip/domain/trip-request.fixture";
import type { PlanningState } from "@raiquora/trip/trip-state";

const tools = ["search_web", "search_weather_forecast", "ask_follow_up"].map((name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } })) as AgentToolDescriptor[];
describe("Trip state is Agent context, not a planner", () => {
  it.each(["inspiration", "candidate_discovery", "candidate_selection", "itinerary_draft", "itinerary_refinement"] as PlanningState[])("keeps the same capabilities for %s and preserves separate canonical fields", (planningState) => {
    const trip = { ...requestTrip(undefined, [requestRailItem()]), planningState, lifecycleState: "in_trip" as const };
    const snapshot = createAgentContextSnapshot(undefined, trip);
    const context = buildAgentDecisionContext({ executionId: "state", feature: "concierge", userRequest: "天気が知りたい",
      context: { currentTrip: snapshot.trip, tripContext: { planningStage: "planning" },
        currentTurnDecision: { interpretedGoal: "天気確認", selectedAction: "use_tool", selectedTool: "search_weather_forecast", hardConstraints: [], softPreferences: [], unresolvedFacts: [], reasonCodes: [] } } }, tools);
    expect(context.currentTrip).toMatchObject({ planningState, lifecycleState: "in_trip" });
    expect(context.availableTools.map((t) => t.name)).toEqual(tools.map((t) => t.name));
    expect(context.persistedTripRequest).toEqual(trip.request);
    expect(context.currentTrip).not.toHaveProperty("request");
    expect(context.tripContext).toBeUndefined();
    expect(context.currentTurnDecision).not.toHaveProperty("planningState");
    const text = agentDecisionContextText(context);
    expect(text).toContain("Tool選択や質問順を固定しません");
    expect(text).toContain("過去日程を今年や翌年に補正しない");
    // Force minimal serialization: state must not disappear with bulky runtime observations.
    context.currentJourney = { journeys: Array(5).fill({ detail: "x".repeat(24000) }) };
    context.conversation = { messages: Array(12).fill({ role: "user", text: "x".repeat(6000) }) };
    const compact = JSON.parse(agentDecisionContextText(context).match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
    expect(compact.currentTrip).toMatchObject({ planningState, lifecycleState: "in_trip" });
    expect(compact.persistedTripRequest).toEqual(trip.request);
  });
  it("marks schedule truncation at either projection boundary", () => {
    for (const count of [21, 25]) {
      const trip = requestTrip(undefined, Array.from({ length: count }, (_, n) => ({ id: `item-${n}`, type: "stay", title: "宿",
        selection: { status: "unselected" }, schedule: { type: "unscheduled" } })));
      const snapshot = createAgentContextSnapshot(undefined, trip);
      const context = buildAgentDecisionContext({ executionId: "large-trip", feature: "concierge", userRequest: "旅について",
        context: { currentTrip: snapshot.trip } }, tools);
      expect(context.currentTrip!.scheduleTruncated).toBe(true);
    }
  });
  it("retains the original adopted year even with current-year UI context and during compaction", () => {
    const trip = requestTrip(undefined, [{ id: "past", type: "stay", title: "去年の旅", selection: { status: "unselected" },
      schedule: { type: "day", date: "2025-09-22", timeZone: "Europe/Vienna" } }]);
    const snapshot = createAgentContextSnapshot(undefined, trip);
    const context = buildAgentDecisionContext({ executionId: "past", feature: "concierge", userRequest: "この保存済みの旅について",
      context: { currentTrip: snapshot.trip, featureContext: { calendarDate: "2026-09-12" } } }, tools);
    context.currentJourney = { journeys: Array(5).fill({ detail: "x".repeat(24000) }) };
    const text = agentDecisionContextText(context);
    expect(text).toContain("2025-09-22");
    expect(text).not.toContain("2026-09-22");
    expect(text).toContain("pre_tripだけで将来の旅行とは断定せず");
  });
});
