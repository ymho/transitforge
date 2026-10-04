import { expect, it, vi } from "vitest";
import { searchJourneyIndex } from "@raiquora/journey/journey-search-engine";
import { projectPublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";
import { createTrip, type ItineraryItem } from "@raiquora/trip/trip";
import type { AccommodationSelectionEvidence } from "@raiquora/trip/select-accommodation";
import type { AccommodationOffering } from "@raiquora/trip/travel-candidate";
import { verifiedJourneySelectionItems, VerifiedJourneySelections } from "./verified-journey-selection.js";
import { verifiedAccommodationSelectionItems } from "./verified-accommodation-selection.js";
import { searchSelectionDraft } from "./retain-search-selection.js";
import { trustedCandidateItem } from "./retained-candidate-item.js";
import { PlanCandidateRetentionApplication } from "./plan-candidate-retention.js";
import { PlanCandidateAdoptionApplication } from "./plan-candidate-adoption.js";
import { TripApplication } from "./trip-application.js";
import { createPresentedCandidateController } from "./agent/presented-candidate-selection.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { stateA, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { DynamoDbItineraryCandidateRepository } from "../adapters/dynamodb-itinerary-candidate-repository.js";

const at = "2026-10-04T00:00:00Z", tripId = stateMetadata().tripId;
const index = { schema_version: "direct-service-index-v1", service_date: "2026-10-04", services: {
  direct: { service_uid: "direct", train_no: "10M", service_type: "普通", train_name: "", origin_station: "向日町", destination_station: "出雲市",
    calls: [{ station_name: "向日町", departure_time_minutes: 600 }, { station_name: "出雲市", arrival_time_minutes: 640 }] },
  later: { service_uid: "later", train_no: "11M", service_type: "普通", train_name: "", origin_station: "向日町", destination_station: "出雲市",
    calls: [{ station_name: "向日町", departure_time_minutes: 700 }, { station_name: "出雲市", arrival_time_minutes: 740 }] },
} };
const search = (departureTimeMinutes = 600, delays?: Record<string, number>) => searchJourneyIndex({ serviceDate: index.service_date,
  originStation: "向日町", destinationStation: "出雲市", departureTimeMinutes, maxTransfers: 0, limit: 3 }, { index, delays });
function hotel(): { offering: AccommodationOffering; proof: AccommodationSelectionEvidence } {
  const source = { id: "offering-source", kind: "accommodation" as const, provider: "fixture", sourceId: "hotel-a", retrievedAt: at, confidence: "observed" as const };
  const facility = { id: "facility-source", kind: "place" as const, provider: "facility", sourceId: "place-a", retrievedAt: at, confidence: "observed" as const };
  return { offering: { kind: "accommodation", provider: "fixture", providerItemId: "hotel-a", name: "検証用ホテル", checkInDate: "2026-10-04", checkOutDate: "2026-10-05",
    availability: "available", bookingUrl: "https://example.com/book", imageUrl: "https://example.com/photo", reviewAverage: 4.5 },
    // Synthetic grant, never a permission claim about a real provider.
    proof: { provider: "fixture", providerItemId: "hotel-a", storageAllowed: true, source,
      place: { ref: { provider: "facility", providerPlaceId: "place-a" }, name: "検証用ホテル", timeZone: "Asia/Tokyo", capturedAt: at, sources: [facility] },
      placeRetention: { origin: "provider", provider: "facility", storage: "permitted", allowedFields: ["ref", "name", "timeZone", "capturedAt", "sources"] } } };
}
it("retains scheduled rail facts, not realtime display values, and rejects substituted timetable dates", () => {
  const result = search(600, { "10M": 8 });
  const items = verifiedJourneySelectionItems(result, index, at);
  const selected = items[0]!;
  expect(selected.type === "transport" && selected.detail).toMatchObject({ status: "selected", mode: "rail", journey: {
    legs: [{ serviceUid: "direct", trainNumber: "10M", scheduledDeparture: { at: "2026-10-04T10:00:00.000+09:00" } }],
    provenance: { timetableInputs: [{ contentDigest: expect.stringMatching(/^[0-9a-f]{64}$/u) }] } } });
  expect(JSON.stringify(selected)).not.toContain("delayMinutes");
  expect(() => verifiedJourneySelectionItems(result, { ...index, service_date: "2026-10-05" }, at)).toThrow();
});
it("binds each shown route to exact legs across repeated searches and subset publication", () => {
  const selections = new VerifiedJourneySelections(), first = search(), later = search(700);
  selections.record(first, index, at); selections.record(later, index, at);
  const subset = projectPublicJourneyPresentation(first, new Set(["journey:2026-10-04:0"]))!;
  expect(selections.itemsFor(subset)[0]).toMatchObject({ detail: { journey: { legs: [{ serviceUid: "direct" }] } } });
  expect(selections.itemsFor(projectPublicJourneyPresentation(later))[0]).toMatchObject({ detail: { journey: { legs: [{ serviceUid: "later" }] } } });
  selections.record(first, { ...index, unusedMetadata: "changed source digest" }, at);
  expect(selections.itemsFor(subset)).toEqual([]);
});
it("retains hotel identity only with independent facility and retention proof, excluding volatile fields", () => {
  const { offering, proof } = hotel();
  const items = verifiedAccommodationSelectionItems([offering], [proof], at);
  expect(items[0]).toMatchObject({ type: "stay", selection: { accommodation: { providerItemId: "hotel-a", place: { ref: { providerPlaceId: "place-a" } } } } });
  expect(JSON.stringify(items)).not.toMatch(/availability|bookingUrl|imageUrl|reviewAverage/u);
  expect(verifiedAccommodationSelectionItems([offering], [], at)).toEqual([]);
  expect(verifiedAccommodationSelectionItems([offering], [{ ...proof, storageAllowed: false }], at)).toEqual([]);
  expect(() => verifiedAccommodationSelectionItems([offering], [{ ...proof, place: { ...proof.place, ref: { provider: "facility", providerPlaceId: "other" } } }], at)).toThrow();
});
it("does not choose between unresolved slots without a target", () => {
  const items = verifiedJourneySelectionItems(search(), index, at);
  const slots: ItineraryItem[] = ["outbound", "return"].map(id => ({ id, type: "transport", title: id, schedule: { type: "unscheduled" }, detail: { status: "unresolved" } }));
  const trip = createTrip(tripId, "旅行", at, slots);
  expect(searchSelectionDraft(items, trip)).toBeUndefined();
  expect(searchSelectionDraft(items, trip, "missing")).toBeUndefined();
  expect(searchSelectionDraft(items, trip, "outbound")?.variants[0]?.items[0]?.baseItemId).toBe("outbound");
});
it.each(["journey", "accommodation"] as const)("adopts the original %s through the button boundary and replays after expiry without another write", async kind => {
  const trips = tripDynamoFixture(); let now = new Date(at); trips.clock.now = () => now;
  const trip = createTrip(tripId, "旅行", at); trips.seed(trip, stateA.subject);
  const candidates = new DynamoDbItineraryCandidateRepository("trips", trips.client);
  const receipts = candidates;
  const retention = new PlanCandidateRetentionApplication(candidates, () => now);
  const result = search(), lodging = hotel();
  const items = kind === "journey" ? verifiedJourneySelectionItems(result, index, at) : verifiedAccommodationSelectionItems([lodging.offering], [lodging.proof], at);
  const presented = kind === "journey" ? { publicJourneyPresentation: projectPublicJourneyPresentation(result) } : { publicAccommodationPresentation: { version: "public-accommodation-presentation-v1" as const, cards: [{ evidenceId: items[0]!.id, name: lodging.offering.name, summary: "合成fixture", retrievedAt: at }] } };
  const userRequest = kind === "journey" ? "経路1でお願いします" : "検証用ホテルでお願いします";
  const retained = await retention.retain({ principal: stateA, executionId: "selection:784", conversationId, tripId, baseTripRevision: 0, userRequest: "経路検索" }, searchSelectionDraft(items, trip)!, []);
  const references = { attach: vi.fn(), detach: vi.fn(), reference: vi.fn() };
  const application = new TripApplication(trips.repository, references, { now: () => now });
  const adoption = new PlanCandidateAdoptionApplication(candidates, trips.repository, receipts, application,
    (draft, context) => trustedCandidateItem(draft, context.candidateSetId, context.variantId, context.retainedItem, context.selectedAt), () => now);
  const controller = createPresentedCandidateController({ messages: [{ role: "assistant", sequence: 2, createdAt: at, text: "経路候補です。", ...presented, publicPlanPresentation: retained.presentation }],
    trip, conversationId, userSequence: 3, executionId: "selection", userRequest, adoptPlan: (request, authority) => adoption.execute(stateA, request, authority), show: vi.fn() });
  expect(controller.context.groups[0]?.kind).toBe(kind); expect(controller.context.canSave).toBe(true);
  const request = { presentationId: `shown:2:${kind}`, candidateId: items[0]!.id, quote: userRequest };
  expect(await controller.select(request)).toMatchObject({ status: "saved", tripRevision: 1 });
  const saved = await trips.repository.get(stateA, tripId);
  expect(saved?.items).toHaveLength(1); expect(saved?.items[0]).toMatchObject(kind === "journey" ? { type: "transport", detail: { journey: { legs: [{ serviceUid: "direct" }] } } } : { type: "stay", selection: { accommodation: { providerItemId: "hotel-a" } } });
  now = new Date("2026-10-07T00:00:00Z");
  const resumed = createPresentedCandidateController({ messages: [{ role: "assistant", sequence: 2, createdAt: at, text: "経路候補です。", ...presented, publicPlanPresentation: retained.presentation }],
    trip: saved!, conversationId, userSequence: 3, executionId: "resumed", userRequest, adoptPlan: (request, authority) => adoption.execute(stateA, request, authority), show: vi.fn() });
  expect(await resumed.select(request)).toMatchObject({ status: "saved", tripRevision: 1 });
  expect((await trips.repository.get(stateA, tripId))?.revision).toBe(1);
  const fresh = createPresentedCandidateController({ messages: [{ role: "assistant", sequence: 2, createdAt: at, text: "経路候補です。", ...presented, publicPlanPresentation: retained.presentation }],
    trip, conversationId, userSequence: 5, executionId: "expired", userRequest, adoptPlan: (request, authority) => adoption.execute(stateA, request, authority), show: vi.fn() });
  expect(await fresh.select(request)).toMatchObject({ status: "stale" });
});
