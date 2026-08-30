import { describe, expect, it } from "vitest";
import { availableExternalInformation, failedExternalInformation } from "@raiquora/trip/external-travel-information";
import type { PlaceMediaProvider, PlaceMediaSearchResult } from "@raiquora/trip/place-media";
import { EnrichedPlaceMediaProvider } from "./enriched-place-media-provider.js";

describe("EnrichedPlaceMediaProvider", () => {
  it("Mapboxの地点を維持してWikipediaの説明と画像だけを補完する", async () => {
    let enrichmentQuery = "";
    const primary: PlaceMediaProvider = {
      search: async () => availableExternalInformation({ places: [{
        providerPlaceId: "mapbox.poi",
        name: "出雲大社",
        latitude: 35.4,
        longitude: 132.7,
        categories: ["神社"],
        sourceUrl: "https://www.mapbox.com/",
        openingHoursStatus: "unknown",
      }] }, [evidence("mapbox")]),
    };
    const enrichment: PlaceMediaProvider = {
      search: async (query) => {
        enrichmentQuery = query.query;
        return availableExternalInformation({ places: [{
        providerPlaceId: "wikipedia.1",
        name: "出雲大社",
        summary: "島根県出雲市にある神社",
        latitude: 0,
        longitude: 0,
        sourceUrl: "https://ja.wikipedia.org/wiki/x",
        openingHoursStatus: "unknown",
        image: { url: "https://upload.wikimedia.org/x.jpg", attribution: "CC BY-SA", hotlinkAllowed: true },
        }] }, [evidence("wikipedia")]);
      },
    };

    const result = await new EnrichedPlaceMediaProvider(primary, enrichment).search({ query: "出雲大社" });

    expect(result.data?.places[0]).toMatchObject({
      providerPlaceId: "mapbox.poi",
      latitude: 35.4,
      longitude: 132.7,
      categories: ["神社"],
      summary: "島根県出雲市にある神社",
      image: { attribution: "CC BY-SA" },
    });
    expect(result.evidence.map(({ provider }) => provider)).toEqual(["mapbox", "wikipedia"]);
    expect(enrichmentQuery).toBe("出雲大社");
  });

  it("Mapboxを利用できない環境ではWikipediaへフォールバックする", async () => {
    const fallbackResult = availableExternalInformation({ places: [] }, [evidence("wikipedia")]);
    const provider = new EnrichedPlaceMediaProvider(
      { search: async () => failedExternalInformation({ code: "unauthorized", message: "未設定", retryable: false }) },
      { search: async () => fallbackResult },
    );

    await expect(provider.search({ query: "出雲" })).resolves.toBe(fallbackResult);
  });

  it("MapboxでPOIが見つからない場合は一般記事へ置き換えない", async () => {
    const primaryResult = failedExternalInformation<PlaceMediaSearchResult>({ code: "invalid_request", message: "POIなし", retryable: false });
    const provider = new EnrichedPlaceMediaProvider(
      { search: async () => primaryResult },
      { search: async () => availableExternalInformation({ places: [] }, [evidence("wikipedia")]) },
    );

    await expect(provider.search({ query: "岡山市" })).resolves.toBe(primaryResult);
  });
});

function evidence(provider: string) {
  return {
    id: provider,
    kind: "place" as const,
    provider,
    sourceUrl: `https://${provider}.example/`,
    retrievedAt: "2026-08-30T00:00:00Z",
    validUntil: "2026-08-31T00:00:00Z",
    confidence: "observed" as const,
  };
}
