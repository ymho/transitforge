import { describe, expect, it } from "vitest";
import type { PlaceMedia } from "@raiquora/trip/place-media";
import { mapPlaceCardModels } from "./map-place-explorer";
import { mapAccommodationCandidates, mapRestaurantCandidates } from "../../domain/map-travel-candidate";
import { mapTravelCandidateCardModels } from "./map-place-explorer";

const place = (overrides: Partial<PlaceMedia> = {}): PlaceMedia => ({
  providerPlaceId: "place-1",
  name: "出雲大社",
  latitude: 35.402,
  longitude: 132.685,
  sourceUrl: "https://example.com/place-1",
  openingHoursStatus: "unknown",
  ...overrides,
});

describe("map travel candidate card models", () => {
  it("shows verified accommodation rating price and availability without inferring them", () => {
    const candidates = mapAccommodationCandidates([{
      providerItemId: "hotel-1",
      name: "駅前の宿",
      checkInDate: "2026-09-01",
      checkOutDate: "2026-09-02",
      latitude: 35.36,
      longitude: 132.75,
      reviewAverage: 4.2,
      reviewCount: 120,
      price: { amount: 8_800, currency: "JPY", basis: "reference-minimum" },
      availability: "unknown",
    }]);
    const model = mapTravelCandidateCardModels(candidates)[0];
    expect(model?.reviewLabel).toBe("★ 4.2（120件）");
    expect(model?.priceLabel).toBe("1泊参考最安 8,800円");
    expect(model?.availabilityLabel).toBe("空室未確認");
    expect(model?.primaryLabel).toBe("この宿を選ぶ");
  });

  it("uses the same map contract for restaurant candidates", () => {
    const candidates = mapRestaurantCandidates([{
      providerRestaurantId: "restaurant-1",
      name: "郷土料理の店",
      latitude: 35.36,
      longitude: 132.75,
      averageBudget: "3,000円",
      detailUrl: "https://example.com/restaurant-1",
    }]);
    expect(mapTravelCandidateCardModels(candidates)[0]).toMatchObject({
      kind: "restaurant",
      budget: "3,000円",
      primaryLabel: "旅程を相談",
    });
  });

  it("distinguishes date-confirmed availability from a reference search", () => {
    const model = mapTravelCandidateCardModels(mapAccommodationCandidates([{
      providerItemId: "hotel-available",
      name: "空室のある宿",
      checkInDate: "2026-09-01",
      checkOutDate: "2026-09-02",
      latitude: 35.36,
      longitude: 132.75,
      price: { amount: 12_000, currency: "JPY", basis: "selected-dates" },
      availability: "available",
    }]))[0];
    expect(model?.priceLabel).toBe("日程内 1泊最安目安 12,000円");
    expect(model?.availabilityLabel).toBe("空室あり");
  });
});

describe("map place card models", () => {
  it("keeps only places that can be shown on the map", () => {
    expect(mapPlaceCardModels([
      place(),
      place({ providerPlaceId: "missing-coordinate", latitude: undefined }),
    ])).toHaveLength(1);
  });

  it("uses an image only when hotlinking is explicitly allowed", () => {
    const image = { url: "https://example.com/image.jpg", attribution: "Example", hotlinkAllowed: true as const };
    expect(mapPlaceCardModels([place({ image })])[0]?.image).toEqual({ url: image.url, attribution: image.attribution });
    expect(mapPlaceCardModels([place({ image: { ...image, hotlinkAllowed: "unknown" } })])[0]?.image).toBeUndefined();
  });

  it("keeps only verified categories and available opening hours for details", () => {
    const model = mapPlaceCardModels([place({
      categories: ["歴史", "自然"],
      openingHours: "9:00〜17:00",
      openingHoursStatus: "available",
    })])[0];
    expect(model?.categories).toEqual(["歴史", "自然"]);
    expect(model?.openingHours).toBe("9:00〜17:00");
    expect(mapPlaceCardModels([place({ openingHours: "9:00〜17:00" })])[0]?.openingHours).toBeUndefined();
  });

  it("keeps a provider-confirmed address for details", () => {
    expect(mapPlaceCardModels([place({ address: "島根県出雲市大社町" })])[0]?.address)
      .toBe("島根県出雲市大社町");
  });
});
