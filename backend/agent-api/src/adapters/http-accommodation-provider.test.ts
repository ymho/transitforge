import { describe, expect, it } from "vitest";

import { HttpAccommodationProvider } from "./http-accommodation-provider.js";

describe("HttpAccommodationProvider", () => {
  it("Provider fixtureを地図表示と参考価格を含む共通契約へ変換する", async () => {
    let requestedUrl = "";
    let requestedHeaders: Record<string, string> = {};
    const provider = new HttpAccommodationProvider({
      async fetch(url, init) {
        requestedUrl = url; requestedHeaders = init.headers;
        return { ok: true, async json() { return { hotels: [[{ hotelBasicInfo: { hotelNo: 42, hotelName: "駅前の宿", hotelInformationUrl: "https://booking.example/42", hotelImageUrl: "https://images.example/42.jpg", address1: "島根県", address2: "出雲市駅前", latitude: 35.36, longitude: 132.75, reviewAverage: 4.2, reviewCount: 120, hotelMinCharge: 8800 } }]] }; } };
      },
    }, { async load() { return { applicationId: "app", accessKey: "secret", hotelSearchUrl: "https://provider.example/search" }; } });
    const results = await provider.search({ destination: "出雲市", checkInDate: "2026-08-17", checkOutDate: "2026-08-18", adults: 1, limit: 3 });
    expect(results).toEqual([{ kind: "accommodation", provider: "travel-provider", providerItemId: "42", name: "駅前の宿", checkInDate: "2026-08-17", checkOutDate: "2026-08-18", bookingUrl: "https://booking.example/42", areaName: "島根県", imageUrl: "https://images.example/42.jpg", address: "島根県出雲市駅前", latitude: 35.36, longitude: 132.75, reviewAverage: 4.2, reviewCount: 120, price: { amount: 8800, currency: "JPY" }, priceBasis: "reference-minimum", availability: "unknown" }]);
    expect(requestedHeaders.accessKey).toBe("secret");
    expect(requestedUrl).toContain("applicationId=app");
    expect(requestedUrl).toContain("keyword=%E5%87%BA%E9%9B%B2%E5%B8%82");
    expect(requestedUrl).toContain("datumType=1");
    expect(requestedUrl).toContain("responseType=large");
  });

  it("Provider障害を内部情報のないエラーへ変換する", async () => {
    const provider = new HttpAccommodationProvider({ async fetch() { throw new Error("secret upstream detail"); } }, { async load() { return { applicationId: "app", accessKey: "secret", hotelSearchUrl: "https://provider.example/search" }; } });
    await expect(provider.search({ destination: "出雲市", checkInDate: "2026-08-17", checkOutDate: "2026-08-18", adults: 1, limit: 3 })).rejects.toThrow("宿泊提供者の検索を利用できません");
  });

  it("日付と人数を使って候補施設の空室を一括確認する", async () => {
    const requestedUrls: string[] = [];
    const provider = new HttpAccommodationProvider({
      async fetch(url) {
        requestedUrls.push(url);
        if (url.includes("/vacant")) {
          return { ok: true, async json() { return { hotels: [[{ hotelBasicInfo: {
            hotelNo: 42, hotelName: "空室のある宿", latitude: 35.36, longitude: 132.75,
            hotelMinCharge: 12_000,
          } }]] }; } };
        }
        return { ok: true, async json() { return { hotels: [[{ hotelBasicInfo: {
          hotelNo: 42, hotelName: "空室のある宿", latitude: 35.36, longitude: 132.75,
        } }]] }; } };
      },
    }, { async load() { return {
      applicationId: "app", accessKey: "secret",
      hotelSearchUrl: "https://provider.example/search",
      vacantHotelSearchUrl: "https://provider.example/vacant",
    }; } });

    const results = await provider.search({
      destination: "出雲市", checkInDate: "2026-09-01", checkOutDate: "2026-09-02",
      adults: 2, limit: 3,
    });

    expect(results[0]).toMatchObject({
      providerItemId: "42",
      availability: "available",
      price: { amount: 12_000, currency: "JPY" },
      priceBasis: "selected-dates",
    });
    expect(requestedUrls[1]).toContain("hotelNo=42");
    expect(requestedUrls[1]).toContain("checkinDate=2026-09-01");
    expect(requestedUrls[1]).toContain("checkoutDate=2026-09-02");
    expect(requestedUrls[1]).toContain("adultNum=2");
  });
});
