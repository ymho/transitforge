import { describe, expect, it } from "vitest";

import { HttpAccommodationProvider } from "./http-accommodation-provider.js";

describe("HttpAccommodationProvider", () => {
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1200"])("omits unsafe/non-integer numeric provider price %s without losing lodging", async (hotelMinCharge) => {
    const provider = new HttpAccommodationProvider({ async fetch() { return { ok: true, async json() { return { hotels: [[{ hotelBasicInfo: { hotelNo: 1, hotelName: "宿", hotelMinCharge } }]] }; } }; } },
      { async load() { return { applicationId: "fixture", accessKey: "fixture", hotelSearchUrl: "https://example.com/search" }; } });
    const result = await provider.search({ destination: "京都", checkInDate: "2026-09-22", checkOutDate: "2026-09-23", adults: 1, limit: 1 });
    expect(result).toHaveLength(1); expect(result[0]!.price).toBeUndefined();
  });
  it("Provider fixtureを地図表示と参考価格を含む共通契約へ変換する", async () => {
    let requestedUrl = "";
    let requestedHeaders: Record<string, string> = {};
    const provider = new HttpAccommodationProvider({
      async fetch(url, init) {
        requestedUrl = url; requestedHeaders = init.headers;
        return { ok: true, async json() { return { hotels: [[{ hotelBasicInfo: { hotelNo: 42, hotelName: "駅前の宿", hotelInformationUrl: "https://booking.example/42", hotelImageUrl: "https://images.example/42.jpg", address1: "島根県", address2: "出雲市駅前", latitude: 35.36, longitude: 132.75, reviewAverage: 4.2, reviewCount: 120, hotelMinCharge: 8800 } }]] }; } };
      },
    }, { async load() { return { applicationId: "app", accessKey: "secret", hotelSearchUrl: "https://provider.example/search" }; } }, () => "2026-09-12T08:00:00Z");
    const results = await provider.search({ destination: "出雲市", checkInDate: "2026-08-17", checkOutDate: "2026-08-18", adults: 1, limit: 3 });
    expect(results).toEqual([{ kind: "accommodation", provider: "rakuten-travel", providerItemId: "42", name: "駅前の宿", checkInDate: "2026-08-17", checkOutDate: "2026-08-18", bookingUrl: "https://booking.example/42", areaName: "島根県", imageUrl: "https://images.example/42.jpg", address: "島根県出雲市駅前", latitude: 35.36, longitude: 132.75, reviewAverage: 4.2, reviewCount: 120, price: { price: { amountMinor: 8800, currency: "JPY" }, observedAt: "2026-09-12T08:00:00Z", basis: "reference-minimum" }, availability: "unknown" }]);
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
      price: { price: { amountMinor: 12_000, currency: "JPY" }, observedAt: expect.any(String), basis: "reference-minimum" },
    });
    expect(requestedUrls[1]).toContain("hotelNo=42");
    expect(requestedUrls[1]).toContain("checkinDate=2026-09-01");
    expect(requestedUrls[1]).toContain("checkoutDate=2026-09-02");
    expect(requestedUrls[1]).toContain("adultNum=2");
  });
});

it("keeps unconfirmed alternatives when only one of three hotels has confirmed vacancy", async () => {
  const provider = new HttpAccommodationProvider({ async fetch(url) {
    const ids = url.includes("/vacant") ? [2] : [1, 2, 3];
    return { ok: true, async json() { return { hotels: ids.map(hotelNo => [{ hotelBasicInfo: { hotelNo, hotelName: `宿${hotelNo}`, hotelMinCharge: 5100 } }]) }; } };
  } }, { async load() { return { applicationId: "fixture", accessKey: "fixture", hotelSearchUrl: "https://example.com/search", vacantHotelSearchUrl: "https://example.com/vacant" }; } });
  const result = await provider.search({ destination: "出雲大社", checkInDate: "2026-10-04", checkOutDate: "2026-10-05", adults: 1, limit: 3 });
  expect(result.map(hotel => [hotel.providerItemId, hotel.availability])).toEqual([["2", "available"], ["1", "unknown"], ["3", "unknown"]]);
  expect(result.every(hotel => hotel.price?.basis === "reference-minimum")).toBe(true);
});


