import { describe, expect, it } from "vitest";
import { applyTripProposal, createTrip, validateTrip, type Trip } from "./trip";
import { projectTripPlaces, uniqueTripPlaces } from "./trip-places";
import { multiCityTrip, placeActivity, placeTransport, placeStay, resolvedPlace, placesTripId, placesAt } from "./trip-places.fixture";
import { evaluateTripHardConstraints } from "./trip-constraint-evaluation";
import { railSelectionFixture } from "./selected-rail-journey.fixture";
import { selectRailJourney, projectRailSchedule, revalidateSelectedRailJourney } from "./selected-rail-journey";

describe("Trip display hint / ordered adopted places", () => {
  it("supports an absent or bounded display hint, without generating places", () => {
    const trip = createTrip(placesTripId, "旅", placesAt);
    expect(trip).not.toHaveProperty("destination"); expect(trip).not.toHaveProperty("summaryDestination");
    for (const summaryDestination of [undefined, "北海道周遊", "a".repeat(200)]) {
      const next = createTrip(placesTripId, "旅", placesAt, [], undefined, undefined, summaryDestination);
      expect(projectTripPlaces(next)).toEqual({ visitedPlaces: [], overnightPlaces: [], transportEndpoints: [] });
    }
    for (const summaryDestination of ["", " \n ", "a".repeat(201), null, 12, {}]) {
      expect(() => validateTrip({ ...trip, summaryDestination } as Trip)).toThrow();
    }
    expect(() => validateTrip({ ...trip, destination: "single" } as Trip)).toThrow();
  });
  it("preserves summary on item patches without geographic synchronization", () => {
    const trip = multiCityTrip();
    const next = applyTripProposal(trip, { tripId: trip.id, baseRevision: trip.revision, summary: "追加", patches: [{ type: "add", item: placeActivity("new", { name: "Tokyo", sources: [] }) }] });
    expect(next.summaryDestination).toBe(trip.summaryDestination);
    expect(next.request).toEqual(trip.request); expect(trip.items).toHaveLength(3);
  });
  it.each([
    ["Vienna", "Salzburg", "Zürich"], ["Tokyo", "Hakodate", "Sapporo"], ["Vienna", "Salzburg", "Vienna"], ["Vienna"],
  ])("keeps item order and revisits for %j", (...names) => {
    const trip = createTrip(placesTripId, "旅", placesAt, names.map((name, i) => placeActivity(`a${i}`, resolvedPlace(name))));
    const before = structuredClone(trip), result = projectTripPlaces(trip);
    expect(result.visitedPlaces.map((p) => p.place.name)).toEqual(names);
    expect(result.visitedPlaces.map((p) => p.itemId)).toEqual(names.map((_, i) => `a${i}`));
    expect(result).toEqual(projectTripPlaces(trip));
    Object.assign(result.visitedPlaces[0]!.place, { name: "caller edit" });
    expect(trip).toEqual(before);
  });
  it("projects every selected rail leg, not only aggregate endpoints; snapshot and revalidation are unchanged", () => {
    const f = railSelectionFixture(), journey = selectRailJourney(f.candidate, f.inputs, f.selectedAt);
    const trip = createTrip(placesTripId, "rail", placesAt, [{ id: "rail", title: "rail", type: "transport", schedule: projectRailSchedule(journey), detail: { status: "selected", mode: "rail", journey } }]);
    const before = structuredClone(trip), result = projectTripPlaces(trip);
    expect(result.visitedPlaces.map((p) => p.place.name)).toEqual(["A", "B", "B", "C"]);
    expect(result.transportEndpoints.map((p) => p.legIndex)).toEqual([0, 1]);
    expect(result.visitedPlaces.map((p) => p.role)).toEqual(["transport-origin", "transport-destination", "transport-origin", "transport-destination"]);
    expect(JSON.stringify(result)).not.toMatch(/delayMinutes|trainNumber|congestion/);
    expect(revalidateSelectedRailJourney(journey, f.inputs)).toBe(true); expect(trip).toEqual(before);
  });
  it("uses adopted endpoints, selected accommodation and activity; excludes unresolved/free time/unselected stays", () => {
    const trip = createTrip(placesTripId, "旅", placesAt, [
      placeTransport("walk", "Vienna", "Salzburg"),
      { id: "unknown", type: "transport", title: "移動", schedule: { type: "unscheduled" }, detail: { status: "unresolved" } },
      placeStay("stay", "宿泊施設"),
      { id: "unselected", type: "stay", title: "宿", schedule: { type: "unscheduled" }, selection: { status: "unselected", place: resolvedPlace("候補地域") } },
      placeActivity("sight", resolvedPlace("Zürich")), placeActivity("free"),
    ]);
    const result = projectTripPlaces(trip);
    expect(result.visitedPlaces.map((p) => p.place.name)).toEqual(["Vienna", "Salzburg", "宿泊施設", "Zürich"]);
    expect(result.overnightPlaces.map((p) => p.place.name)).toEqual(["宿泊施設"]);
    expect(result.transportEndpoints).toHaveLength(1);
    expect(result.transportEndpoints[0]).not.toHaveProperty("legIndex");
  });
  it("only deduplicates resolved identity in the optional first-seen view", () => {
    const inputs = [resolvedPlace("Vienna", "1"), resolvedPlace("Salzburg", "2"), resolvedPlace("Wien", "1"),
      resolvedPlace("Vienna", "3"), resolvedPlace("Vienna", "1", "other"),
      { name: "Vienna", sources: [] }, { name: "Vienna", sources: [] }, { name: "Wien", sources: [] }];
    const trip = createTrip(placesTripId, "旅", placesAt, inputs.map((p, i) => placeActivity(`a${i}`, p)));
    const ordered = projectTripPlaces(trip).visitedPlaces;
    expect(ordered).toHaveLength(8);
    expect(uniqueTripPlaces(ordered).map((p) => p.itemId)).toEqual(["a0", "a1", "a3", "a4", "a5", "a6", "a7"]);
    expect(ordered).toHaveLength(8);
  });
  it("keeps requests, adopted places, and summaries independent; destination feasibility remains unknown", () => {
    const request = { constraints: [{ id: "wishes", strength: "hard" as const, source: "user" as const, scope: { type: "trip" as const },
      requirement: { type: "destinations" as const, order: "fixed" as const, places: [resolvedPlace("Vienna"), resolvedPlace("Salzburg")] } }], assumptions: [] };
    for (const items of [[], [placeActivity("a", resolvedPlace("Vienna"))]]) {
      const trip = createTrip(placesTripId, "旅", placesAt, items, request, undefined, "スイス");
      expect(projectTripPlaces(trip).visitedPlaces.map((p) => p.place.name)).toEqual(items.length ? ["Vienna"] : []);
      expect(evaluateTripHardConstraints(trip)).toEqual([{ constraintId: "wishes", status: "unknown", reasonCode: "insufficient_planned_facts" }]);
    }
  });
});
