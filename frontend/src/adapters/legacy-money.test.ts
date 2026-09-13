import { it, expect } from "vitest";
import { legacyYenMoney, legacyAccommodationPrice } from "./legacy-money";
it("converts legacy integer yen purely without inventing an observation timestamp", () => {
  const input = { amount: 12000, currency: "JPY" as const }, before = structuredClone(input);
  expect(legacyYenMoney(input)).toEqual({ amountMinor: 12000, currency: "JPY" });
  expect(legacyYenMoney(input)).toEqual(legacyYenMoney(input)); expect(input).toEqual(before);
  expect(legacyYenMoney(input)).not.toHaveProperty("observedAt");
  for (const amount of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => legacyYenMoney({ ...input, amount })).toThrow();
});
it("keeps the legacy writer yen-only without inventing FX or free prices", () => {
  const observation = { price: { amountMinor: 12000, currency: "EUR" as const }, observedAt: "2026-09-12T00:00:00Z" };
  expect(legacyAccommodationPrice(observation)).toBeUndefined(); expect(legacyAccommodationPrice(undefined)).toBeUndefined();
  expect(legacyAccommodationPrice({ ...observation, price: { amountMinor: 12000, currency: "JPY" } })).toBeUndefined();
  expect(legacyAccommodationPrice({ ...observation, price: { amountMinor: 12000, currency: "JPY" }, basis: "selected-dates" })).toEqual({ amount: 12000, currency: "JPY", basis: "selected-dates" });
});