it.each(["https://hotel.travel.rakuten.co.jp/hotelinfo/plan/42?f_teikei=fixture&f_nen1=2025", "https://travel.rakuten.co.jp/HOTEL/42/42.html"])("passes dates and adults to Rakuten booking URL %s", async (bookingUrl) => {
  const provider = new HttpAccommodationProvider({ async fetch() { return { ok: true, async json() { return { hotels: [[{ hotelBasicInfo: { hotelNo: 42, hotelName: "宿", planListUrl: bookingUrl, hotelInformationUrl: "https://travel.rakuten.co.jp/HOTEL/42/42.html" } }]] }; } }; } },
    { async load() { return { applicationId: "fixture", accessKey: "fixture", hotelSearchUrl: "https://example.com/search" }; } });
  const [hotel] = await provider.search({ destination: "京都", checkInDate: "2026-12-31", checkOutDate: "2027-01-02", adults: 2, limit: 1 });
  const url = new URL(hotel!.bookingUrl!);
  expect(url.pathname).toBe("/hotelinfo/plan/42");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ f_nen1: "2026", f_tuki1: "12", f_hi1: "31", f_nen2: "2027", f_tuki2: "1", f_hi2: "2", f_otona_su: "2", f_heya_su: "1", f_static: "0" });
  if (bookingUrl.includes("fixture")) expect(url.searchParams.get("f_teikei")).toBe("fixture");
});

it("preserves affiliate routing and dates both destinations", async () => {
  const destination = "https://hotel.travel.rakuten.co.jp/hotelinfo/plan/42";
  const bookingUrl = `https://hb.afl.rakuten.co.jp/hgc/fixture/?pc=${encodeURIComponent(destination)}&m=${encodeURIComponent(destination)}&link_type=text`;
  const provider = new HttpAccommodationProvider({ async fetch() { return { ok: true, async json() { return { hotels: [[{ hotelBasicInfo: { hotelNo: 42, hotelName: "宿", planListUrl: bookingUrl } }]] }; } }; } },
    { async load() { return { applicationId: "fixture", accessKey: "fixture", hotelSearchUrl: "https://example.com/search" }; } });
  const [hotel] = await provider.search({ destination: "京都", checkInDate: "2026-11-01", checkOutDate: "2026-11-02", adults: 2, limit: 1 });
  const url = new URL(hotel!.bookingUrl!);
  expect(url.hostname).toBe("hb.afl.rakuten.co.jp");
  expect(url.pathname).toBe("/hgc/fixture/");
  expect(url.searchParams.get("link_type")).toBe("text");
  for (const key of ["pc", "m"]) expect(new URL(url.searchParams.get(key)!).searchParams.get("f_nen1")).toBe("2026");
});

it.each(["http-error", "network-error", "invalid-json", "empty"])("retains unknown availability after vacancy response %s", async (failure) => {
  const provider = new HttpAccommodationProvider({ async fetch(url) {
    if (url.includes("/vacant")) {
      if (failure === "network-error") throw new Error("upstream");
      return { ok: failure !== "http-error", async json() { if (failure === "invalid-json") throw new Error("invalid JSON"); return { hotels: [] }; } };
    }
    return { ok: true, async json() { return { hotels: [[{ hotelBasicInfo: { hotelNo: 42, hotelName: "宿" } }]] }; } };
  } }, { async load() { return { applicationId: "fixture", accessKey: "fixture", hotelSearchUrl: "https://example.com/search", vacantHotelSearchUrl: "https://example.com/vacant" }; } });
  const result = await provider.search({ destination: "京都", checkInDate: "2026-11-01", checkOutDate: "2026-11-02", adults: 2, limit: 1 });
  expect(result).toHaveLength(1);
  expect(result[0]!.availability).toBe("unknown");
});


it("keeps short provider features and a review example without per-hotel requests", async () => {
  let calls = 0;
  const provider = new HttpAccommodationProvider({ async fetch(url) {
    calls++;
    return { ok: true, async json() { return { hotels: [[{ hotelBasicInfo: {
      hotelNo: 42, hotelName: "宿",
      ...(url.includes("/vacant") ? {} : { hotelSpecial: "駅から徒歩5分。<br>温泉付きの宿です。", userReview: "接客が丁寧でした。" + "また利用したいです。".repeat(40) }),
    } }]] }; } };
  } }, { async load() { return { applicationId: "fixture", accessKey: "fixture", hotelSearchUrl: "https://example.com/search", vacantHotelSearchUrl: "https://example.com/vacant" }; } });
  const result = await provider.search({ destination: "京都", checkInDate: "2026-11-01", checkOutDate: "2026-11-02", adults: 2, limit: 10 });
  expect(calls).toBe(2);
  expect(result[0]).toMatchObject({ description: "駅から徒歩5分。 温泉付きの宿です。", availability: "available" });
  expect(result[0]!.reviewExcerpt!.length).toBeLessThanOrEqual(160);
  expect(result[0]!.reviewExcerpt).toMatch(/^接客が丁寧でした。/u);
  expect(result[0]!.reviewExcerpt).toMatch(/。$/u);
});
