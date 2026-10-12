import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDbTripRepository, type TripDynamoClient } from "../adapters/dynamodb-trip-repository.js";
import { DynamoDbReservationRepository } from "../adapters/dynamodb-reservation-repository.js";
import { ReservationApplication } from "./reservation-application.js";
import { expect, it, vi } from "vitest";
import { searchJourneyIndex } from "@raiquora/journey/journey-search-engine";
import { projectPublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";
import { createItineraryCandidateSet, proposePlanAdoption } from "@raiquora/trip/itinerary-candidates";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";
import { createTrip, applyTripProposal, type ItineraryItem } from "@raiquora/trip/trip";
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


it("adds accommodation to the same trip after adopting rail, preserving the selected route", async () => {
  const fixture = tripDynamoFixture(); fixture.clock.now = () => new Date(at);
  fixture.seed(createTrip(tripId, "出雲大社の検証用旅行", at), stateA.subject);
  const candidates = new DynamoDbItineraryCandidateRepository("trips", fixture.client);
  const retention = new PlanCandidateRetentionApplication(candidates, () => new Date(at));
  const application = new TripApplication(fixture.repository, { attach: vi.fn(), detach: vi.fn(), reference: vi.fn() }, fixture.clock);
  const adoption = new PlanCandidateAdoptionApplication(candidates, fixture.repository, candidates, application,
    (item, context) => trustedCandidateItem(item, context.candidateSetId, context.variantId, context.retainedItem, context.selectedAt), () => new Date(at));
  const lodging = hotel();
  const selections = [verifiedJourneySelectionItems(search(), index, at), verifiedAccommodationSelectionItems([lodging.offering], [lodging.proof], at)];
  let selectedRoute: ItineraryItem | undefined;
  for (const [revision, items] of selections.entries()) {
    const trip = (await fixture.repository.get(stateA, tripId))!;
    const retained = await retention.retain({ principal: stateA, executionId: `combined-${revision}`, conversationId,
      tripId, baseTripRevision: revision, userRequest: "検索した候補を同じ旅程に追加" }, searchSelectionDraft(items, trip)!, []);
    if (retained.presentation.candidateSetRef.kind !== "candidate-set-ref") throw new Error("Candidate was not retained");
    const request = { operation: "preview" as const, conversationId, tripId, candidateSetId: retained.presentation.candidateSetRef.candidateSetId,
      candidateSetRevision: 0, variantId: "option-1", baseTripRevision: revision, mutationId: `75800000-0000-4000-8000-00000000000${revision + 3}` };
    const preview = await adoption.execute(stateA, request);
    if (preview.status !== "confirmation-required") throw new Error("Missing confirmation preview");
    expect(preview.preview.changes).toEqual({ added: 1, replaced: 0, removed: 0 });
    await adoption.execute(stateA, { ...request, operation: "confirm" }, { confirmationKey: preview.confirmationKey });
    const saved = (await fixture.repository.get(stateA, tripId))!;
    expect(saved.revision).toBe(revision + 1);
    if (revision === 0) selectedRoute = structuredClone(saved.items[0]);
    else {
      expect(saved.items).toHaveLength(2);
      expect(saved.items[0]).toEqual(selectedRoute);
      expect(saved.items[1]).toMatchObject({ type: "stay", selection: { accommodation: { providerItemId: "hotel-a" } } });
    }
  }
});

it("retains all ten accommodation choices for adoption instead of dropping the buttons", async () => {
  const lodging = hotel();
  const item = verifiedAccommodationSelectionItems([lodging.offering], [lodging.proof], at)[0]!;
  const items = Array.from({ length: 10 }, (_, index) => ({ ...structuredClone(item), id: `hotel-${index}`, title: `宿${index + 1}` }));
  const trip = createTrip(tripId, "宿の比較", at);
  const draft = searchSelectionDraft(items, trip)!;
  expect(draft.variants).toHaveLength(10);
  const fixture = tripDynamoFixture(); fixture.clock.now = () => new Date(at);
  const retention = new PlanCandidateRetentionApplication(new DynamoDbItineraryCandidateRepository("trips", fixture.client), () => new Date(at));
  const retained = await retention.retain({ principal: stateA, executionId: "ten-hotels", conversationId, tripId, baseTripRevision: 0, userRequest: "宿を比較" }, draft, []);
  expect(retained.presentation.candidates).toHaveLength(10);
  expect(retained.presentation.target?.tripId).toBe(tripId);
  expect(searchSelectionDraft([...items, { ...item, id: "hotel-11" }], trip)).toBeUndefined();
});

it("offers explicit replacement targets when outward and return slots share a day", () => {
  const trip = createTrip(tripId, "日帰り", at, ["outward", "return"].map(id => ({ id, title: id, type: "transport" as const,
    detail: { status: "unresolved" as const }, schedule: { type: "day" as const, date: index.service_date, timeZone: "Asia/Tokyo" } })));
  const items = verifiedJourneySelectionItems(search(), index, at), draft = searchSelectionDraft(items, trip)!;
  expect(draft.variants).toHaveLength(4);
  expect(draft.variants.map(variant => variant.items[0]!.baseItemId)).toEqual(["outward", "outward", "return", "return"]);
  expect(draft.variants.map(variant => variant.label).every(label => label.includes("差し替え"))).toBe(true);
  expect(trip.items).toHaveLength(2);
});

it("anchors a first adopted hotel before adding a logical first-day activity", async () => {
  const base = createTrip(tripId, "1泊旅行", at), { offering, proof } = hotel();
  const selected = verifiedAccommodationSelectionItems([offering], [proof], at);
  const draft = searchSelectionDraft(selected, base)!;
  const set = createItineraryCandidateSet({ id: "initial-hotel", revision: 0, contextRef: { conversationId, tripId, baseTripRevision: 0,
    requestFingerprint: "initial" }, variants: draft.variants, coverage: draft.coverage, selectionItems: draft.selectionItems, issuedAt: at, expiresAt: "2026-10-05T00:00:00Z" });
  const proposal = proposePlanAdoption({ candidateSet: set, variantId: "option-1", currentTrip: base, requestFingerprint: "initial", now: at,
    trustedFactory: item => trustedCandidateItem(item, set.id, "option-1", selected[0], at) }).proposal;
  const saved = applyTripProposal(base, proposal);
  expect(saved.timeline?.calendarBindings.map(binding => binding.date)).toEqual(["2026-10-04", "2026-10-05"]);
  const after = applyTripProposal(saved, { tripId, baseRevision: saved.revision, summary: "初日の観光", patches: [{ type: "add",
    item: { id: "visit", title: "美術館", type: "activity", category: "sightseeing", schedule: { type: "relative", dayId: "day-1" } }, afterId: saved.items[0]!.id }] });
  expect(new Set(projectDailyItinerary(after).days.map(day => day.localDate))).toEqual(new Set(["2026-10-04", "2026-10-05"]));
  expect(projectDailyItinerary(after).days.find(day => day.entries.some(entry => entry.sourceItemId === "visit"))?.localDate).toBe("2026-10-04");
  expect(after.items[0]).toEqual(saved.items[0]);
});

it("updates the selected hotel's planned check-in through a draft without replacing its identity", async () => {
  const { AgentToolRegistry } = await import("@raiquora/agent/tool-registry");
  const { registerPlanCandidateRetentionTool } = await import("./plan-candidate-retention.js");
  const { offering, proof } = hotel(), selected = verifiedAccommodationSelectionItems([offering], [proof], at)[0]!;
  const current = createTrip(tripId, "白浜", at, [{ ...selected, id: "stay" }]);
  let set: import("@raiquora/trip/itinerary-candidates").ItineraryCandidateSet | undefined;
  const repository = { put: async (_owner: unknown, value: NonNullable<typeof set>) => { set = value; }, get: async () => set };
  const tools = new AgentToolRegistry();
  registerPlanCandidateRetentionTool(tools, new PlanCandidateRetentionApplication(repository, () => new Date(at)), {
    principal: stateA, executionId: "check-in", conversationId, tripId, baseTripRevision: 0, currentTrip: current,
    baseItemIds: ["stay"], userRequest: "宿はそのまま、チェックイン16時にして" }, vi.fn());
  expect(await tools.execute("draft_itinerary", { variants: [{ label: "到着時刻", dayCount: 2, items: [{ kind: "stay", title: selected.title,
    day: 1, endDay: 2, baseItemId: "stay", startTime: "16:00", timeQuote: "チェックイン16時" }] }], unknowns: [] }, { executionId: "check-in" })).toMatchObject({ ok: true });
  const proposal = proposePlanAdoption({ candidateSet: set!, variantId: "plan-1", currentTrip: current, requestFingerprint: set!.contextRef.requestFingerprint,
    now: at, trustedFactory: item => trustedCandidateItem(item, set!.id, "plan-1", set!.selectionItems?.[0], at) }).proposal;
  const after = applyTripProposal(current, proposal);
  expect(after.items).toHaveLength(1);
  expect(after.items[0]).toMatchObject({ id: "stay", type: "stay", plannedTiming: { checkIn: { at: "2026-10-04T16:00:00+09:00" } } });
  expect(after.items[0]?.type === "stay" && after.items[0].selection).toEqual(selected.type === "stay" && selected.selection);
});
