import { describe, expect, it, vi } from "vitest";
import { MapboxPlaceMediaProvider, placeSearchTerms } from "./mapbox-place-media-provider.js";

describe("MapboxPlaceMediaProvider", () => {
  it("POIだけを日本語と近接条件で検索しMapbox IDで返す", async () => {
    const requestedUrls: string[] = [];
    const fetch = vi.fn(async (input: string) => {
      requestedUrls.push(input);
      return new Response(JSON.stringify({
      features: [
        {
          properties: {
            mapbox_id: "poi.brewery",
            feature_type: "poi",
            name: "西条酒造",
            full_address: "広島県東広島市西条本町",
            poi_category: ["酒蔵", "醸造所"],
            coordinates: { latitude: 34.431, longitude: 132.743 },
            metadata: { website: "https://brewery.example/", open_hours: { display_text: "10:00〜17:00" } },
          },
        },
        {
          properties: {
            mapbox_id: "region.hiroshima",
            feature_type: "region",
            name: "広島県",
            coordinates: { latitude: 34.4, longitude: 132.4 },
          },
        },
      ],
      }), { status: 200 });
    });
    const provider = new MapboxPlaceMediaProvider(
      { fetch },
      { load: async () => ({ accessToken: "pk.test" }) },
      () => new Date("2026-08-30T00:00:00Z"),
    );

    const result = await provider.search({
      query: "西条 酒蔵",
      latitude: 34.43,
      longitude: 132.74,
      limit: 5,
    });

    const requested = new URL(requestedUrls[0] ?? "https://invalid.example/");
    expect(requested.searchParams.get("types")).toBe("poi");
    expect(requested.searchParams.get("country")).toBe("JP");
    expect(requested.searchParams.get("language")).toBe("ja");
    expect(requested.searchParams.get("proximity")).toBe("132.74,34.43");
    expect(result.data?.places).toEqual([expect.objectContaining({
      providerPlaceId: "poi.brewery",
      name: "西条酒造",
      categories: ["酒蔵", "醸造所"],
      openingHours: "10:00〜17:00",
      latitude: 34.431,
      longitude: 132.743,
    })]);
    expect(result.evidence[0]).toMatchObject({ provider: "mapbox", attribution: "© Mapbox" });
  });

  it("酒蔵検索は具体的な同義語へ展開する", () => {
    expect(placeSearchTerms("西条 酒蔵")).toEqual([
      "西条 酒蔵",
      "西条 酒造",
      "西条 日本酒 醸造所",
    ]);
  });

  it("Tokenが未設定なら外部障害として扱い秘密値を要求結果へ含めない", async () => {
    const provider = new MapboxPlaceMediaProvider(
      { fetch: vi.fn() },
      { load: async () => undefined },
    );

    const result = await provider.search({ query: "出雲大社" });

    expect(result).toMatchObject({ status: "unavailable", failure: { code: "unauthorized" } });
  });
});
