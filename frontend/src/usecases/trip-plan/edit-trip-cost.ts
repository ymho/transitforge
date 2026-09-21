import { currencyMinorUnits, isCurrencyCode, validateMoney, type Money } from "@raiquora/trip/money";
/** Parse decimal input exactly; never sanitize a negative amount into a positive one. */
export function parseCostInput(text: string, currency: string): Money {
  if (!isCurrencyCode(currency)) throw new Error("通貨を確認してください。");
  const input = text.trim(), digits = currencyMinorUnits[currency];
  if (!/^\d+(?:\.\d+)?$/u.test(input) || input.length > 24) throw new Error("金額は非負の数字で入力してください。");
  const [major, minor = ""] = input.split(".");
  if (minor.length > digits) throw new Error(`${currency}の小数は${digits}桁までです。`);
  const integer = BigInt(major! + minor.padEnd(digits, "0"));
  if (integer > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("金額が大きすぎます。");
  const amount = { currency, amountMinor: Number(integer) }; validateMoney(amount); return amount;
}
