import { describe, it, expect } from "vitest";
import { executeExternalTravelTool, compactExternalTravelToolObservation, type ExternalTravelToolState } from "./external-travel-tools";
import { availableExternalInformation } from "@raiquora/trip/external-travel-information";
import { createTrip } from "@raiquora/trip/trip";
import type { PlaceMedia } from "@raiquora/trip/place-media";

const place = (id: string, name: string): PlaceMedia => ({ providerPlaceId: id, name, latitude: 34, longitude: 133,
  sourceUrl: "https://www.mapbox.com/", openingHoursStatus: "unknown",
  sources: [{ provider: "mapbox", role: "identity", label: "Mapbox", url: "https://www.mapbox.com/" }] });
const district = place("district", "倉敷美観地区");
const shop = place("shop", "倉敷美観地区コンビニ");
const info = (places: PlaceMedia[]) => availableExternalInformation({ places }, [{ id: "search", kind: "place", provider: "mapbox",
  sourceUrl: "https://www.mapbox.com/", retrievedAt: "2026-09-12T08:00:00Z", confidence: "observed" }]);

describe("production target binding / Assessment", () => {
  it("rejects a district-named shop as target and exposes questionable relevance to the Agent", async () => {
    const state: ExternalTravelToolState = { places: info([district]) };
    const output = await executeExternalTravelTool("search_place_media", { query: district.name, mode: "target", targetPlaceId: district.providerPlaceId },
      { searchPlaceMedia: async () => ({ result: info([shop]) }) }, state);
    expect(compactExternalTravelToolObservation("search_place_media", output)).toMatchObject({
      candidateAssessments: [{ candidateId: "shop", relevance: { status: "questionable", reasonCodes: ["identity-mismatch"] } }],
      targetObservations: [{ status: "mismatch" }], result: { data: { places: [] } },
    });
  });
  it("allows discovery entities but never claims query target relevance from the stable entity ID", async () => {
    const state: ExternalTravelToolState = {};
    const output = await executeExternalTravelTool("search_place_media", { query: district.name },
      { searchPlaceMedia: async () => ({ result: info([shop]) }) }, state);
    expect(output).toMatchObject({ searchPurpose: "discovery", candidateAssessments: [{ relevance: { status: "unknown" } }] });
    expect(state.places!.data!.places[0]?.name).toBe(shop.name);
  });
  it("connects adopted Trip destination intent to existing constraint Assessment, not name matching", async () => {
    const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-09-12T08:00:00Z", [], {
      constraints: [{ id: "destination", strength: "hard", source: "user", scope: { type: "trip" },
        requirement: { type: "destinations", order: "fixed", places: [{ name: district.name,
          ref: { provider: "mapbox", providerPlaceId: "district" }, sources: [{ id: "district-source", kind: "place", provider: "mapbox",
            sourceId: "district", retrievedAt: "2026-09-12T07:00:00Z", confidence: "observed" }] }] } }], assumptions: [],
    });
    const output = await executeExternalTravelTool("search_place_media", { query: district.name },
      { getCurrentTrip: () => trip, searchPlaceMedia: async () => ({ result: info([shop, district]) }) }, {});
    expect(output).toMatchObject({ candidateAssessments: [
      { candidateId: "shop", relevance: { status: "unknown" } },
      { candidateId: "district", relevance: { status: "fit", reasonCodes: ["verified-match"] } },
    ] });
  });
  it("does not erase known unresolved observations by changing to discovery", async () => {
    const output = await executeExternalTravelTool("search_place_media", { query: district.name },
      { searchPlaceMedia: async () => ({ result: info([{ ...shop, targetBinding: { status: "unresolved", reason: "missing-binding" } }]) }) }, {});
    expect(output).toMatchObject({ result: { data: { places: [] } } });
  });
  it("accepts exact target IDs and keeps different ID detail responses out", async () => {
    const state: ExternalTravelToolState = { places: info([district]) };
    await executeExternalTravelTool("search_place_media", { query: district.name, mode: "target", targetPlaceId: "district" },
      { searchPlaceMedia: async () => ({ result: info([district, shop]) }) }, state);
    expect(state.places!.data!.places).toHaveLength(1);
    expect(state.places!.data!.places[0]?.providerPlaceId).toBe("district");
  });
  it("keeps restaurant discovery's own identity/coordinates without name-only Mapbox enrichment", async () => {
    const restaurant = { providerRestaurantId: "hotpepper-1", name: shop.name, latitude: 34, longitude: 133,
      detailUrl: "https://example.com/restaurant" };
    const state: ExternalTravelToolState = {};
    await executeExternalTravelTool("search_restaurants", { area: "倉敷", keyword: "食事" }, {
      searchRestaurants: async () => ({ restaurants: availableExternalInformation({ area: "倉敷", restaurants: [restaurant] }, []) }),
      searchPlaceMedia: async () => ({ result: info([shop]) }),
    }, state);
    expect(state.restaurants!.data!.restaurants[0]?.mapboxPlaceId).toBeUndefined();
    expect(state.restaurants!.data!.restaurants[0]?.name).toBe(shop.name);
  });
});
