import { describe, expect, it, vi } from "vitest";
import { HotPepperRestaurantProvider } from "./hot-pepper-restaurant-provider.js";

describe("HotPepperRestaurantProvider", () => {
  it("飲食店候補の既知情報だけを正規化する", async () => {
    const fetch = vi.fn(async (_input: string) => Response.json({ results: { shop: [{ id: "J1", name: " 出雲そば ", address: "島根県出雲市", station_name: "出雲市", lat: 35.3, lng: 132.7, genre: { name: "和食" }, budget: { name: "2001～3000円", average: "2500円" }, open: "11:00～20:00", close: "水曜", access: "出雲市駅徒歩5分", child: "お子様連れ歓迎", parking: "なし", photo: { pc: { l: "https://example.com/shop.jpg" } }, urls: { pc: "https://example.com/shop" } }] } }));
    const credentials = { load: vi.fn(async () => ({ apiKey: "secret" })) };
    const result = await new HotPepperRestaurantProvider({ fetch }, credentials, () => new Date("2026-08-30T00:00:00Z")).search({ area: "出雲市", keyword: "そば", limit: 3 });
    expect(result.data?.restaurants[0]).toMatchObject({ name: "出雲そば", genre: "和食", budget: "2001~3000円", averageBudget: "2500円", regularHoliday: "水曜", stationName: "出雲市", features: ["子ども連れ"], latitude: 35.3 });
    expect(result.evidence[0]?.attribution).toContain("ホットペッパー");
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain("secret=");
  });

  it("キー未設定を明示する", async () => {
    const provider = new HotPepperRestaurantProvider({ fetch: vi.fn() }, { load: async () => undefined });
    const result = await provider.search({ area: "京都" });
    expect(result.failure).toMatchObject({ code: "unauthorized", retryable: false });
  });

  it("確認済み地点の周辺検索では地域名を必須キーワードにしない", async () => {
    const fetch = vi.fn(async (_input: string) => Response.json({ results: { shop: [] } }));
    const provider = new HotPepperRestaurantProvider(
      { fetch },
      { load: async () => ({ apiKey: "secret" }) },
    );
    await provider.search({ area: "出雲大社", latitude: 35.4, longitude: 132.7, range: 2, requirements: { childFriendly: true, nonSmoking: true } });
    const requestUrl = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("lat")).toBe("35.4");
    expect(requestUrl.searchParams.get("range")).toBe("2");
    expect(requestUrl.searchParams.get("child")).toBe("1");
    expect(requestUrl.searchParams.get("non_smoking")).toBe("1");
    expect(requestUrl.searchParams.get("datum")).toBe("world");
    expect(requestUrl.searchParams.has("keyword")).toBe(false);
  });

  it("HTTP 200のProvider認証エラーを候補0件にしない", async () => {
    const provider = new HotPepperRestaurantProvider(
      { fetch: async () => Response.json({ results: { error: [{ code: "2000", message: "APIキーまたはIPアドレスの認証エラー" }] } }) },
      { load: async () => ({ apiKey: "secret" }) },
    );

    const result = await provider.search({ area: "京都" });
    expect(result.status).toBe("unavailable");
    expect(result.data).toBeUndefined();
    expect(result.failure).toMatchObject({ code: "unauthorized", retryable: false });
  });

  it("HTTP 200のパラメータエラーを明示する", async () => {
    const provider = new HotPepperRestaurantProvider(
      { fetch: async () => Response.json({ results: { error: { code: "3000", message: "検索条件が不正です" } } }) },
      { load: async () => ({ apiKey: "secret" }) },
    );

    const result = await provider.search({ area: "京都" });
    expect(result.status).toBe("unknown");
    expect(result.failure).toMatchObject({ code: "invalid_request", retryable: false });
  });
});
