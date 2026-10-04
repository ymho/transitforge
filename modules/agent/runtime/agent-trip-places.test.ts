import { expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createAgentContextSnapshot } from "@raiquora/agent/agent-context-snapshot";
import { multiCityTrip, placeActivity, resolvedPlace, placesTripId, placesAt } from "../../trip/domain/trip-places.fixture";

it("keeps requested and adopted places separate in the Application snapshot", () => {
  const base = multiCityTrip(), trip = { ...base, request: { constraints: [{ id: "wishes", strength: "soft" as const, source: "user" as const,
    scope: { type: "trip" as const }, requirement: { type: "destinations" as const, order: "fixed" as const, places: [resolvedPlace("Zermatt")] } }], assumptions: [] } };
  const snapshot = createAgentContextSnapshot(undefined, trip).trip!;
  expect(snapshot).not.toHaveProperty("destination"); expect(snapshot.summaryDestination).toBe("オーストリア・スイス");
  expect(snapshot.itineraryPlaces?.visitedPlaces.map((p) => p.place.name)).toEqual(["Vienna", "Salzburg", "Salzburgの宿", "Zürich"]);
  expect(snapshot.itineraryPlaces?.overnightPlaces.map((p) => p.place.name)).toEqual(["Salzburgの宿"]);
  expect(snapshot.itineraryPlaces?.transportEndpoints[0]?.origin.name).toBe("Vienna");
  expect(snapshot.placesTruncated).toBe(false);
  expect(snapshot.dailyItinerary?.sourceRevision).toBe(trip.revision);
  expect(snapshot.tripStructure?.segments.map(({ kind }) => kind)).toContain("stay-base");
  expect(snapshot.workload?.tripTravelMinutes.completeness).toBe("unknown");

});
it("explicitly marks list/text omission and never manufactures an opaque identity", () => {
  const trip = createTrip(placesTripId, "many", placesAt, Array.from({ length: 30 }, (_, i) => placeActivity(`p${i}`,
    resolvedPlace(i === 0 ? "a".repeat(101) : `P${i}`, i === 1 ? "x".repeat(257) : `id${i}`))));
  const snapshot = createAgentContextSnapshot(undefined, trip).trip!;
  expect(snapshot.itineraryPlaces?.visitedPlaces).toHaveLength(24); expect(snapshot.placesTruncated).toBe(true);
  expect(snapshot.itineraryPlaces?.visitedPlaces[1]?.place).not.toHaveProperty("ref");
  expect(snapshot.itineraryPlaces?.visitedPlaces[0]?.place.name).toHaveLength(100);
});
it("keeps the chosen reference date in Agent context without treating the memo as current availability", () => {
  const trip = createTrip(placesTripId, "青葉庭園", placesAt, [{ id: "garden", type: "activity", title: "青葉庭園",
    category: "sightseeing", schedule: { type: "unscheduled" }, place: { name: "青葉庭園", sources: [] },
    research: { sourceUrl: "https://example.org/garden", observedAt: "2026-09-26T10:00:00Z" } }]);
  const snapshot = createAgentContextSnapshot(undefined, trip).trip!;
  expect(snapshot.schedule[0]).toMatchObject({ placeName: "青葉庭園", researchSourceUrl: "https://example.org/garden",
    researchObservedAt: "2026-09-26T10:00:00Z" });
  expect(snapshot.schedule[0]).not.toHaveProperty("selectionStatus", "verified");

});
