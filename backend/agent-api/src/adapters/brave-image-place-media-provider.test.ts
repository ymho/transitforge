import { describe, expect, it, vi } from "vitest";
import { BraveImagePlaceMediaProvider } from "./brave-image-place-media-provider.js";

describe("BraveImagePlaceMediaProvider", () => {
  it("POI名を日本語で検索しBraveの写真と掲載元ページを返す", async () => {
    let requestedUrl = "";
    let requestedToken = "";
    const provider = new BraveImagePlaceMediaProvider({
      fetch: vi.fn(async (input: string, init?: RequestInit) => {
        requestedUrl = input;
        requestedToken = String(new Headers(init?.headers).get("X-Subscription-Token"));
        return new Response(JSON.stringify({ results: [{
          title: "出雲大社",
          url: "https://travel.example/izumo-taisha",
          source: "travel.example",
          thumbnail: {
            src: "https://imgs.search.brave.com/izumo.jpg",
            width: 500,
            height: 333,
          },
          properties: { url: "https://travel.example/full.jpg", width: 1920, height: 1280 },
        }] }), { status: 200 });
      }),
    }, { load: async () => ({ apiKey: "secret-key" }) }, () => new Date("2026-09-02T00:00:00Z"));

    const result = await provider.search({ query: "出雲大社" });

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe("/res/v1/images/search");
    expect(url.searchParams.get("country")).toBe("JP");
    expect(url.searchParams.get("search_lang")).toBe("ja");
    expect(url.searchParams.get("safesearch")).toBe("strict");
    expect(requestedToken).toBe("secret-key");
    expect(result.data?.places[0]).toMatchObject({
      name: "出雲大社",
      image: {
        url: "https://imgs.search.brave.com/izumo.jpg",
        descriptionUrl: "https://travel.example/izumo-taisha",
        attribution: "travel.example",
        hotlinkAllowed: true,
      },
    });
    expect(result.evidence[0]).toMatchObject({ kind: "media", provider: "brave-image-search" });
    expect(JSON.stringify(result)).not.toContain("secret-key");
    expect(JSON.stringify(result)).not.toContain("/full.jpg");
  });

  it("掲載元ページかHTTPSサムネイルがない結果は表示しない", async () => {
    const provider = new BraveImagePlaceMediaProvider({
      fetch: vi.fn(async () => new Response(JSON.stringify({ results: [
        { url: "http://unsafe.example/page", thumbnail: { src: "https://imgs.search.brave.com/a.jpg" } },
        { url: "https://safe.example/page", thumbnail: { src: "http://unsafe.example/a.jpg" } },
      ] }), { status: 200 })),
    }, { load: async () => ({ apiKey: "secret-key" }) });

    await expect(provider.search({ query: "観光地" })).resolves.toMatchObject({
      status: "unknown",
      failure: { code: "invalid_request" },
    });
  });

  it("代表写真とギャラリーの両方から加工画像を除き、次の写真と出典を採用する", async () => {
    const image = (name: string, title: string, width = 1200, height = 800) => ({
      title, url: `https://travel.example/${name}`, source: "travel.example",
      thumbnail: { src: `https://imgs.search.brave.com/${name}.jpg`, width: 500, height: 333 },
      properties: { url: `https://travel.example/${name}.jpg`, width, height },
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ results: [
      image("main", "出雲大社 文字入り写真"),
      image("ogp", "出雲大社"),
      image("strip", "出雲大社", 1600, 200),
      image("shrine", "出雲大社の鳥居と看板"),
      image("collage", "出雲大社"),
      image("coast", "稲佐の浜の夕景"),
    ] }), { status: 200 }));
    const result = await new BraveImagePlaceMediaProvider({ fetch }, {
      load: async () => ({ apiKey: "test-key" }),
    }).search({ query: "出雲大社", detail: true });

    const place = result.data?.places[0];
    expect(place?.image?.url).toBe("https://imgs.search.brave.com/shrine.jpg");
    expect(place?.images?.map(({ url }) => url)).toEqual([
      "https://imgs.search.brave.com/shrine.jpg", "https://imgs.search.brave.com/coast.jpg",
    ]);
    expect(place?.image?.descriptionUrl).toBe("https://travel.example/shrine");
    expect(place?.sourceUrl).toBe("https://travel.example/shrine");
    expect(place?.sources?.[0]?.url).toBe("https://travel.example/shrine");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("全候補が加工画像なら除外した画像へ戻さない", async () => {
    const provider = new BraveImagePlaceMediaProvider({
      fetch: vi.fn(async () => new Response(JSON.stringify({ results: [{
        title: "出雲大社のポスター", url: "https://travel.example/shrine",
        thumbnail: { src: "https://imgs.search.brave.com/photo.jpg" },
      }] }), { status: 200 })),
    }, { load: async () => ({ apiKey: "test-key" }) });
    const result = await provider.search({ query: "出雲大社" });
    expect(result.data).toBeUndefined();
    expect(result.failure?.retryable).toBe(false);
  });
});
