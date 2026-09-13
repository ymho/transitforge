import { describe, it, expect } from "vitest";
import { currencyMinorUnits, validateMoney, validatePriceObservation, addMoney, compareMoney, formatMoney, type Money, type CurrencyCode } from "./money";
import { createTravelCandidate, type ExperienceOffering } from "./travel-candidate";
import { validateTripRequirement } from "./trip-requirement";
import { createTrip } from "./trip";
import { evaluateTripHardConstraints } from "./trip-constraint-evaluation";

describe("Money and observed cost", () => {
  it.each([["JPY", 0, "JPY 12,345"], ["EUR", 2, "EUR 123.45"], ["CHF", 2, "CHF 123.45"],
    ["USD", 2, "USD 123.45"], ["GBP", 2, "GBP 123.45"], ["KWD", 3, "KWD 12.345"]] as const)("supports verified metadata %s", (currency, digits, text) => {
    expect(currencyMinorUnits[currency]).toBe(digits);
    expect(formatMoney({ amountMinor: 12345, currency })).toBe(text);
  });
  it.each(["ZZZ", "jpy", "JP", "JPYY", "", "XXX", "XTS", "toString"])("rejects unsupported code %s", (currency) => {
    expect(() => validateMoney({ amountMinor: 1, currency } as Money)).toThrow();
  });
  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid amount %s", (amountMinor) => {
    expect(() => validateMoney({ amountMinor, currency: "JPY" })).toThrow();
  });
  it("rejects unknown fields at both levels and malformed observations", () => {
    expect(() => validateMoney({ amountMinor: 1, currency: "JPY", raw: {} } as Money)).toThrow();
    for (const value of [undefined, { price: { amount: 10, currency: "JPY" }, observedAt: "2026-09-12T00:00:00Z" },
      { price: { amountMinor: 10, currency: "JPY" }, observedAt: "unknown" },
      { price: { amountMinor: 10, currency: "JPY" }, observedAt: "2026-09-12T00:00:00Z", availability: "available" }]) {
      expect(() => validatePriceObservation(value as never)).toThrow();
    }
  });
  it("adds and compares only the same currency without overflow", () => {
    const a: Money = { currency: "EUR", amountMinor: 12345 }, b: Money = { currency: "EUR", amountMinor: 5 };
    expect(addMoney(a, b)).toEqual({ currency: "EUR", amountMinor: 12350 });
    expect(compareMoney(a, b)).toBe(1); expect(compareMoney(b, a)).toBe(-1); expect(compareMoney(a, a)).toBe(0);
    expect(() => addMoney(a, { ...b, currency: "JPY" })).toThrow();
    expect(() => compareMoney(a, { ...b, currency: "CHF" })).toThrow();
    expect(() => addMoney(a, { ...b, amountMinor: Number.MAX_SAFE_INTEGER })).toThrow();
    expect(a.amountMinor).toBe(12345);
  });
  it("formats zero, padded fractional units and maximum safe amounts exactly", () => {
    expect(formatMoney({ currency: "EUR", amountMinor: 1 })).toBe("EUR 0.01");
    expect(formatMoney({ currency: "CHF", amountMinor: 8900 })).toBe("CHF 89.00");
    expect(formatMoney({ currency: "KWD", amountMinor: 0 })).toBe("KWD 0.000");
    expect(formatMoney({ currency: "EUR", amountMinor: Number.MAX_SAFE_INTEGER })).toBe("EUR 90,071,992,547,409.91");
  });
  const offering = (currency: CurrencyCode, amountMinor: number): ExperienceOffering => ({ kind: "experience", provider: "fixture", providerItemId: "activity",
    name: "体験", startDate: "2026-09-22", price: { price: { currency, amountMinor }, observedAt: "2026-09-12T00:00:00Z" } });
  it.each([["JPY"], ["EUR"], ["JPY", "EUR"], ["EUR", "CHF"]] as CurrencyCode[][])("keeps currency subtotals %s", (...currencies) => {
    const experiences = currencies.map((c) => offering(c, 100));
    const summary = createTravelCandidate({ id: "candidate", experiences }).expenseSummary;
    expect(summary.totals).toHaveLength(currencies.length);
    for (const c of currencies) expect(summary.totals).toContainEqual({ currency: c, amountMinor: 100 });
    expect(summary).not.toHaveProperty("knownTotalAmount");
  });
  it("keeps unknown separate from zero and rejects aggregate overflow", () => {
    const unpriced = offering("JPY", 0); delete unpriced.price;
    expect(createTravelCandidate({ id: "c", experiences: [unpriced, offering("JPY", 0)] }).expenseSummary)
      .toEqual({ totals: [{ currency: "JPY", amountMinor: 0 }], pricedItemCount: 1, hasUnpricedItems: true, excludesRailFare: true });
    expect(() => createTravelCandidate({ id: "c", experiences: [offering("EUR", Number.MAX_SAFE_INTEGER), offering("EUR", 1)] })).toThrow();
  });
  it("validates budget limits using the same Money, not a parallel amount", () => {
    expect(() => validateTripRequirement({ type: "budget", limit: { currency: "EUR", amountMinor: 12000 }, basis: "trip" })).not.toThrow();
    expect(() => validateTripRequirement({ type: "budget", limit: { currency: "KWD", amountMinor: -1 }, basis: "per-person" })).toThrow();
    expect(() => validateTripRequirement({ type: "budget", limit: { currency: "JPY", amountMinor: 1 }, basis: "night" } as never)).toThrow();
    const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-09-12T00:00:00Z");
    const requested = { ...trip, request: { ...trip.request, constraints: [{ id: "budget", strength: "hard" as const, source: "user" as const,
      scope: { type: "trip" as const }, requirement: { type: "budget" as const, limit: { currency: "EUR" as const, amountMinor: 12000 }, basis: "trip" as const } }] } };
    expect(evaluateTripHardConstraints(requested)).toContainEqual({ constraintId: "budget", status: "unknown", reasonCode: "insufficient_planned_facts" });
  });
});
