import { describe, expect, it } from "vitest";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { createTravelCandidate } from "@raiquora/trip/travel-candidate";
import { applyTripProposal, createTrip, type Trip } from "@raiquora/trip/trip";
import { confirmCandidateSelection, proposeCandidateSelection, type CandidateSelectionPort } from "./select-trip-candidate";

function setup() {
  const fixture = railSelectionFixture();
  const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅", fixture.selectedAt, [
    { id: "outbound", title: "往路", type: "transport", schedule: { type: "unscheduled" }, detail: { mode: "rail", status: "unresolved" } },
    { id: "stay", title: "宿泊", type: "stay", schedule: { type: "unscheduled" }, selection: { status: "unselected" } },
    { id: "another-stay", title: "別の宿泊", type: "stay", schedule: { type: "unscheduled" }, selection: { status: "unselected" } },
  ]);
  const record: NonNullable<Awaited<ReturnType<CandidateSelectionPort["resolve"]>>> = {
    candidate: createTravelCandidate({ id: fixture.candidate.candidateId, journey: fixture.candidate.journey }),
    tripId: trip.id, taskId: "task-a", validUntil: "2026-09-12T09:00:00Z", rail: fixture.candidate,
  };
  const port: CandidateSelectionPort = { resolve: async () => record, loadTimetables: async () => fixture.inputs };
  const request = { candidateId: record.candidate.id, itemId: "outbound", taskId: "task-a" };
  return { ...fixture, trip, record, port, request };
}

