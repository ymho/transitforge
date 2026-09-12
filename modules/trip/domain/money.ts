import { exactKeys, validInstant } from "./snapshot-validation";

/** Supported subset of SIX ISO 4217 List One, published 2026-01-01.
 * https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml
 * Deliberately reject unsupported currencies (including XXX/XTS); never guess minor units.
 */
export const currencyMinorUnits = Object.freeze({ JPY: 0, EUR: 2, CHF: 2, USD: 2, GBP: 2, KWD: 3 } as const);
export type CurrencyCode = keyof typeof currencyMinorUnits;
export interface Money { readonly amountMinor: number; readonly currency: CurrencyCode; }
export interface PriceObservation {
  readonly price: Money;
  readonly observedAt: string;
  readonly basis?: "reference-minimum" | "selected-dates";
}
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && Object.hasOwn(currencyMinorUnits, value);
}
export function validateMoney(value: Money): void {
  exactKeys(value, ["amountMinor", "currency"]);
  if (!isCurrencyCode(value.currency) || !Number.isSafeInteger(value.amountMinor) || value.amountMinor < 0) throw new Error("Invalid Money");
}
export function validatePriceObservation(value: PriceObservation): void {
  exactKeys(value, ["price", "observedAt", "basis"]);
  validateMoney(value.price);
  if (!validInstant(value.observedAt) || value.basis !== undefined && !["reference-minimum", "selected-dates"].includes(value.basis)) throw new Error("Invalid price observation");
}
export function isPriceObservation(value: unknown): value is PriceObservation {
  try { validatePriceObservation(value as PriceObservation); return true; } catch { return false; }
}
export function copyPriceObservation(value: PriceObservation): PriceObservation {
  validatePriceObservation(value);
  return { price: { amountMinor: value.price.amountMinor, currency: value.price.currency }, observedAt: value.observedAt,
    ...(value.basis === undefined ? {} : { basis: value.basis }) };
}
function sameCurrency(left: Money, right: Money): void {
  validateMoney(left); validateMoney(right);
  if (left.currency !== right.currency) throw new Error("Currency mismatch; FX is not implicit");
}
export function addMoney(left: Money, right: Money): Money {
  sameCurrency(left, right);
  const result = { currency: left.currency, amountMinor: left.amountMinor + right.amountMinor };
  validateMoney(result); return result;
}
export function compareMoney(left: Money, right: Money): -1 | 0 | 1 {
  sameCurrency(left, right);
  return left.amountMinor === right.amountMinor ? 0 : left.amountMinor < right.amountMinor ? -1 : 1;
}
/** Exact decimal display, without division/multiplication in binary floating point. */
export function formatMoney(value: Money): string {
  validateMoney(value);
  const digits = currencyMinorUnits[value.currency];
  const text = String(value.amountMinor).padStart(digits + 1, "0");
  const major = (digits ? text.slice(0, -digits) : text).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value.currency} ${major}${digits ? `.${text.slice(-digits)}` : ""}`;
}
