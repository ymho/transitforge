import { describe, expect, it } from "vitest";
import { allocateCostLine, costInputFingerprint, summarizeCostLines, type CostLine } from "./cost-lines";

const roomNights: CostLine = { id: "hotel-1", category: "accommodation", kind: "provider_observed",
  basis: { scope: "whole-trip", dimensions: ["room", "night"] }, amount: { currency: "JPY", amountMinor: 10_001 }, amountRole: "unit",
  quantities: [{ dimension: "room", count: 1 }, { dimension: "night", count: 3 }], targetRefs: { itemIds: ["stay-1"], logicalDayIds: ["day-1", "day-2", "day-3"] },
  coverage: "complete", included: ["room"], excluded: ["city tax"], assumptions: [], evidenceRefs: ["price-1"], inputFingerprint: "fp-1",
  observedAt: "2026-09-22T00:00:00Z", validUntil: "2026-10-01T00:00:00Z" };

describe("cost lines", () => {
  it("preserves room × night semantics and never double-counts duplicate references", () => {
    const result = summarizeCostLines([roomNights, structuredClone(roomNights)], "2026-09-23T00:00:00Z");
    expect(result.totals).toEqual([{ currency: "JPY", amountMinor: 30_003 }]);
    expect(result.lineTotals).toHaveLength(1);
  });
  it("allocates remainders exactly without turning allocations into source charges", () => {
    const total = { ...roomNights, amountRole: "total" as const, quantities: [], amount: { currency: "JPY" as const, amountMinor: 10_001 } };
    const allocations = allocateCostLine(total, { "day-1": 1, "day-2": 1, "day-3": 1 });
    expect(allocations.reduce((sum, item) => sum + item.amount.amountMinor, 0)).toBe(10_001);
    expect(summarizeCostLines([total], "2026-09-23T00:00:00Z").totals[0]?.amountMinor).toBe(10_001);
  });
  it("does not promote partial, stale or mixed-currency input into a complete budget", () => {
    const partial = { ...roomNights, id: "unknown-tax", coverage: "partial" as const,
      quantities: [{ dimension: "room" as const, count: 1 }, { dimension: "night" as const, unknownReason: "泊数未確定" }] };
    const eur = { ...roomNights, id: "pass", category: "transport" as const, basis: { scope: "pass" as const, dimensions: [] },
      amountRole: "total" as const, quantities: [], amount: { currency: "EUR" as const, amountMinor: 5_000 } };
    const result = summarizeCostLines([roomNights, partial, eur], "2026-09-23T00:00:00Z");
    expect(result.coverage).toBe("partial"); expect(result.currencies).toEqual(["EUR", "JPY"]); expect(result.unknownLineIds).toEqual(["unknown-tax"]);
  });
  it("rejects conflicting duplicate IDs and fingerprints keys deterministically", () => {
    expect(() => summarizeCostLines([roomNights, { ...roomNights, amount: { currency: "JPY", amountMinor: 1 } }], "2026-09-23T00:00:00Z")).toThrow(/Conflicting/);
    expect(costInputFingerprint({ b: 2, a: 1 })).toBe(costInputFingerprint({ a: 1, b: 2 }));
  });
});
