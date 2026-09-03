import { describe, expect, it, vi } from "vitest";
import { availableExternalInformation } from "@raiquora/trip/external-travel-information";

import {
  createPlaceDetailResearchOperation,
  fallbackEditorialDetail,
  officialWebsiteFromHits,
  parsedEditorialDetail,
} from "./place-detail-research.js";

describe("place detail research", () => {
  it("searches bounded pages and returns a grounded editorial summary", async () => {
    const summarizer = { converse: vi.fn(async () => ({
      message: { role: "assistant" as const, content: [{ text: JSON.stringify({
        overview: "地域を代表する展望施設です。",
        highlights: ["市街地を見渡せます。"],
        atmosphere: "活気のある街並みです。",
        tips: ["混雑時間を避けると見学しやすいです。"],
      }) }] },
      stopReason: "end_turn" as const,
      metadata: { modelId: "test", latencyMs: 1 },
    })) };
    const operation = createPlaceDetailResearchOperation({
      places: { search: async () => availableExternalInformation({ places: [{
        providerPlaceId: "poi.1", name: "通天閣", latitude: 34.652, longitude: 135.506,
        sourceUrl: "https://www.mapbox.com/", openingHoursStatus: "unknown",
      }] }, []) },
      webSearch: { search: async () => availableExternalInformation({ query: "通天閣", results: [{
        id: "web-1", title: "通天閣 公式サイト", url: "https://www.tsutenkaku.co.jp/",
        description: "展望台を備える大阪の観光施設です。",
      }] }, []) },
      webPageReader: { search: async () => availableExternalInformation({ pages: [{
        url: "https://www.tsutenkaku.co.jp/", title: "通天閣", text: "展望台と館内施設を案内しています。",
        contentType: "html", truncated: false, untrustedExternalContent: true,
      }] }, []) },
      summarizer,
    });

    const response = await operation({ query: "通天閣", latitude: 34.652, longitude: 135.506 }, { requestId: "request-1" });
    const result = response.body.result as { data?: { places: Array<{ officialWebsiteUrl?: string; detail?: { overview?: string } }> } };

    expect(result.data?.places[0]).toMatchObject({
      officialWebsiteUrl: "https://www.tsutenkaku.co.jp/",
      detail: { overview: "地域を代表する展望施設です。" },
    });
    expect(summarizer.converse).toHaveBeenCalledOnce();
  });

  it("accepts fenced JSON but rejects unsupported prose", () => {
    expect(parsedEditorialDetail("```json\n{\"overview\":\"海辺の景観です。\"}\n```"))
      .toEqual({ overview: "海辺の景観です。" });
    expect(parsedEditorialDetail("おすすめです")).toBeUndefined();
  });

  it("shows only a likely official result and rejects an aggregator", () => {
    expect(officialWebsiteFromHits("通天閣", [
      { id: "1", title: "通天閣の口コミ", url: "https://www.tripadvisor.jp/example" },
      { id: "2", title: "通天閣 公式サイト", url: "https://www.tsutenkaku.co.jp/" },
    ])).toBe("https://www.tsutenkaku.co.jp/");
  });

  it("keeps an evidence-based overview when summarization is unavailable", () => {
    expect(fallbackEditorialDetail([
      { id: "1", title: "観光案内", url: "https://example.jp/", description: "地域を代表する展望施設です。" },
    ], [])).toEqual({ overview: "地域を代表する展望施設です。" });
  });
});
