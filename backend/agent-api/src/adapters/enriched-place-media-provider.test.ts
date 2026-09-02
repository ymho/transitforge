import { describe, expect, it } from "vitest";
import { availableExternalInformation, failedExternalInformation } from "@raiquora/trip/external-travel-information";
import type { PlaceMediaProvider, PlaceMediaSearchResult } from "@raiquora/trip/place-media";
import { EnrichedPlaceMediaProvider } from "./enriched-place-media-provider.js";

describe("EnrichedPlaceMediaProvider", () => {
  it("Mapboxの地点を維持してWeb検索の画像だけを補完する", async () => {
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
        providerPlaceId: "brave-image.1",
        name: "出雲大社",
        summary: "島根県出雲市にある神社",
        latitude: 0,
        longitude: 0,
        sourceUrl: "https://travel.example/izumo",
        sources: [{ provider: "brave-image-search", label: "travel.example", url: "https://travel.example/izumo", role: "discovery" }],
        openingHoursStatus: "unknown",
        image: { url: "https://imgs.search.brave.com/x.jpg", attribution: "travel.example", hotlinkAllowed: true },
        }] }, [evidence("brave-image-search")]);
      },
    };

    const result = await new EnrichedPlaceMediaProvider(primary, enrichment).search({ query: "出雲大社" });

    expect(result.data?.places[0]).toMatchObject({
      providerPlaceId: "mapbox.poi",
      latitude: 35.4,
      longitude: 132.7,
      categories: ["神社"],
      summary: "島根県出雲市にある神社",
      image: { attribution: "travel.example" },
    });
    expect(result.evidence.map(({ provider }) => provider)).toEqual(["mapbox", "brave-image-search"]);
    expect(result.data?.places[0]?.sources).toContainEqual(expect.objectContaining({
      provider: "brave-image-search",
      url: "https://travel.example/izumo",
    }));
    expect(enrichmentQuery).toBe("出雲大社");
  });

  it("POI検索を利用できない環境ではWeb画像を地点候補として代用しない", async () => {
    const primaryResult = failedExternalInformation<PlaceMediaSearchResult>({ code: "unauthorized", message: "未設定", retryable: false });
    const provider = new EnrichedPlaceMediaProvider(
      { search: async () => primaryResult },
      { search: async () => availableExternalInformation({ places: [] }, [evidence("brave-image-search")]) },
    );

    await expect(provider.search({ query: "出雲" })).resolves.toBe(primaryResult);
  });

  it("Mapbox未設定時はWikipediaの地点へWeb画像だけを上書きする", async () => {
    const provider = new EnrichedPlaceMediaProvider(
      { search: async () => failedExternalInformation({ code: "unauthorized", message: "未設定", retryable: false }) },
      { search: async () => availableExternalInformation({ places: [{
        providerPlaceId: "brave-image.1",
        name: "出雲大社",
        sourceUrl: "https://travel.example/izumo",
        openingHoursStatus: "unknown",
        image: { url: "https://imgs.search.brave.com/x.jpg", attribution: "travel.example", descriptionUrl: "https://travel.example/izumo", hotlinkAllowed: true },
      }] }, [evidence("brave-image-search")]) },
      () => new Date("2026-08-30T00:00:00Z"),
      { search: async () => availableExternalInformation({ places: [{
        providerPlaceId: "wikipedia.city",
        name: "出雲市",
        latitude: 35.36,
        longitude: 132.75,
        sourceUrl: "https://ja.wikipedia.org/wiki/city",
        openingHoursStatus: "unknown",
      }, {
        providerPlaceId: "wikipedia.1",
        name: "出雲大社",
        latitude: 35.402,
        longitude: 132.685,
        sourceUrl: "https://ja.wikipedia.org/wiki/x",
        openingHoursStatus: "unknown",
        image: { url: "https://upload.wikimedia.org/x.jpg", attribution: "Wikipedia", hotlinkAllowed: true },
      }] }, [evidence("wikipedia")]) },
    );

    const result = await provider.search({ query: "出雲大社", limit: 1 });

    expect(result.data?.places[0]).toMatchObject({
      providerPlaceId: "wikipedia.1",
      latitude: 35.402,
      image: { url: "https://imgs.search.brave.com/x.jpg", descriptionUrl: "https://travel.example/izumo" },
      images: [{ url: "https://imgs.search.brave.com/x.jpg" }],
    });
    expect(result.data?.places.map(({ name }) => name)).toEqual(["出雲大社"]);
    expect(result.evidence.map(({ provider }) => provider)).toEqual(["wikipedia", "brave-image-search"]);
  });

  it("Web画像が見つからない場合はWikipediaの写真と説明を表示しない", async () => {
    const provider = new EnrichedPlaceMediaProvider(
      { search: async () => failedExternalInformation({ code: "unauthorized", message: "未設定", retryable: false }) },
      { search: async () => failedExternalInformation({ code: "invalid_request", message: "画像なし", retryable: false }) },
      () => new Date("2026-08-30T00:00:00Z"),
      { search: async () => availableExternalInformation({ places: [{
        providerPlaceId: "wikipedia.1",
        name: "出雲大社",
        summary: "Wikipediaの説明",
        latitude: 35.402,
        longitude: 132.685,
        sourceUrl: "https://ja.wikipedia.org/wiki/x",
        openingHoursStatus: "unknown",
        image: { url: "https://upload.wikimedia.org/x.jpg", attribution: "Wikipedia", hotlinkAllowed: true },
      }] }, [evidence("wikipedia")]) },
    );

    const result = await provider.search({ query: "出雲大社" });

    expect(result.data?.places[0]).toMatchObject({ providerPlaceId: "wikipedia.1", latitude: 35.402 });
    expect(result.data?.places[0]?.image).toBeUndefined();
    expect(result.data?.places[0]?.images).toBeUndefined();
    expect(result.data?.places[0]?.summary).toBeUndefined();
  });

  it("POIが見つからない場合は一般記事へ置き換えない", async () => {
    const primaryResult = failedExternalInformation<PlaceMediaSearchResult>({ code: "invalid_request", message: "POIなし", retryable: false });
    const provider = new EnrichedPlaceMediaProvider(
      { search: async () => primaryResult },
      { search: async () => availableExternalInformation({ places: [] }, [evidence("brave-image-search")]) },
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
