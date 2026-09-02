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
});
