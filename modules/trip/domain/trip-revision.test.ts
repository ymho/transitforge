import { describe, expect, it } from "vitest";
import { applyTripProposal, createTrip, TripRevisionConflict, type TripPatch } from "./trip";

const trip = { ...createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-09-13T00:00:00Z", [
  { id: "a", title: "散策", type: "activity", category: "free-time", schedule: { type: "unscheduled" } },
]), revision: 5 };
describe("proposal revision is distinct from schema/preview", () => {
  it.each<TripPatch[]>([
    [{ type: "add", item: { ...trip.items[0]!, id: "b" } }],
    [{ type: "replace", itemId: "a", item: { ...trip.items[0]!, title: "変更" } }],
    [{ type: "remove", itemId: "a" }], [{ type: "move", itemId: "a" }],
    [{ type: "request", request: { constraints: [], assumptions: [], goal: "散策" } }],
    [{ type: "planning", state: "itinerary_refinement" }],
    [{ type: "lifecycle", state: "cancelled", basis: "user_confirmation" }],
  ])("validates revision before atomic patches (%j)", (patch) => {
    const proposal = { tripId: trip.id, baseRevision: 5, summary: "変更", patches: [patch] };
    const before = structuredClone(trip);
    const preview = applyTripProposal(trip, proposal, { confirmedLifecycle: "cancelled" });
    expect(preview.revision).toBe(5); expect(preview.schemaVersion).toBe(2); expect(preview.updatedAt).toBe(trip.updatedAt);
    expect(() => applyTripProposal({ ...trip, revision: 6 }, proposal)).toThrow(TripRevisionConflict);
    expect(trip).toEqual(before);
  });
  it("rejects missing/fractional/negative revisions and invalid sequences without partial changes", () => {
    for (const baseRevision of [undefined, -1, 1.5, NaN, Infinity]) {
      expect(() => applyTripProposal(trip, { tripId: trip.id, baseRevision: baseRevision as number, summary: "", patches: [] })).toThrow();
    }
    const before = structuredClone(trip);
    expect(() => applyTripProposal(trip, { tripId: trip.id, baseRevision: 5, summary: "", patches: [
      { type: "remove", itemId: "a" }, { type: "remove", itemId: "missing" },
    ] })).toThrow();
    expect(trip).toEqual(before);
  });
});
