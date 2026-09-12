import { currencyMinorUnits, isCurrencyCode, validateMoney, type Money } from "@raiquora/trip/money";

/** Provider decimal strings only: no exponent, whitespace, rounding or binary decimal arithmetic. */
export function parseProviderMoney(value: unknown, currency: unknown): Money {
  if (!isCurrencyCode(currency) || typeof value !== "string" || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value) || value.length > 64) throw new Error("Invalid provider decimal price");
  const [major, minor = ""] = value.split(".");
  const digits = currencyMinorUnits[currency];
  if (minor.length > digits) throw new Error("Excess minor units");
  const amount = BigInt(major! + minor.padEnd(digits, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Money overflow");
  const result = { amountMinor: Number(amount), currency };
  validateMoney(result); return result;
}
