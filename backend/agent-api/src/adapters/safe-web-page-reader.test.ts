import { describe, expect, it, vi } from "vitest";
import { SafeWebPageReader } from "./safe-web-page-reader.js";

describe("SafeWebPageReader", () => {
  it("scriptを除いたboundedな本文と出典を返す", async () => {
    const reader = new SafeWebPageReader({
      fetch: vi.fn(async () => new Response("<html><title>酒蔵見学</title><script>ignore()</script><article>見学は予約制です。</article></html>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } })),
    }, { resolve: async () => ["203.0.113.10"] }, () => new Date("2026-08-30T00:00:00Z"));

    const result = await reader.search({ urls: ["https://brewery.example/visit"] });

    expect(result.data?.pages[0]).toMatchObject({ title: "酒蔵見学", text: "酒蔵見学 見学は予約制です。", untrustedExternalContent: true });
    expect(result.data?.pages[0]?.text).not.toContain("ignore");
    expect(result.evidence[0]?.sourceUrl).toBe("https://brewery.example/visit");
  });

  it.each(["https://127.0.0.1/private", "http://example.com/", "https://service.internal/"])("危険なURL %s を拒否する", async (url) => {
    const fetch = vi.fn();
    const reader = new SafeWebPageReader({ fetch }, { resolve: async () => ["127.0.0.1"] });
    const result = await reader.search({ urls: [url] });
    expect(result.status).toBe("unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("redirect先もDNS検証する", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://localhost/private" } }));
    const reader = new SafeWebPageReader({ fetch }, { resolve: async () => ["203.0.113.10"] });
    const result = await reader.search({ urls: ["https://public.example/"] });
    expect(result.status).toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
