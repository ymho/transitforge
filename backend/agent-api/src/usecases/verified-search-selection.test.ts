import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDbTripRepository, type TripDynamoClient } from "../adapters/dynamodb-trip-repository.js";
import { DynamoDbReservationRepository } from "../adapters/dynamodb-reservation-repository.js";
import { ReservationApplication } from "./reservation-application.js";
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
it("replaces the complete selected outbound journey, preserving it on cancellation and the other six items on adoption", async () => {
  const timetable = { ...index, services: { ...index.services,
    direct: { ...index.services.direct, destination_station: "京都", calls: [
      { station_name: "向日町", departure_time_minutes: 600 }, { station_name: "京都", arrival_time_minutes: 610 }] },
    connection: { service_uid: "connection", train_no: "12M", service_type: "普通", train_name: "", origin_station: "京都", destination_station: "出雲市",
      calls: [{ station_name: "京都", departure_time_minutes: 620 }, { station_name: "出雲市", arrival_time_minutes: 680 }] },
  } };
  const routes = (departureTimeMinutes: number) => verifiedJourneySelectionItems(searchJourneyIndex({ serviceDate: index.service_date,
    originStation: "向日町", destinationStation: "出雲市", departureTimeMinutes, maxTransfers: 1, limit: 3 }, { index: timetable }), timetable, at);
  const original = { ...routes(600)[0]!, id: "outbound", title: "ユーザーが付けた往路の名前" };
  expect(original).toMatchObject({ detail: { journey: { legs: [{ serviceUid: "direct" }, { serviceUid: "connection" }] } } });
  const others: ItineraryItem[] = [
    { id: "local", type: "transport", title: "出雲市 → 出雲大社前", schedule: { type: "day", date: index.service_date, timeZone: "Asia/Tokyo" }, detail: { status: "unresolved" } },
    { id: "return", type: "transport", title: "帰路", schedule: { type: "day", date: "2026-10-05", timeZone: "Asia/Tokyo" }, detail: { status: "unresolved" } },
    ...verifiedAccommodationSelectionItems([hotel().offering], [hotel().proof], at),
    ...Array.from({ length: 3 }, (_, i): ItineraryItem => ({ id: `visit-${i}`, type: "activity", category: "sightseeing", title: `観光${i}`, schedule: { type: "unscheduled" } })),
  ];
  const trip = createTrip(tripId, "旅行", at, [original, ...others]), before = structuredClone(trip);
  const items = routes(700), draft = searchSelectionDraft(items, trip)!;
  expect(draft.variants[0]?.items[0]?.baseItemId).toBe("outbound");
  expect(draft.variants[0]?.retainedBaseItemIds).toEqual(others.map(item => item.id));
  expect(searchSelectionDraft(items, { ...trip, items: [...trip.items, { ...original, id: "duplicate" }] })).toBeUndefined();
  expect(searchSelectionDraft(items, trip, others[2]!.id)).toBeUndefined();
  const partial = verifiedJourneySelectionItems(searchJourneyIndex({ serviceDate: index.service_date,
    originStation: "向日町", destinationStation: "京都", departureTimeMinutes: 600, maxTransfers: 0, limit: 3 }, { index: timetable }), timetable, at);
  expect(searchSelectionDraft(partial, trip)).toBeUndefined();
  expect(searchSelectionDraft(items, { ...trip, items: trip.items.map(item => item.id === "outbound"
    ? { ...original, schedule: { type: "day", date: "2026-10-05", timeZone: "Asia/Tokyo" } } : item) })).toBeUndefined();
  const fixture = tripDynamoFixture(); fixture.clock.now = () => new Date(at); fixture.seed(trip, stateA.subject);
  const candidates = new DynamoDbItineraryCandidateRepository("trips", fixture.client);
  const retained = await new PlanCandidateRetentionApplication(candidates, () => new Date(at)).retain(
    { principal: stateA, executionId: "whole-route", conversationId, tripId, baseTripRevision: 0, userRequest: "往路全体を選び直す" }, draft, []);
  const application = new TripApplication(fixture.repository, { attach: vi.fn(), detach: vi.fn(), reference: vi.fn() }, fixture.clock,
    new ReservationApplication(fixture.repository, new DynamoDbReservationRepository("trips", fixture.client)));
  const adoption = new PlanCandidateAdoptionApplication(candidates, fixture.repository, candidates, application,
    (item, context) => trustedCandidateItem(item, context.candidateSetId, context.variantId, context.retainedItem, context.selectedAt), () => new Date(at));
  if (retained.presentation.candidateSetRef.kind !== "candidate-set-ref") throw new Error("Candidate was not retained");
  const request = { operation: "preview" as const, conversationId, tripId, candidateSetId: retained.presentation.candidateSetRef.candidateSetId,
    candidateSetRevision: 0, variantId: "option-1", baseTripRevision: 0, mutationId: "75800000-0000-4000-8000-000000000002" };
  const preview = await adoption.execute(stateA, request);
  expect(preview.status).toBe("confirmation-required");
  if (preview.status !== "confirmation-required") throw new Error("Missing preview");
  expect(preview.preview.changes).toEqual({ added: 0, replaced: 1, removed: 0 });
  // Leaving the preview/research without confirming needs no compensating write.
  expect(trip).toEqual(before); expect(await fixture.repository.get(stateA, tripId)).toEqual(before);
  await adoption.execute(stateA, { ...request, operation: "confirm" }, { confirmationKey: preview.confirmationKey });
  const saved = (await fixture.repository.get(stateA, tripId))!;
  expect(saved.items).toHaveLength(7); expect(saved.items.slice(1)).toEqual(others);
  expect(saved.items[0]).toMatchObject({ id: "outbound", detail: { journey: { legs: [{ serviceUid: "later" }], transfers: [] } } });
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
  const request = { presentationId: `shown:2:${kind}`, candidateId: items[0]!.id, quote: userRequest, reference: kind === "journey" ? { kind: "ordinal" as const, ordinal: 1, quote: "1" } : { kind: "label" as const, quote: "検証用ホテル" } };
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

it.each(["journey", "accommodation"] as const)("replaces a %s slot only after the Agent can read booking facts", async kind => {
  const fixture = tripDynamoFixture(); fixture.clock.now = () => new Date(at);
  let allowQuery = false;
  const queries: QueryCommand[] = [];
  const client: TripDynamoClient = { async send(command) {
    if (command instanceof QueryCommand) {
      queries.push(command);
      if (!allowQuery) throw Object.assign(new Error("private IAM detail"), { name: "AccessDeniedException" });
    }
    return fixture.client.send(command);
  } };
  const repository = new DynamoDbTripRepository("trips", client, fixture.clock);
  const slot: ItineraryItem = kind === "journey"
    ? { id: "slot", type: "transport", title: "未選択の往路", schedule: { type: "unscheduled" }, detail: { status: "unresolved" } }
    : { id: "slot", type: "stay", title: "未選択の宿泊", schedule: { type: "unscheduled" }, selection: { status: "unselected" } };
  const unrelated: ItineraryItem[] = Array.from({ length: 6 }, (_, i) => ({ id: `other-${i}`, type: "activity", category: "sightseeing", title: `予定${i}`, schedule: { type: "unscheduled" } }));
  const trip = createTrip(tripId, "旅行", at, [slot, ...unrelated]); fixture.seed(trip, stateA.subject);
  const candidates = new DynamoDbItineraryCandidateRepository("trips", client);
  const lodging = hotel(), result = search();
  const items = kind === "journey" ? verifiedJourneySelectionItems(result, index, at) : verifiedAccommodationSelectionItems([lodging.offering], [lodging.proof], at);
  const presented = kind === "journey" ? { publicJourneyPresentation: projectPublicJourneyPresentation(result) }
    : { publicAccommodationPresentation: { version: "public-accommodation-presentation-v1" as const, cards: [{ evidenceId: items[0]!.id, name: lodging.offering.name, summary: "合成fixture", retrievedAt: at }] } };
  const retained = await new PlanCandidateRetentionApplication(candidates, () => new Date(at)).retain(
    { principal: stateA, executionId: `replacement:${kind}`, conversationId, tripId, baseTripRevision: 0, userRequest: "候補を検索" }, searchSelectionDraft(items, trip, "slot")!, []);
  const application = new TripApplication(repository, { attach: vi.fn(), detach: vi.fn(), reference: vi.fn() }, fixture.clock,
    new ReservationApplication(repository, new DynamoDbReservationRepository("trips", client)));
  const adoption = new PlanCandidateAdoptionApplication(candidates, repository, candidates, application,
    (draft, context) => trustedCandidateItem(draft, context.candidateSetId, context.variantId, context.retainedItem, context.selectedAt), () => new Date(at));
  const userRequest = kind === "journey" ? "経路1でお願いします" : "検証用ホテルでお願いします";
  const controller = () => createPresentedCandidateController({ messages: [{ role: "assistant", sequence: 2, createdAt: at, text: "候補です", ...presented, publicPlanPresentation: retained.presentation }],
    trip, conversationId, userSequence: 3, executionId: "replacement", userRequest, adoptPlan: (request, authority) => adoption.execute(stateA, request, authority), show: vi.fn() });
  const selection = { presentationId: `shown:2:${kind}`, candidateId: items[0]!.id, quote: userRequest,
    reference: kind === "journey" ? { kind: "ordinal" as const, ordinal: 1, quote: "1" } : { kind: "label" as const, quote: lodging.offering.name } };
  await expect(controller().select(selection)).rejects.toMatchObject({ code: "unavailable" });
  expect(await repository.get(stateA, tripId)).toEqual(trip);
  allowQuery = true;
  expect(await controller().select(selection)).toMatchObject({ status: "saved", tripRevision: 1 });
  const saved = (await repository.get(stateA, tripId))!;
  expect(saved.items).toHaveLength(7); expect(saved.items.slice(1)).toEqual(unrelated);
  expect(saved.items[0]).toMatchObject(kind === "journey" ? { id: "slot", detail: { status: "selected" } }
    : { id: "slot", selection: { status: "selected", accommodation: { providerItemId: "hotel-a" } } });
  expect(queries).toHaveLength(2);
  for (const query of queries) expect(query.input).toMatchObject({ TableName: "trips", ConsistentRead: true,
    KeyConditionExpression: "pk = :owner AND begins_with(sk, :prefix)", ExpressionAttributeValues: { ":owner": { S: `OWNER#${stateA.subject}` }, ":prefix": { S: `RESERVATION#${tripId}#` } } });
});
