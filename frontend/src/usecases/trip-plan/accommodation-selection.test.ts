import { describe, expect, it } from "vitest";
import { createTrip, applyTripProposal, type StayItineraryItem } from "@raiquora/trip/trip";
import { accommodationSelectionFixture } from "./accommodation-selection.fixture";
import { proposeCandidateSelection, confirmCandidateSelection, type CandidateSelectionRequest } from "./select-trip-candidate";
import { accommodationPreview } from "./accommodation-preview";

const at = "2026-09-12T08:00:00Z";
function setup() {
  const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅", at, [{ id: "stay", type: "stay", title: "古い宿名", schedule: { type: "unscheduled" }, selection: { status: "unselected" } }]);
  const record = accommodationSelectionFixture(trip.id);
  const request: CandidateSelectionRequest = { candidateId: "candidate-a", itemId: "stay", taskId: "task-a", accommodation: { provider: "fixture", providerItemId: "hotel-a" } };
  const port = { resolve: async () => record, loadTimetables: async () => [] };
  return { trip, record, request, port };
}
describe("accommodation adoption boundary", () => {
  it("allowlists product and separately resolved facility, dates and source only", async () => {
    const f = setup(); const before = structuredClone(f.record);
    Object.assign(f.record.candidate.accommodations[0]!, { raw: { secret: "discard" }, reservationReference: "discard", currentPrice: 555 });
    Object.assign(f.record.accommodation!.place, { image: "discard", review: "discard", raw: { secret: "discard" } });
    Object.assign(f.record.accommodation!.source, { raw: "discard" });
    const result = applyTripProposal(f.trip, await proposeCandidateSelection(f.trip, f.request, f.port, at));
    const stay = result.items[0] as StayItineraryItem;
    expect(stay).toMatchObject({ title: "宿泊", selection: { status: "selected", accommodation: { provider: "fixture", providerItemId: "hotel-a",
      place: { ref: { provider: "facility", providerPlaceId: "place-hotel-a" } }, selectedAt: at } } });
    const text = JSON.stringify(result); expect(text).not.toMatch(/price|availability|bookingUrl|image|review|reservation|raw|options|candidates|discard/);
    expect(f.trip.items[0]).toMatchObject({ selection: { status: "unselected" } });
    expect(f.record.candidate.accommodations[0]!.price).toEqual(before.candidate.accommodations[0]!.price);
    const preview = accommodationPreview(stay);
    for (const s of ["評価用の宿A", "評価用エリア", "評価用住所", "2026-09-22 チェックイン", "2026-09-24 チェックアウト"]) expect(preview).toContain(s);
    expect(preview).not.toMatch(/古い宿名|予約|空室|12,000|12000/);
  });
  it("replaces A with B at the same stable ID, leaving original A unchanged and no candidate array", async () => {
    const f = setup(); const a = applyTripProposal(f.trip, await proposeCandidateSelection(f.trip, f.request, f.port, at)), before = structuredClone(a);
    Object.assign(f.record, accommodationSelectionFixture(f.trip.id, "hotel-b", "評価用の宿B"));
    f.record.candidate.id = "candidate-b";
    const request = { ...f.request, candidateId: "candidate-b", accommodation: { provider: "fixture", providerItemId: "hotel-b" } };
    const proposal = await proposeCandidateSelection(a, request, f.port, at);
    expect(proposal.patches[0]).toMatchObject({ type: "replace", itemId: "stay" });
    const b = applyTripProposal(a, proposal); expect(b.items).toHaveLength(1); expect(a).toEqual(before);
    expect(accommodationPreview(b.items[0] as StayItineraryItem)).toContain("宿B");
    expect(JSON.stringify(b)).not.toMatch(/宿A|candidates|options/);
  });
  const invalid = ["candidate", "trip", "task", "expiry", "invalid-expiry", "provider", "product", "ambiguous", "missing-offering", "missing-proof", "missing-selector",
    "source-provider", "source-product", "source-kind", "source-confidence", "future-source", "stale-source", "identity-permission", "missing-place-permission", "place-temporary", "place-manual", "place-name-permission", "place-source-permission", "place-source-provider", "place-source-id", "future-place", "unknown-place", "invalid-date", "injected-body", "injected-selector"];
  it.each(invalid)("rejects %s without partial changes", async (change) => {
    const f = setup(), p = f.record.accommodation!, o = f.record.candidate.accommodations[0]!;
    if (change === "candidate") f.record.candidate.id = "other";
    if (change === "trip") f.record.tripId = "other";
    if (change === "task") f.record.taskId = "other";
    if (change === "expiry") f.record.validUntil = "2026-09-12T07:59:00Z";
    if (change === "invalid-expiry") f.record.validUntil = "invalid";
    if (change === "provider") p.provider = "other";
    if (change === "product") o.providerItemId = "other";
    if (change === "ambiguous") f.record.candidate.accommodations = [o, { ...o }];
    if (change === "missing-offering") f.record.candidate.accommodations = [];
    if (change === "missing-proof") delete f.record.accommodation;
    if (change === "missing-selector") delete f.request.accommodation;
    if (change === "source-provider") p.source.provider = "other";
    if (change === "source-product") p.source.sourceId = "other";
    if (change === "source-kind") p.source.kind = "web";
    if (change === "source-confidence") p.source.confidence = "unknown";
    if (change === "future-source") p.source.retrievedAt = "2026-09-12T08:01:00Z";
    if (change === "stale-source") p.source.validUntil = "2026-09-12T07:59:00Z";
    if (change === "identity-permission") p.storageAllowed = false;
    if (change === "missing-place-permission") Object.assign(p, { placeRetention: undefined });
    if (change === "place-temporary") p.placeRetention = { origin: "provider", provider: "facility", storage: "temporary", allowedFields: ["name", "sources"] };
    if (change === "place-manual") p.placeRetention = { origin: "manual" };
    if (change === "place-name-permission") p.placeRetention = { origin: "provider", provider: "facility", storage: "permitted", allowedFields: ["sources"] };
    if (change === "place-source-permission") p.placeRetention = { origin: "provider", provider: "facility", storage: "permitted", allowedFields: ["name"] };
    if (change === "place-source-provider") p.place.sources[0]!.provider = "other";
    if (change === "place-source-id") p.place.sources[0]!.sourceId = "other";
    if (change === "future-place") p.place.sources[0]!.retrievedAt = "2026-09-12T08:01:00Z";
    if (change === "unknown-place") p.place.sources[0]!.confidence = "unknown";
    if (change === "invalid-date") o.checkOutDate = "2026-02-30";
    if (change === "injected-body") Object.assign(f.request, { offering: o });
    if (change === "injected-selector") Object.assign(f.request.accommodation!, { storageAllowed: true });
    const before = structuredClone(f.trip);
    await expect(proposeCandidateSelection(f.trip, f.request, f.port, at)).rejects.toThrow();
    expect(f.trip).toEqual(before);
  });
  it("drops non-permitted place display fields and rechecks selection at explicit confirmation", async () => {
    const f = setup(); f.record.accommodation!.placeRetention = { origin: "provider", provider: "facility", storage: "permitted", allowedFields: ["name", "sources"] };
    const proposal = await proposeCandidateSelection(f.trip, f.request, f.port, at);
    const next = await confirmCandidateSelection(f.trip, f.request, proposal, f.port, "2026-09-12T08:01:00Z");
    expect(next.items[0]).toMatchObject({ selection: { accommodation: { selectedAt: "2026-09-12T08:01:00Z", place: { name: "評価用の宿A" } } } });
    expect(JSON.stringify(next.items)).not.toMatch(/address|area|timeZone|providerPlaceId/);
    f.record.candidate.accommodations[0]!.checkOutDate = "2026-09-25";
    await expect(confirmCandidateSelection(f.trip, f.request, proposal, f.port, "2026-09-12T08:02:00Z")).rejects.toThrow(/changed/);
    await expect(confirmCandidateSelection(f.trip, f.request, proposal, f.port, "2026-09-12T10:00:00Z")).rejects.toThrow(/expired/);
  });
});
