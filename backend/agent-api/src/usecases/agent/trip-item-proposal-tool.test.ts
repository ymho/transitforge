import { expect, it, vi } from "vitest";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { createTrip, applyTripProposal } from "@raiquora/trip/trip";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";
import { registerTripItemProposalTool } from "./trip-item-proposal-tool.js";

const trip = createTrip("00000000-0000-4000-8000-000000000756", "出雲", "2026-09-28T00:00:00Z", [
  { id: "shrine", type: "activity", category: "sightseeing", title: "出雲大社", schedule: { type: "day", date: "2026-10-01" } },
  { id: "hotel", type: "stay", title: "宿泊", schedule: { type: "day", date: "2026-10-02" }, selection: { status: "unselected" } },
]);

it("publishes a preview for explicit user-authored meal, with no Trip mutation or provider facts", async () => {
  const registry = new AgentToolRegistry(), publish = vi.fn();
  registerTripItemProposalTool(registry, trip, publish);
  const dayKey = projectDailyItinerary(trip).days[0]!.dayKey;
  const response = await registry.execute("propose_trip_item_change", { action: "add-activity", expectedRevision: 0,
    dayKey, afterId: "shrine", title: "昼食", category: "food", placeName: "出雲そば" }, { executionId: "turn" });
  expect(response).toMatchObject({ ok: true, output: { proposed: true, saved: false, confirmationRequired: true, baseRevision: 0 } });
  expect(trip.items).toHaveLength(2);
  expect(publish).toHaveBeenCalledOnce();
  const proposal = publish.mock.calls[0]![0];
  expect(proposal.patches[0]).toMatchObject({ type: "add", item: { type: "activity", category: "food", place: { name: "出雲そば", sources: [] } } });
  expect(applyTripProposal(trip, proposal).items).toHaveLength(3);
});

it("rejects stale, foreign, forged and unavailable provider selections", async () => {
  const registry = new AgentToolRegistry(), publish = vi.fn(); registerTripItemProposalTool(registry, trip, publish);
  const invoke = (change: object) => registry.execute("propose_trip_item_change", change, { executionId: "turn" });
  expect(await invoke({ action: "remove", itemId: "shrine", expectedRevision: 1 })).toMatchObject({ ok: false, error: { code: "stale_revision" } });
  expect(await invoke({ action: "remove", itemId: "other-trip" })).toMatchObject({ ok: false });
  expect(await invoke({ action: "remove", itemId: "shrine", tripId: "other-trip" })).toMatchObject({ ok: false });
  expect(await invoke({ action: "add-activity", dayKey: "unscheduled", title: "店", category: "food", sourceId: "fake" })).toMatchObject({ ok: false });
  expect(await invoke({ action: "select-manual-transport", itemId: "shrine", title: "列車", mode: "rail", origin: "A", destination: "B" })).toMatchObject({ ok: false });
  expect(publish).not.toHaveBeenCalled();
});
