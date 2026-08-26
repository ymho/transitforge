import { describe, expect, it } from "vitest";

import { HttpAccommodationProvider } from "./http-accommodation-provider.js";

describe("HttpAccommodationProvider", () => {
  it("既存Provider fixtureを価格なしの共通契約へ変換する", async () => {
    let requestedUrl = "";
    let requestedHeaders: Record<string, string> = {};
    const provider = new HttpAccommodationProvider({
      async fetch(url, init) {
        requestedUrl = url; requestedHeaders = init.headers;
        return { ok: true, async json() { return { hotels: [[{ hotelBasicInfo: { hotelNo: 42, hotelName: "駅前の宿", hotelInformationUrl: "https://booking.example/42", hotelImageUrl: "https://images.example/42.jpg", address1: "出雲市" } }]] }; } };
      },
    }, { async load() { return { applicationId: "app", accessKey: "secret", hotelSearchUrl: "https://provider.example/search" }; } });
    const results = await provider.search({ destination: "出雲市", checkInDate: "2026-08-17", checkOutDate: "2026-08-18", adults: 1, limit: 3 });
    expect(results).toEqual([{ kind: "accommodation", provider: "travel-provider", providerItemId: "42", name: "駅前の宿", checkInDate: "2026-08-17", checkOutDate: "2026-08-18", bookingUrl: "https://booking.example/42", areaName: "出雲市", imageUrl: "https://images.example/42.jpg" }]);
    expect(requestedHeaders.accessKey).toBe("secret");
    expect(requestedUrl).toContain("applicationId=app");
    expect(requestedUrl).toContain("keyword=%E5%87%BA%E9%9B%B2%E5%B8%82");
  });

  it("Provider障害を内部情報のないエラーへ変換する", async () => {
    const provider = new HttpAccommodationProvider({ async fetch() { throw new Error("secret upstream detail"); } }, { async load() { return { applicationId: "app", accessKey: "secret", hotelSearchUrl: "https://provider.example/search" }; } });
    await expect(provider.search({ destination: "出雲市", checkInDate: "2026-08-17", checkOutDate: "2026-08-18", adults: 1, limit: 3 })).rejects.toThrow("宿泊提供者の検索を利用できません");
  });
});
