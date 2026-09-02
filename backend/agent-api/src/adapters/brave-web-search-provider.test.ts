import { describe, expect, it, vi } from "vitest";
import { BraveWebSearchProvider } from "./brave-web-search-provider.js";

describe("BraveWebSearchProvider", () => {
  it("日本語のWeb結果をboundedなEvidence付きで返す", async () => {
    let requestedUrl = "";
    let requestedToken = "";
    const provider = new BraveWebSearchProvider({
      fetch: vi.fn(async (input: string, init?: RequestInit) => {
        requestedUrl = input;
        requestedToken = String(new Headers(init?.headers).get("X-Subscription-Token"));
        return new Response(JSON.stringify({ web: { results: [{ title: "西条酒蔵通り", url: "https://tourism.example/saijo", description: "複数の酒蔵を巡れます", extra_snippets: ["見学情報"] }] } }), { status: 200 });
      }),
    }, { load: async () => ({ apiKey: "secret-key" }) }, () => new Date("2026-08-30T00:00:00Z"));

    const result = await provider.search({ query: "西条 酒蔵 見学", limit: 3 });

    const url = new URL(requestedUrl);
    expect(url.searchParams.get("country")).toBe("JP");
    expect(url.searchParams.get("search_lang")).toBe("jp");
    expect(requestedToken).toBe("secret-key");
    expect(result.data?.results[0]).toMatchObject({ title: "西条酒蔵通り", url: "https://tourism.example/saijo", extraSnippets: ["見学情報"] });
    expect(result.evidence[0]?.id).toMatch(/^web-search:brave:[a-f0-9]{8}:2026-08-30T00:00:00\.000Z$/u);
    expect(result.evidence[0]?.id.length).toBeLessThanOrEqual(128);
    expect(result.evidence[0]?.id).not.toContain("西条");
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });
});
