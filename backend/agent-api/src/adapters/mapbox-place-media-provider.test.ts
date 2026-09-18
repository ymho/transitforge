import { describe, expect, it, vi } from "vitest";
import { MapboxPlaceMediaProvider } from "./mapbox-place-media-provider.js";

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
            metadata: {
              website: "https://brewery.example/",
              open_hours: { display_text: "10:00〜17:00" },
              rating: 4.3,
              review_count: 128,
            },
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
      officialWebsiteUrl: "https://brewery.example/",
      openingHours: "10:00〜17:00",
      reviewAverage: 4.3,
      reviewCount: 128,
      latitude: 34.431,
      longitude: 132.743,
    })]);
    expect(result.evidence[0]).toMatchObject({ provider: "mapbox", attribution: "© Mapbox" });
  });

  it("集約サイトを公式サイトとして公開しない", async () => {
    const provider = new MapboxPlaceMediaProvider(
      { fetch: async () => new Response(JSON.stringify({ features: [{
        properties: {
          mapbox_id: "poi.landmark",
          feature_type: "poi",
          name: "通天閣",
          coordinates: { latitude: 34.652, longitude: 135.506 },
          metadata: { website: "https://www.tripadvisor.jp/example" },
        },
      }] }), { status: 200 }) },
      { load: async () => ({ accessToken: "pk.test" }) },
    );

    expect((await provider.search({ query: "通天閣" })).data?.places[0]?.officialWebsiteUrl)
      .toBeUndefined();
  });

  it.each([
    { query: "西条 酒蔵" },
    { query: "西条", categories: ["酒造", "蔵元", "日本酒", "醸造所"] },
    { query: "酒蔵通り資料館" },
    { query: "　ＡＢＣ美術館　" },
  ])("施設名を削らず単一検索に渡す: $query", async (query) => {
    const fetch = vi.fn(async (_input: string) => new Response(JSON.stringify({ features: [] })));
    const provider = new MapboxPlaceMediaProvider({ fetch }, { load: async () => ({ accessToken: "pk.test" }) });
    const result = await provider.search(query);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.searchParams.get("q")).toBe(query.query.normalize("NFKC").trim());
    expect(result.data).toBeUndefined();
    expect(result.failure?.code).toBe("invalid_request");
  });

  it("単一応答の同一IDだけを除去し同名別IDと出典を保持する", async () => {
    const feature = (id: string, type = "poi") => ({ properties: {
      mapbox_id: id, feature_type: type, name: "同名施設",
      coordinates: { longitude: 135, latitude: 35 },
    } });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ features: [
      feature("first"), feature("first"), feature("second"), feature("region", "region"),
    ] })));
    const provider = new MapboxPlaceMediaProvider({ fetch }, { load: async () => ({ accessToken: "pk.test" }) });
    const result = await provider.search({ query: "同名施設", limit: 8 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.data?.places.map((place) => place.providerPlaceId)).toEqual(["first", "second"]);
    expect(result.evidence[0]?.provider).toBe("mapbox");
    expect(JSON.stringify(result)).not.toContain("pk.test");
  });

  it.each([[401, "unauthorized"], [403, "unauthorized"], [429, "rate_limited"], [503, "unavailable"]])(
    "外部失敗%sを追加検索や架空施設で隠さない", async (status, code) => {
      const fetch = vi.fn(async () => new Response("", { status: Number(status) }));
      const provider = new MapboxPlaceMediaProvider({ fetch }, { load: async () => ({ accessToken: "pk.secret" }) });
      const result = await provider.search({ query: "酒蔵" });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failure?.code).toBe(code);
      expect(result.data).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("pk.secret");
    },
  );

  it("通信失敗をunavailableとし空白検索は実行しない", async () => {
    const fetch = vi.fn(async () => { throw new Error("provider raw secret"); });
    const provider = new MapboxPlaceMediaProvider({ fetch }, { load: async () => ({ accessToken: "pk.test" }) });
    expect((await provider.search({ query: "　 " })).failure?.code).toBe("invalid_request");
    expect(fetch).not.toHaveBeenCalled();
    const result = await provider.search({ query: "美術館" });
    expect(result.failure?.code).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("provider raw secret");
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
