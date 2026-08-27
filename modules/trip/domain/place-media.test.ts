import { describe, expect, it } from "vitest";
import { mergePlaceMedia, placeMediaQueryForTrip } from "./place-media";
describe("place media", () => {
  it("builds a bounded query from trip interests and time", () => { expect(placeMediaQueryForTrip({ destination: "出雲", interests: ["歴史"], availableFrom: "2026-09-01T13:00:00+09:00" })).toEqual(expect.objectContaining({ query: "出雲", categories: ["歴史"], limit: 5 })); });
  it("merges duplicate provider entities at the same coordinate", () => { expect(mergePlaceMedia([{ providerPlaceId: "1", name: "A", sourceUrl: "x", openingHoursStatus: "unknown", latitude: 1, longitude: 2 }, { providerPlaceId: "1", name: "A", sourceUrl: "x", openingHoursStatus: "unknown", latitude: 1, longitude: 2 }])).toHaveLength(1); });
});
