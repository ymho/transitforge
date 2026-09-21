import { describe, expect, it, vi } from "vitest";
import { availableExternalInformation } from "@raiquora/trip/external-travel-information";
import { AgentToolPreconditionError } from "@raiquora/agent/tool-contract";
import {
  executeExternalTravelTool,
  compactExternalTravelToolObservation,
  externalTravelToolDescription,
  externalTravelEvidence,
  hasExternalTravelInformation,
  isSpecificPlaceCandidateName,
  type ExternalTravelToolState,
} from "./external-travel-tools";

describe("external travel tools", () => {
  it("binds bounded description only to its own fresh source, not unrelated pages or raw fields", () => {
    const information = { status: "available", freshness: "fresh", evidence: [{ id: "page-1", provider: "web", sourceUrl: "https://example.org/one" }],
      data: { pages: [{ url: "https://example.org/two", text: "他のページの記述" }, { url: "https://example.org/one", title: "町の案内", text: "白壁".repeat(1000), raw: "private" }] } };
    const facts = externalTravelEvidence({ webPages: information }, { retrievedAt: "2026-09-18T00:00:00Z" })[0]!.facts;
    expect(facts.sourceTitle).toBe("町の案内"); expect(String(facts.sourceExcerpt)).toHaveLength(1200);
    expect(JSON.stringify(facts)).not.toMatch(/他のページ|private/);
    expect(externalTravelEvidence({ webPages: { ...information, freshness: "stale" } }, { retrievedAt: "2026-09-18T00:00:00Z" })[0]!.facts.sourceExcerpt).toBeUndefined();
    expect(externalTravelEvidence({ webPages: { ...information, data: { pages: [information.data.pages[0]] } } }, { retrievedAt: "2026-09-18T00:00:00Z" })[0]!.facts.sourceExcerpt).toBeUndefined();
  });
  it("does not turn mismatched place detail into a cited description", () => {
    const information = { status: "available", freshness: "fresh", evidence: [{ id: "place-1", provider: "web", sourceUrl: "https://example.org/one" }],
      data: { places: [{ sourceUrl: "https://example.org/one", name: "同名の別施設", summary: "混入させない", targetBinding: { status: "mismatch" } }] } };
    expect(externalTravelEvidence({ result: information }, { retrievedAt: "2026-09-18T00:00:00Z" })[0]!.facts.sourceExcerpt).toBeUndefined();
  });
  it("keeps only displayable attributed photos and their candidate source binding in Evidence", () => {
    const information = { status: "available", freshness: "fresh", evidence: [{ id: "place-1", provider: "mapbox", sourceUrl: "https://map.example/izumo" }],
      data: { places: [{ sourceUrl: "https://map.example/izumo", officialWebsiteUrl: "https://visit.example/izumo", name: "出雲大社", summary: "参拝と門前町散策を楽しめます。",
        sources: [{ provider: "web", label: "観光案内", url: "https://visit.example/izumo", role: "discovery" }],
        image: { url: "https://images.example/izumo.jpg", descriptionUrl: "https://photos.example/izumo", attribution: "撮影者", license: "CC BY 4.0", hotlinkAllowed: true } }] } };
    const facts = externalTravelEvidence({ result: information }, { retrievedAt: "2026-09-18T00:00:00Z" })[0]!.facts;
    expect(facts).toMatchObject({ placeName: "出雲大社", imageUrl: "https://images.example/izumo.jpg", imageSourceUrl: "https://photos.example/izumo", imageAttribution: "撮影者" });
    expect(facts.boundSourceUrls).toContain("https://visit.example/izumo");
    information.data.places[0]!.image.hotlinkAllowed = false;
    expect(externalTravelEvidence({ result: information }, { retrievedAt: "2026-09-18T00:00:00Z" })[0]!.facts.imageUrl).toBeUndefined();
  });
  it("records missing acquisition as outcome only, not fabricated Provider facts", () => {
    const [e] = externalTravelEvidence({ forecast: { status: "available", freshness: "fresh", evidence: [], data: { temperature: 25 } } }, { retrievedAt: "2026-09-12T08:00:00Z" });
    expect(e?.facts).toEqual({ resultKind: "weather", status: "unconfirmed", freshness: "unknown" });
    expect(e?.references[0]?.sourceRef).toBe("application://external-result/v1/weather");
    expect(e?.coverage).toBeUndefined();
    expect(JSON.stringify(e)).not.toContain("temperature");
  });
  it("本文未取得の前提不足は本文を取得してから同じ候補で復旧できる", async () => {
    const state: ExternalTravelToolState = {};
    const input = { candidates: [{ name: "賀茂鶴酒造", sourceUrl: "https://tourism.example/kamotsuru" }] };
    const searchPlaceMedia = vi.fn(async () => ({ result: {
      status: "available", freshness: "fresh", evidence: [],
      data: { places: [{ providerPlaceId: "mapbox.kamotsuru", name: "賀茂鶴酒造", officialWebsiteUrl: "https://tourism.example/kamotsuru", latitude: 34, longitude: 132, sourceUrl: "https://www.mapbox.com/", openingHoursStatus: "unknown" }] },
    } }));
    await expect(executeExternalTravelTool("resolve_place_candidates", input, { searchPlaceMedia }, state))
      .rejects.toBeInstanceOf(AgentToolPreconditionError);
    expect(searchPlaceMedia).not.toHaveBeenCalled();

    await executeExternalTravelTool("read_web_pages", { urls: ["https://tourism.example/kamotsuru"] }, {
      readWebPages: async () => ({ webPages: {
        status: "available", freshness: "fresh", evidence: [],
        data: { pages: [{ url: "https://tourism.example/kamotsuru", title: "酒蔵見学", text: "賀茂鶴酒造の見学案内", contentType: "html", truncated: false, untrustedExternalContent: true }] },
      } }),
    }, state);
    await executeExternalTravelTool("resolve_place_candidates", input, { searchPlaceMedia }, state);
    expect(searchPlaceMedia).toHaveBeenCalledOnce();
    expect(state.places?.data?.places[0]?.name).toBe("賀茂鶴酒造");
  });

  it("目的地発見と具体地点の地図検索を能力契約で分離する", () => {
    expect(externalTravelToolDescription("search_web")).toContain("目的地未定の気分や体験希望");
    expect(externalTravelToolDescription("search_web")).toContain("地域 温泉地 自然エリア 具体施設");
    expect(externalTravelToolDescription("search_place_media")).toContain("discovery");
    expect(externalTravelToolDescription("search_place_media")).toContain("日程作成用ではありません");
  });

  it("天気検索結果を構造化状態とEvidenceへ保持する", async () => {
    const state: ExternalTravelToolState = {};
    const forecast = {
      status: "available",
      freshness: "fresh",
      retrievedAt: "2026-08-27T00:00:00.000Z",
      data: { locationName: "香港", daily: [], hourly: [], alertsAvailable: false },
      evidence: [{
        id: "weather:hong-kong",
        kind: "weather",
        provider: "open-meteo",
        sourceUrl: "https://api.open-meteo.com/v1/forecast",
        retrievedAt: "2026-08-27T00:00:00.000Z",
        attribution: "Open-Meteo",
      }],
    };
    const searchWeatherForecast = vi.fn(async () => ({ forecast }));

    const result = await executeExternalTravelTool(
      "search_weather_forecast",
      { location: "香港", startDate: "2026-08-28" },
      { searchWeatherForecast },
      state,
    );

    expect(result).toEqual({ forecast });
    expect(state.weather).toBe(forecast);
    expect(hasExternalTravelInformation(state)).toBe(true);
    expect(externalTravelEvidence(result, { retrievedAt: "2026-08-27T00:00:00.000Z" })[0]).toMatchObject({
      category: "external",
      subject: "香港の天気予報",
    });
  });

  it("片方だけの座標を観光地検索へ渡さない", async () => {
    await expect(executeExternalTravelTool(
      "search_place_media",
      { query: "出雲大社", latitude: 35.4 },
      { searchPlaceMedia: vi.fn() },
      {},
    )).rejects.toThrow("観光地の検索条件が不正です");
  });

  it("Web検索とページ読解を別Toolとして実行し状態へ保持する", async () => {
    const state: ExternalTravelToolState = {};
    const webSearch = { status: "available", freshness: "fresh", data: { query: "西条 酒蔵", results: [{ id: "1", title: "観光協会", url: "https://example.com" }] }, evidence: [] };
    const webPages = { status: "available", freshness: "fresh", data: { pages: [{ url: "https://example.com", text: "見学情報", contentType: "html", truncated: false, untrustedExternalContent: true }] }, evidence: [] };
    await executeExternalTravelTool("search_web", { query: "西条 酒蔵" }, { searchWeb: async () => ({ webSearch }) }, state);
    await executeExternalTravelTool("read_web_pages", { urls: ["https://example.com"] }, { readWebPages: async () => ({ webPages }) }, state);
    expect(state.webSearch).toBe(webSearch);
    expect(state.webPages).toBe(webPages);
  });

  it("完全なWeb結果を状態に保持しつつモデル向けObservationをboundedにする", async () => {
    const longText = "詳しい観光情報".repeat(500);
    const results = Array.from({ length: 8 }, (_, index) => ({
      id: `result-${index}`,
      title: `候補${index}`,
      url: `https://example.com/${index}`,
      description: longText,
      extraSnippets: [longText, longText],
    }));
    const webSearch = {
      status: "available", freshness: "fresh",
      data: { query: "静かに過ごせる場所", results },
      evidence: [{ id: "web-search:brave:12345678:2026-09-02T00:00:00.000Z", provider: "brave-search" }],
    };
    const state: ExternalTravelToolState = {};
    const fullOutput = await executeExternalTravelTool(
      "search_web", { query: "静かに過ごせる場所" }, { searchWeb: async () => ({ webSearch }) }, state,
    );
    const observation = compactExternalTravelToolObservation("search_web", fullOutput) as {
      webSearch: { data: { results: Array<{ description: string; extraSnippets: string[] }> } };
    };

    expect(state.webSearch?.data?.results).toHaveLength(8);
    expect(observation.webSearch.data.results).toHaveLength(5);
    expect(observation.webSearch.data.results[0]?.description.length).toBeLessThanOrEqual(280);
    expect(observation.webSearch.data.results[0]?.extraSnippets).toHaveLength(1);
    expect(new TextEncoder().encode(JSON.stringify(observation)).byteLength).toBeLessThan(8 * 1_024);
  });

  it("気象庁の防災情報を地域指定で検索する", async () => {
    const alerts = availableExternalInformation({ area: "島根県", alerts: [] }, [{
      id: "jma-1", kind: "safety-alert", provider: "jma", sourceUrl: "https://www.data.jma.go.jp/", retrievedAt: "2026-08-30T00:00:00Z", confidence: "observed",
    }]);
    const searchHazardAlerts = vi.fn(async () => ({ alerts }));
    const state: ExternalTravelToolState = {};
    const output = await executeExternalTravelTool("search_travel_alerts", { area: "島根県", categories: ["warning"] }, { searchHazardAlerts }, state);
    expect(searchHazardAlerts).toHaveBeenCalledWith({ area: "島根県", categories: ["warning"] });
    expect(state.alerts).toBe(alerts);
    expect(externalTravelEvidence(output, { retrievedAt: "2026-08-30T00:00:00Z" })[0]?.subject).toBe("島根県の防災情報");
  });

  it("検索済みの駅とPlaceだけを徒歩経路へ渡す", async () => {
    const state: ExternalTravelToolState = { places: { status: "available", freshness: "fresh", evidence: [], data: { places: [{ providerPlaceId: "mapbox.poi", name: "出雲大社", latitude: 35.4, longitude: 132.7, sourceUrl: "https://mapbox.com", openingHoursStatus: "unknown" }] } } };
    const searchGroundAccess = vi.fn(async () => ({ groundAccess: { status: "available", freshness: "fresh", evidence: [], data: {} } }));
    await executeExternalTravelTool("search_ground_access", { action: "route", mode: "walking", origin: { kind: "station", id: "出雲市" }, destinations: [{ kind: "place", id: "mapbox.poi" }] }, { searchGroundAccess, resolveStationGroundPoint: () => ({ entityId: "station:出雲市", name: "出雲市", latitude: 35.36, longitude: 132.75 }) }, state);
    expect(searchGroundAccess).toHaveBeenCalledWith(expect.objectContaining({ action: "route", mode: "walking", origin: expect.objectContaining({ entityId: "station:出雲市" }) }));
  });

  it("飲食店検索の中心を検証済みPlaceから解決する", async () => {
    const state: ExternalTravelToolState = { places: { status: "available", freshness: "fresh", evidence: [], data: { places: [{ providerPlaceId: "mapbox.poi", name: "出雲大社", latitude: 35.4, longitude: 132.7, sourceUrl: "https://mapbox.com", openingHoursStatus: "unknown" }] } } };
    const searchRestaurants = vi.fn(async () => ({ restaurants: { status: "available", freshness: "fresh", evidence: [], data: { area: "出雲大社", restaurants: [] } } }));
    await executeExternalTravelTool("search_restaurants", { area: "出雲大社", keyword: "そば", center: { kind: "place", id: "mapbox.poi" }, requirements: { childFriendly: true, parking: false, unknown: true } }, { searchRestaurants }, state);
    expect(searchRestaurants).toHaveBeenCalledWith({ area: "出雲大社", keyword: "そば", latitude: 35.4, longitude: 132.7, requirements: { childFriendly: true } });
  });

  it("読んだページにある施設だけをMapbox POIへ照合する", async () => {
    const state: ExternalTravelToolState = {
      webPages: {
        status: "available", freshness: "fresh",
        data: { pages: [{ url: "https://tourism.example/kamotsuru", title: "西条酒蔵巡り", text: "賀茂鶴酒造を見学できます", contentType: "html", truncated: false, untrustedExternalContent: true }] },
        evidence: [{ id: "page", kind: "event", provider: "web-page", sourceUrl: "https://tourism.example/kamotsuru", retrievedAt: "2026-08-30T00:00:00Z", confidence: "observed" }],
      },
    };
    const searchPlaceMedia = vi.fn(async () => ({ result: {
      status: "available", freshness: "fresh",
      data: { places: [{ providerPlaceId: "mapbox.kamotsuru", name: "賀茂鶴酒造", officialWebsiteUrl: "https://tourism.example/kamotsuru", latitude: 34, longitude: 132, sourceUrl: "https://www.mapbox.com/", openingHoursStatus: "unknown" }] },
      evidence: [{ id: "mapbox", kind: "place", provider: "mapbox", sourceUrl: "https://www.mapbox.com/", retrievedAt: "2026-08-30T00:00:00Z", confidence: "observed" }],
    } }));
    const output = await executeExternalTravelTool("resolve_place_candidates", { candidates: [{
      name: "賀茂鶴酒造",
      sourceUrl: "https://tourism.example/kamotsuru",
      overview: "酒蔵通りを歩きながら地域の酒造文化を知ることができます。",
      highlights: ["見学可能な醸造施設"],
      atmosphere: "白壁の酒蔵が続く落ち着いた通りです。",
      tips: ["見学時間は公式サイトで確認してください。"],
      nearby: ["西条酒蔵通り"],
    }] }, { searchPlaceMedia }, state);
    expect(searchPlaceMedia).toHaveBeenCalledWith({ query: "賀茂鶴酒造", limit: 3 });
    expect((output as { result: { data: { places: Array<{ sources: unknown[] }> } } }).result.data.places[0]?.sources).toEqual(expect.arrayContaining([expect.objectContaining({ provider: "web" })]));
    expect((output as { result: { data: { places: Array<{ detail: { atmosphere: string } }> } } })
      .result.data.places[0]?.detail.atmosphere).toContain("白壁");
  });

  it("Mapbox POIへ照合できない候補を成功として公開しない", async () => {
    const state: ExternalTravelToolState = {
      webPages: {
        status: "available", freshness: "fresh",
        data: { pages: [{ url: "https://tourism.example/", title: "静かな温泉", text: "静かな温泉で休めます", contentType: "html", truncated: false, untrustedExternalContent: true }] },
        evidence: [],
      },
    };
    const searchPlaceMedia = vi.fn(async () => ({ result: {
      status: "available", freshness: "fresh", evidence: [],
      data: { places: [{ providerPlaceId: "mapbox.other", name: "別の施設", latitude: 34, longitude: 132, sourceUrl: "https://www.mapbox.com/", openingHoursStatus: "unknown" }] },
    } }));

    const output = await executeExternalTravelTool("resolve_place_candidates", {
      candidates: [{ name: "静かな温泉", sourceUrl: "https://tourism.example/" }],
    }, { searchPlaceMedia }, state);
    expect(output).toMatchObject({ targetObservations: [{ status: "unresolved", reason: "missing-source-binding" }] });
    expect(state.places?.data?.places).toEqual([]);
  });

  it("自治体名や交通の一般概念をスポット候補にしない", () => {
    expect(isSpecificPlaceCandidateName("出雲市")).toBe(false);
    expect(isSpecificPlaceCandidateName("江東区")).toBe(false);
    expect(isSpecificPlaceCandidateName("島根県")).toBe(false);
    expect(isSpecificPlaceCandidateName("定期観光バス")).toBe(false);
    expect(isSpecificPlaceCandidateName("旭日酒造")).toBe(true);
    expect(isSpecificPlaceCandidateName("島根ワイナリー")).toBe(true);
  });

  it("汎用的な地点検索結果から自治体と一般概念を除外する", async () => {
    const state: ExternalTravelToolState = {};
    const output = await executeExternalTravelTool(
      "search_place_media",
      { query: "金沢 観光" },
      { searchPlaceMedia: async () => ({ result: {
        status: "available", freshness: "fresh", evidence: [],
        data: { places: [
          { providerPlaceId: "mapbox.city", name: "金沢市" },
          { providerPlaceId: "mapbox.concept", name: "観光" },
          {
            providerPlaceId: "mapbox.garden",
            name: "兼六園",
            sourceUrl: "https://www.mapbox.com/",
            openingHoursStatus: "unknown",
          },
        ] },
      } }) },
      state,
    ) as { result: { data: { places: Array<{ name: string }> } } };

    expect(output.result.data.places.map(({ name }) => name)).toEqual(["兼六園"]);
    expect(state.places?.data?.places.map(({ name }) => name)).toEqual(["兼六園"]);
  });

  it("具体地点のない汎用的な地点検索結果を公開しない", async () => {
    await expect(executeExternalTravelTool(
      "search_place_media",
      { query: "金沢" },
      { searchPlaceMedia: async () => ({ result: {
        status: "available", freshness: "fresh", evidence: [],
        data: { places: [{ providerPlaceId: "mapbox.city", name: "金沢市" }] },
      } }) },
      {},
    )).rejects.toThrow("具体的な施設または地点を確認できませんでした");
  });
});
