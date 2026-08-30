import { describe, expect, it, vi } from "vitest";
import { createRestaurantSearchOperation } from "./restaurant-search.js";

describe("restaurant_search operation", () => {
  it("許可した旅行向け設備条件だけをProviderへ渡す", async () => {
    const search = vi.fn(async () => ({ status: "available" as const, freshness: "fresh" as const, evidence: [], data: { area: "出雲市", restaurants: [] } }));
    const operation = createRestaurantSearchOperation({ search });

    await operation({
      area: "出雲市",
      requirements: { childFriendly: true, nonSmoking: true, unknown: true, parking: false },
    }, { requestId: "test" });

    expect(search).toHaveBeenCalledWith({
      area: "出雲市",
      requirements: { childFriendly: true, nonSmoking: true },
    });
  });
});
