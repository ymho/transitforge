import { describe, expect, it } from "vitest";

import { createAccommodationOffering } from "./travel-provider.js";

describe("createAccommodationOffering", () => {
  it("Provider結果を価格推測なしで共通契約へ正規化する", () => {
    expect(createAccommodationOffering(" travel-provider ", {
      destination: "出雲市", checkInDate: "2026-08-17", checkOutDate: "2026-08-18", adults: 1, limit: 3,
    }, {
      providerItemId: "42", name: " 駅前の宿 ", bookingUrl: "https://booking.example/42",
      areaName: "出雲市", imageUrl: "https://images.example/42.jpg",
    })).toEqual({
      kind: "accommodation", provider: "travel-provider", providerItemId: "42", name: "駅前の宿",
      checkInDate: "2026-08-17", checkOutDate: "2026-08-18", bookingUrl: "https://booking.example/42",
      areaName: "出雲市", imageUrl: "https://images.example/42.jpg",
    });
  });

  it("安全でない画像URLを除外する", () => {
    const offering = createAccommodationOffering("travel-provider", {
      destination: "出雲市", checkInDate: "2026-08-17", checkOutDate: "2026-08-18", adults: 1, limit: 3,
    }, { providerItemId: "42", name: "駅前の宿", imageUrl: "http://images.example/42.jpg" });
    expect(offering.imageUrl).toBeUndefined();
    expect(offering.price).toBeUndefined();
  });
});
