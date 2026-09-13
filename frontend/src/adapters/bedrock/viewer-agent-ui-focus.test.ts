import { describe, expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { placeActivity, placesAt, placesTripId } from "../../../../modules/trip/domain/trip-places.fixture";
import { createAgentContextSnapshot, selectedTripItemSnapshot } from "../../usecases/agent/agent-context-snapshot";
import { buildAgentDecisionContext, agentDecisionContextText } from "../../usecases/agent/agent-decision-context";
import { askProgressFixture, modelAnswer } from "./ask-progress-scenarios.fixture";
import { runViewerAgentRuntime } from "./viewer-agent-runtime";
import { runFocusedItemScenario } from "./focused-item-scenarios.fixture";

describe("ephemeral focused-item context", () => {
  it("retains the focused item outside the bounded itinerary, even when context compacts", () => {
    const items = Array.from({ length: 40 }, (_, i) => placeActivity(`item-${i}`, { name: `場所${i}`, coordinate: { longitude: 135.1234, latitude: 35.1234 }, sources: [] }));
    const trip = createTrip(placesTripId, "多数の予定", placesAt, items);
    const currentTrip = createAgentContextSnapshot(undefined, trip).trip!;
    expect(currentTrip.schedule).toHaveLength(24);
    const context = buildAgentDecisionContext({ executionId: "ui", feature: "concierge", userRequest: "ここを調整",
      context: { currentTrip, featureContext: { uiFocus: { itemId: "item-39", item: selectedTripItemSnapshot(items[39]!) } },
        travelCandidates: Array.from({ length: 12 }, () => ({ details: "候補".repeat(3000) })) } }, []);
    const text = agentDecisionContextText(context), value = JSON.parse(text.match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
    expect(value.featureContext.uiFocus).toMatchObject({ itemId: "item-39", item: { placeName: "場所39" } });
    expect(value.currentTrip.schedule.some((i: { itemId: string }) => i.itemId === "item-39")).toBe(false);
    expect(text).not.toContain("135.1234"); expect(JSON.stringify(trip)).not.toContain("uiFocus");
  });
  it("resolves membership against the latest Trip and ignores unknown/stale item IDs", async () => {
    const trip = createTrip(placesTripId, "最新", placesAt, [placeActivity("latest")]);
    for (const itemId of ["latest", "deleted"]) {
      let context = "";
      await runViewerAgentRuntime("相談したい", { ...askProgressFixture("C-candidate").base, getCurrentTrip: () => trip,
        getUiFocus: () => ({ itemId }), getTravelCandidates: () => [{ id: "candidate-only" }] }, async (...args) => { context ||= JSON.stringify(args[0]); return modelAnswer("予定の変更を相談できます。"); });
      expect(context).toContain("candidate-only");
      expect(context.includes('\\"uiFocus\\"')).toBe(itemId === "latest");
    }
  });
  it("AA delivers a concrete focused replacement without changing other cities", async () => {
    const result = await runFocusedItemScenario({ id: "AA-focused-item", name: "選択予定", userRequest: "ここをもう少しゆっくりにしたい", tags: [], thresholds: { ttfi: 1, selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 0 } });
    expect(result.failures).toEqual([]); expect(result.ttfi).toBe(1); expect(result.passed).toBe(true);
  });
});
