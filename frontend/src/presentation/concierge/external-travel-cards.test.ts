import { describe, expect, it } from "vitest";
import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { PlaceMediaSearchResult } from "@raiquora/trip/place-media";
import { placeInspirationImage } from "./external-travel-cards";

describe("placeInspirationImage", () => {
  it("最初の表示可能な写真を掲載元ページへのリンク情報として返す", () => {
    expect(placeInspirationImage(availablePlaces([{
      providerPlaceId: "mapbox.poi",
      name: "出雲大社",
      latitude: 35.4,
      longitude: 132.7,
      sourceUrl: "https://www.mapbox.com/",
      openingHoursStatus: "unknown",
      image: {
        url: "https://imgs.search.brave.com/izumo.jpg",
        attribution: "travel.example",
        descriptionUrl: "https://travel.example/izumo-taisha",
        hotlinkAllowed: true,
      },
    }, {
      providerPlaceId: "mapbox.second",
      name: "日御碕神社",
      sourceUrl: "https://www.mapbox.com/",
      openingHoursStatus: "unknown",
      image: {
        url: "https://imgs.search.brave.com/hinomisaki.jpg",
        attribution: "travel.example",
        descriptionUrl: "https://travel.example/hinomisaki",
        hotlinkAllowed: true,
      },
    }]))).toEqual({
      placeName: "出雲大社",
      imageUrl: "https://imgs.search.brave.com/izumo.jpg",
      sourcePageUrl: "https://travel.example/izumo-taisha",
    });
  });

  it("掲載元が安全なHTTPSでない写真は表示しない", () => {
    expect(placeInspirationImage(availablePlaces([{
      providerPlaceId: "mapbox.poi",
      name: "出雲大社",
      sourceUrl: "https://www.mapbox.com/",
      openingHoursStatus: "unknown",
      image: {
        url: "https://imgs.search.brave.com/izumo.jpg",
        attribution: "unknown",
        descriptionUrl: "http://unsafe.example/izumo",
        hotlinkAllowed: true,
      },
    }]))).toBeUndefined();
    expect(placeInspirationImage(availablePlaces([{
      providerPlaceId: "mapbox.no-source",
      name: "掲載元不明",
      sourceUrl: "https://www.mapbox.com/",
      openingHoursStatus: "unknown",
      image: { url: "https://imgs.search.brave.com/a.jpg", attribution: "unknown", hotlinkAllowed: true },
    }]))).toBeUndefined();
  });
});

function availablePlaces(
  places: PlaceMediaSearchResult["places"],
): ExternalTravelInformation<PlaceMediaSearchResult> {
  return {
    status: "available",
    freshness: "fresh",
    data: { places },
    evidence: [],
  };
}