describe("candidate adoption boundary", () => {
  it("adopts from candidate_selection into draft, preserving refinement and independent lifecycle", async () => {
    const { trip, request, port, selectedAt } = setup();
    const selection = { ...trip, planningState: "candidate_selection" as const };
    const selected = applyTripProposal(selection, await proposeCandidateSelection(selection, request, port, selectedAt));
    expect(selected.planningState).toBe("itinerary_draft");
    const refining = { ...selected, planningState: "itinerary_refinement" as const, lifecycleState: "in_trip" as const };
    const updated = applyTripProposal(refining, await proposeCandidateSelection(refining, request, port, selectedAt));
    expect(updated.planningState).toBe("itinerary_refinement");
    expect(updated.lifecycleState).toBe("in_trip");
  });
  it("rechecks at confirmation and never applies expired or replaced candidate facts", async () => {
    const { trip, request, port, selectedAt, record } = setup();
    const proposal = await proposeCandidateSelection(trip, request, port, selectedAt);
    const confirmed = await confirmCandidateSelection(trip, request, proposal, port, "2026-09-12T08:01:00Z");
    expect(confirmed.items[0]).toMatchObject({ detail: { journey: { selectedAt: "2026-09-12T08:01:00Z" } } });
    record.rail!.verifiedJourneyRef = "task-a/search-other/result-1";
    await expect(confirmCandidateSelection(trip, request, proposal, port, "2026-09-12T08:02:00Z")).rejects.toThrow(/changed/);
    await expect(confirmCandidateSelection(trip, request, proposal, port, "2026-09-12T10:00:00Z")).rejects.toThrow(/expired/);
    expect(trip.items[0]).toMatchObject({ detail: { status: "unresolved" } });
  });
  it("resolves the ID, proposes one selected item, then replaces A with B only on apply", async () => {
    const { trip, request, port, selectedAt, record, inputs } = setup();
    const before = structuredClone(trip);
    const proposal = await proposeCandidateSelection(trip, request, port, selectedAt);
    expect(trip).toEqual(before);
    expect(proposal.patches).toHaveLength(2);
    expect(proposal.patches[1]).toEqual({ type: "planning", state: "itinerary_draft" });
    expect(proposal.patches[0]).toMatchObject({ type: "replace", itemId: "outbound", item: { id: "outbound", detail: { status: "selected" } } });
    const adopted = applyTripProposal(trip, proposal);
    expect(adopted.planningState).toBe("itinerary_draft");
    expect(trip.planningState).toBe("inspiration");
    expect(adopted.items).toHaveLength(3);
    expect(adopted.id).toBe(trip.id);
    expect(JSON.stringify(adopted)).not.toMatch(/journeys|options|delayMinutes/);
    record.candidate.id = "candidate-b"; record.rail!.candidateId = "candidate-b"; record.rail!.verifiedJourneyRef = "task-a/search-2/result-1";
    inputs[0]!.index.trains[0]!.train_no = "9M";
    record.rail!.journey.legs[0]!.trainNumber = "9M";
    const second = await proposeCandidateSelection(adopted, { ...request, candidateId: "candidate-b" }, port, selectedAt);
    const replaced = applyTripProposal(adopted, second);
    expect(replaced.items).toHaveLength(3);
    expect(replaced.items[0]).toMatchObject({ id: "outbound", detail: { journey: { legs: [{ trainNumber: "9M" }, { trainNumber: "2M" }] } } });
    expect(adopted.items[0]).toMatchObject({ detail: { journey: { legs: [{ trainNumber: "1M" }, { trainNumber: "2M" }] } } });
  });

  it.each(["expired", "wrong-trip", "wrong-task", "wrong-candidate", "missing-proof", "missing-input"])("rejects %s", async (change) => {
    const { trip, request, port, selectedAt, record, inputs } = setup();
    if (change === "expired") record.validUntil = "2020-01-01T00:00:00Z";
    if (change === "wrong-trip") record.tripId = "other";
    if (change === "wrong-task") record.taskId = "other";
    if (change === "wrong-candidate") record.candidate.id = "other";
    if (change === "missing-proof") delete record.rail;
    if (change === "missing-input") inputs.splice(0);
    const before = structuredClone(trip);
    await expect(proposeCandidateSelection(trip, request, port, selectedAt)).rejects.toThrow();
    expect(trip).toEqual(before);
  });

  it("adopts a single permitted hotel into the specified stay, without copying prices or options", async () => {
    const { trip, port, record, selectedAt } = setup();
    const offering = { kind: "accommodation" as const, provider: "fixture", providerItemId: "hotel-a", name: "宿A",
      checkInDate: "2026-09-13", checkOutDate: "2026-09-14", price: { amount: 9999, currency: "JPY" as const }, availability: "available" as const,
      address: "未許諾の住所", latitude: 35, longitude: 135, imageUrl: "https://example.com/image.jpg" };
    record.candidate.accommodations = [offering, { ...offering, providerItemId: "hotel-b", name: "宿B" }];
    record.accommodation = { provider: "fixture", providerItemId: "hotel-a", storageAllowed: true,
      place: { name: "宿A", ref: { provider: "fixture", providerPlaceId: "hotel-a" }, capturedAt: "2026-09-12T07:55:00Z",
        sources: [{ id: "hotel-evidence", kind: "accommodation", provider: "fixture", sourceId: "hotel-a", retrievedAt: "2026-09-12T07:55:00Z", confidence: "observed" }] },
      placeRetention: { origin: "provider", provider: "fixture", storage: "permitted", allowedFields: ["ref", "name", "sources", "capturedAt"] },
      source: { id: "hotel-evidence", kind: "accommodation", provider: "fixture", sourceId: "hotel-a", retrievedAt: "2026-09-12T07:55:00Z", confidence: "observed" } };
    const request = { candidateId: record.candidate.id, itemId: "stay", taskId: "task-a", accommodation: { provider: "fixture", providerItemId: "hotel-a" } };
    const proposal = await proposeCandidateSelection(trip, request, port, selectedAt);
    const result = applyTripProposal(trip, proposal);
    expect(result.items[1]).toMatchObject({ selection: { status: "selected", accommodation: { place: { name: "宿A" } } } });
    expect(result.items[1]).toMatchObject({ selection: { accommodation: { place: {
      ref: { provider: "fixture", providerPlaceId: "hotel-a" }, capturedAt: "2026-09-12T07:55:00Z",
      sources: [{ sourceId: "hotel-a", provider: "fixture" }],
    } } } });
    expect(result.items[2]).toEqual(trip.items[2]);
    expect(JSON.stringify(result)).not.toMatch(/price|availability|options|宿B|address|coordinate|imageUrl/);
    record.accommodation.placeRetention = { origin: "manual" };
    await expect(proposeCandidateSelection(trip, request, port, selectedAt)).rejects.toThrow(/manual/);
    record.accommodation.storageAllowed = false;
    await expect(proposeCandidateSelection(trip, request, port, selectedAt)).rejects.toThrow(/permission/);
  });

  it("rejects the whole patch list and unknown fields; cannot upsert or rename an item", () => {
    const { trip } = setup(); const before = structuredClone(trip);
    for (const itemId of ["missing", "wrong-id"]) expect(() => applyTripProposal(trip, { tripId: trip.id, summary: "invalid", patches: [
      { type: "replace", itemId: "stay", item: { id: "stay", title: "changed", type: "stay", schedule: { type: "unscheduled" }, selection: { status: "unselected" } } },
      { type: "replace", itemId, item: trip.items[0]! },
    ] })).toThrow();
    expect(trip).toEqual(before);
    expect(() => applyTripProposal({ ...trip, journeys: [] } as Trip, { tripId: trip.id, summary: "", patches: [] })).toThrow();
  });
});
