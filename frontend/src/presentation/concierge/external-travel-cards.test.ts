// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { PlaceMediaSearchResult } from "@raiquora/trip/place-media";
import { placeInspirationImage, placeInspirationImages, renderExternalTravelInformation } from "./external-travel-cards";

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
      attribution: "travel.example",
    });
  });

  it("会話のstarter planへ代表写真と掲載元リンクを描画する", () => {
    const external = { places: availablePlaces([{
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
    }]) };

    const cards = renderExternalTravelInformation({ text: "1泊2日のモデルコース", external }, {
      includePlaceInspiration: true,
    });

    expect(cards.querySelector<HTMLImageElement>(".external-place-inspiration img")?.src)
      .toBe("https://imgs.search.brave.com/izumo.jpg");
    expect(cards.querySelector<HTMLAnchorElement>(".external-place-inspiration a")?.href)
      .toBe("https://travel.example/izumo-taisha");
  });

  it("目的地未定の提案では異なる候補の写真を最大3枚表示する", () => {
    const places = ["城崎温泉", "おごと温泉", "倉敷美観地区", "宮島"].map((name, index) => ({
      providerPlaceId: `mapbox.${index}`,
      name,
      sourceUrl: "https://www.mapbox.com/",
      openingHoursStatus: "unknown" as const,
      image: {
        url: `https://imgs.search.brave.com/${index}.jpg`,
        attribution: "travel.example",
        descriptionUrl: `https://travel.example/${index}`,
        hotlinkAllowed: true as const,
      },
    }));

    expect(placeInspirationImages(availablePlaces(places)).map(({ placeName }) => placeName))
      .toEqual(["城崎温泉", "おごと温泉", "倉敷美観地区"]);
    const cards = renderExternalTravelInformation({ text: "候補を3つ提案します", external: {
      places: availablePlaces(places),
    } }, { includePlaceInspiration: true });
    expect(Array.from(cards.querySelectorAll<HTMLImageElement>(".external-place-inspiration img"))
      .map(({ alt }) => alt)).toEqual(["城崎温泉", "おごと温泉", "倉敷美観地区"]);
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
