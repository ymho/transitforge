import { validateMoney, validatePriceObservation, type Money, type PriceObservation } from "@raiquora/trip/money";

/** Legacy storage is integer yen. No observation timestamp can be inferred here. */
export function legacyYenMoney(value: { amount: number; currency: "JPY" }): Money {
  if (!value || value.currency !== "JPY") throw new Error("Not legacy JPY");
  const result: Money = { amountMinor: value.amount, currency: "JPY" };
  validateMoney(result); return result;
}
/** Compatibility projection only; foreign currencies are never relabelled as yen. */
export function legacyAccommodationPrice(observation: PriceObservation | undefined): { amount: number; currency: "JPY"; basis: "reference-minimum" | "selected-dates" } | undefined {
  if (!observation) return undefined;
  validatePriceObservation(observation);
  if (observation.price.currency !== "JPY" || observation.basis === undefined) return undefined;
  return { amount: observation.price.amountMinor, currency: "JPY", basis: observation.basis };
}
