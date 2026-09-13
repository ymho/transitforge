import { it, expect } from "vitest";
import { parseProviderMoney } from "./provider-money";
it.each([["123.45", "EUR", 12345], ["123", "JPY", 123], ["12.345", "KWD", 12345], ["12.3", "EUR", 1230],
  ["0.001", "KWD", 1], ["90071992547409.91", "EUR", Number.MAX_SAFE_INTEGER]])("parses exact decimal %s %s", (text, currency, amount) => {
  expect(parseProviderMoney(text, currency)).toEqual({ amountMinor: amount, currency });
});
it.each(["12.345", "1e3", "NaN", "Infinity", "-1", "", " 1", "1.", ".1", "+1", "01", "1,000", "90071992547409.92", NaN, Infinity, 12.34, null])("rejects decimal %s without rounding", (text) => {
  expect(() => parseProviderMoney(text, "EUR")).toThrow();
});
it("rejects decimal yen and unsupported currency", () => {
  expect(() => parseProviderMoney("1.0", "JPY")).toThrow();
  expect(() => parseProviderMoney("1", "ZZZ")).toThrow();
});
