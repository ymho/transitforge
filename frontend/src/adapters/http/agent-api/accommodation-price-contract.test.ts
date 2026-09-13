import { it, expect } from "vitest";
import { isAccommodationSearchResponse } from "./bedrock-agent-validation";
const offering = { kind: "accommodation", provider: "fixture", providerItemId: "hotel", name: "宿", checkInDate: "2026-09-22", checkOutDate: "2026-09-23" };
it("accepts observed original currencies and missing prices, rejects legacy/raw/invalid prices", () => {
  const valid = { price: { amountMinor: 12345, currency: "EUR" }, observedAt: "2026-09-12T00:00:00Z", basis: "selected-dates" };
  for (const price of [undefined, valid, { ...valid, price: { currency: "KWD", amountMinor: 12345 } }])
    expect(isAccommodationSearchResponse({ accommodations: [{ ...offering, price }] })).toBe(true);
  for (const price of [{ amount: 12000, currency: "JPY" }, { ...valid, raw: {} }, { ...valid, observedAt: undefined },
    { ...valid, price: { amountMinor: 12.3, currency: "EUR" } }, { ...valid, price: { amountMinor: 1, currency: "ZZZ" } }])
    expect(isAccommodationSearchResponse({ accommodations: [{ ...offering, price }] })).toBe(false);
  expect(isAccommodationSearchResponse({ accommodations: [{ ...offering, price: valid, priceBasis: "selected-dates" }] })).toBe(false);
});
