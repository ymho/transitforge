import { describe, expect, it, vi } from "vitest";
import { availableExternalInformation } from "@raiquora/trip/external-travel-information";
import { createWebPageReadOperation, createWebSearchOperation } from "./web-research.js";

describe("web research operations", () => {
  it("Web検索入力を検証してProviderへ渡す", async () => {
    const search = vi.fn(async () => availableExternalInformation({ query: "酒蔵", results: [] }, []));
    const operation = createWebSearchOperation({ search });
    const response = await operation({ query: " 酒蔵 ", limit: 3, domains: ["example.com"] }, { requestId: "r" });
    expect(search).toHaveBeenCalledWith({ query: "酒蔵", limit: 3, domains: ["example.com"] });
    expect(response.statusCode).toBeUndefined();
  });

  it("Page Readerへ渡すURLを4件へ制限する", async () => {
    const requests: Array<{ urls: string[] }> = [];
    const search = vi.fn(async (request: { urls: string[] }) => {
      requests.push(request);
      return availableExternalInformation({ pages: [] }, []);
    });
    const operation = createWebPageReadOperation({ search });
    await operation({ urls: ["https://a.example", "https://b.example", "https://c.example", "https://d.example", "https://e.example"] }, { requestId: "r" });
    expect(requests[0]?.urls).toHaveLength(4);
  });
});
