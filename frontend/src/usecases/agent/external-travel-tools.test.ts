import { describe, expect, it, vi } from "vitest";
import { availableExternalInformation } from "@raiquora/trip/external-travel-information";
import {
  executeExternalTravelTool,
  externalTravelEvidence,
  hasExternalTravelInformation,
  isSpecificPlaceCandidateName,
  type ExternalTravelToolState,
} from "./external-travel-tools";

describe("external travel tools", () => {
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

  it("気象庁の防災情報を地域指定で検索する", async () => {
    const alerts = availableExternalInformation({ area: "島根県", alerts: [] }, [{
      id: "jma-1", kind: "safety-alert", provider: "jma", sourceUrl: "https://www.data.jma.go.jp/", retrievedAt: "2026-08-30T00:00:00Z", confidence: "observed",
    }]);
    const searchTravelAlerts = vi.fn(async () => ({ alerts }));
    const state: ExternalTravelToolState = {};
    const output = await executeExternalTravelTool("search_travel_alerts", { area: "島根県", categories: ["warning"] }, { searchTravelAlerts }, state);
    expect(searchTravelAlerts).toHaveBeenCalledWith({ area: "島根県", categories: ["warning"] });
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
        data: { pages: [{ url: "https://tourism.example/", title: "西条酒蔵巡り", text: "賀茂鶴酒造を見学できます", contentType: "html", truncated: false, untrustedExternalContent: true }] },
        evidence: [{ id: "page", kind: "event", provider: "web-page", sourceUrl: "https://tourism.example/", retrievedAt: "2026-08-30T00:00:00Z", confidence: "observed" }],
      },
    };
    const searchPlaceMedia = vi.fn(async () => ({ result: {
      status: "available", freshness: "fresh",
      data: { places: [{ providerPlaceId: "mapbox.kamotsuru", name: "賀茂鶴酒造", latitude: 34, longitude: 132, sourceUrl: "https://www.mapbox.com/", openingHoursStatus: "unknown" }] },
      evidence: [{ id: "mapbox", kind: "place", provider: "mapbox", sourceUrl: "https://www.mapbox.com/", retrievedAt: "2026-08-30T00:00:00Z", confidence: "observed" }],
    } }));
    const output = await executeExternalTravelTool("resolve_place_candidates", { candidates: [{
      name: "賀茂鶴酒造",
      sourceUrl: "https://tourism.example/",
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

  it("自治体名や交通の一般概念をスポット候補にしない", () => {
    expect(isSpecificPlaceCandidateName("出雲市")).toBe(false);
    expect(isSpecificPlaceCandidateName("島根県")).toBe(false);
    expect(isSpecificPlaceCandidateName("定期観光バス")).toBe(false);
    expect(isSpecificPlaceCandidateName("旭日酒造")).toBe(true);
    expect(isSpecificPlaceCandidateName("島根ワイナリー")).toBe(true);
  });
});
