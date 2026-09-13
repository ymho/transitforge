import { expect, it } from "vitest";
import { convertLegacyTripPlan } from "./legacy-trip-converter";
import type { TripPlan } from "./trip-plan";
import { projectTripPlaces } from "./trip-places";
import { placesTripId, placesAt } from "./trip-places.fixture";

const identity = { tripId: placesTripId, createdAt: placesAt };
function legacy(destination: string): TripPlan {
  return { version: 1, id: "legacy", title: "周遊", destination, updatedAt: placesAt, items: ["ウィーン", "ザルツブルク", "チューリッヒ"].map((name, i) =>
    ({ id: `s${i}`, type: "sightseeing", place: { name, provider: "manual" } })) };
}
it("maps legacy destination to display-only summary and preserves other-city items, IDs and order", () => {
  const input = legacy("ウィーン"), before = structuredClone(input), result = convertLegacyTripPlan(input, identity);
  expect(result.trip.summaryDestination).toBe("ウィーン");
  expect(result.trip.request).toEqual({ constraints: [], assumptions: [] });
  expect(projectTripPlaces(result.trip).visitedPlaces.map((p) => p.place.name)).toEqual(["ウィーン", "ザルツブルク", "チューリッヒ"]);
  expect(result.trip.items.map((i) => i.id)).toEqual(["s0", "s1", "s2"]);
  expect(result).toEqual(convertLegacyTripPlan(input, identity)); expect(input).toEqual(before);
  expect(convertLegacyTripPlan({ ...input, items: [] }, identity).trip.items).toEqual([]);
});
it.each(["", " \n ", "a".repeat(201)])("warns for invalid legacy destination without inventing a replacement: %s", (destination) => {
  const input = legacy(destination), before = structuredClone(input), result = convertLegacyTripPlan(input, identity);
  expect(result.trip).not.toHaveProperty("summaryDestination");
  expect(result.trip.items).toHaveLength(3);
  expect(result.warnings).toContainEqual({ field: "destination", code: "summary-destination-invalid", ownerIssue: 403 });
  expect(result.requiresLegacyRetention).toBe(true); expect(input).toEqual(before);
});
