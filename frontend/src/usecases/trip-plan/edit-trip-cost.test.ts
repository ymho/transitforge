import { expect, it } from "vitest";
import { parseCostInput } from "./edit-trip-cost";
it("parses money exactly at currency precision, retaining zero and rejecting malformed values", () => {
  expect(parseCostInput("0", "JPY")).toEqual({ currency: "JPY", amountMinor: 0 });
  expect(parseCostInput("12.34", "EUR").amountMinor).toBe(1234);
  expect(parseCostInput("1.005", "KWD").amountMinor).toBe(1005);
  expect(parseCostInput("90071992547409.91", "EUR").amountMinor).toBe(Number.MAX_SAFE_INTEGER);
  for (const value of ["", "-100", "1e3", "1,000", "1.1", "NaN", "9007199254740992"]) expect(() => parseCostInput(value, "JPY")).toThrow();
  expect(() => parseCostInput("1.001", "EUR")).toThrow(); expect(() => parseCostInput("1", "XXX")).toThrow();
});
