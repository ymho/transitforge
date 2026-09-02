import { describe, expect, it } from "vitest";
import type { PlaceMedia } from "@raiquora/trip/place-media";
import { mapPlaceCardModels } from "./map-place-explorer";
import {
  mapAccommodationCandidates,
  mapPlaceCandidates,
  mapRestaurantCandidates,
  mergeMapPlaceDetailCandidate,
} from "../../domain/map-travel-candidate";
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
    expect(mapPlaceCardModels([place({ image })])[0]?.image).toEqual({
      url: image.url,
      attribution: image.attribution,
      sourcePageUrl: "https://example.com/place-1",
    });
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

  it("keeps multiple licensed images and researched editorial sections", () => {
    const images = [
      { url: "https://example.com/1.jpg", attribution: "作者1", descriptionUrl: "https://photos.example.com/1", license: "CC BY-SA 4.0", hotlinkAllowed: true as const },
      { url: "https://example.com/2.jpg", attribution: "作者2", hotlinkAllowed: true as const },
      { url: "https://example.com/3.jpg", attribution: "不明", hotlinkAllowed: "unknown" as const },
    ];
    const model = mapPlaceCardModels([place({
      images,
      reviewAverage: 4.4,
      reviewCount: 321,
      detail: {
        overview: "海岸の景観と灯台の歴史を一緒に楽しめます。",
        highlights: ["展望台", "石造灯台"],
        atmosphere: "日本海を見渡せる開放的な場所です。",
        tips: ["風が強い日は歩きやすい服装が便利です。"],
        nearby: ["日御碕神社"],
      },
    })])[0];

    expect(model?.images).toEqual([
      { url: images[0].url, attribution: "作者1", sourcePageUrl: "https://photos.example.com/1", license: "CC BY-SA 4.0" },
      { url: images[1].url, attribution: "作者2", sourcePageUrl: "https://example.com/place-1" },
    ]);
    expect(model?.reviewLabel).toBe("★ 4.4（321件）");
    expect(model?.detail?.highlights).toEqual(["展望台", "石造灯台"]);
  });

  it("adds a freshly loaded gallery without dropping the researched summary", () => {
    const candidate = mapPlaceCandidates([place({
      detail: { overview: "プロフィールに合う紹介です。" },
    })])[0]!;
    const merged = mergeMapPlaceDetailCandidate(candidate, place({
      providerPlaceId: "refetched-id",
      images: [{
        url: "https://example.com/gallery.jpg",
        attribution: "Wikimedia Commons",
        hotlinkAllowed: true,
      }],
    }));

    expect(merged.id).toBe("place-1");
    expect(merged.value.providerPlaceId).toBe("place-1");
    expect(merged.value.detail?.overview).toBe("プロフィールに合う紹介です。");
    expect(merged.value.images).toHaveLength(1);
  });
});
