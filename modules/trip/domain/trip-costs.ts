import { addMoney, validateMoney, type Money } from "./money";
import { exactKeys, validInstant } from "./snapshot-validation";

export const costCategories = ["transport", "accommodation", "sightseeing", "food"] as const;
export type CostCategory = typeof costCategories[number];
export const costCategoryLabels: Record<CostCategory, string> = { transport: "交通", accommodation: "宿泊", sightseeing: "観光", food: "食事" };
/** Stable category IDs. Amounts cover all travelers; absence means unknown, not zero. */
export interface CostForecastItem { readonly category: CostCategory; readonly amount?: Money; readonly explanation: string; readonly assumptions: readonly string[]; }
export interface TripCostForecast { readonly tripId: string; readonly baseRevision: number; readonly generatedAt: string; readonly items: readonly CostForecastItem[]; }
export interface TripCosts { readonly forecast: TripCostForecast; readonly overrides: Partial<Record<CostCategory, Money>>; readonly stale: boolean; }
export function validateCostForecast(value: TripCostForecast): void {
  exactKeys(value, ["tripId", "baseRevision", "generatedAt", "items"]);
  if (typeof value.tripId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value.tripId) ||
      !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0 || !validInstant(value.generatedAt) ||
      !Array.isArray(value.items) || value.items.length !== costCategories.length || new Set(value.items.map(i => i.category)).size !== costCategories.length) throw new Error("Invalid cost forecast");
  for (const item of value.items) {
    exactKeys(item, ["category", "amount", "explanation", "assumptions"]);
    if (!costCategories.includes(item.category) || typeof item.explanation !== "string" || !item.explanation.trim() || item.explanation.length > 240 ||
        !Array.isArray(item.assumptions) || item.assumptions.length > 6 || item.assumptions.some((a: unknown) => typeof a !== "string" || !a.trim() || a.length > 240)) throw new Error("Invalid cost item");
    if (item.amount !== undefined) validateMoney(item.amount);
  }
}
export function validateTripCosts(value: TripCosts, tripId: string, revision: number): void {
  exactKeys(value, ["forecast", "overrides", "stale"]); validateCostForecast(value.forecast);
  if (value.forecast.tripId !== tripId || value.forecast.baseRevision > revision || typeof value.stale !== "boolean") throw new Error("Wrong cost basis");
  exactKeys(value.overrides, costCategories);
  for (const amount of Object.values(value.overrides)) validateMoney(amount!);
  summarizeTripCosts(value); // Reject unsafe aggregate overflow before any write.
}
export function summarizeTripCosts(value: TripCosts) {
  const totals = new Map<string, Money>(); let unknownCount = 0;
  const items = value.forecast.items.map(item => {
    const override = value.overrides[item.category], amount = override ?? item.amount;
    if (amount) totals.set(amount.currency, addMoney(totals.get(amount.currency) ?? { currency: amount.currency, amountMinor: 0 }, amount));
    else unknownCount++;
    return { ...item, displayedAmount: amount, userEdited: override !== undefined };
  });
  return { items, totals: [...totals.values()], unknownCount, partial: unknownCount > 0 };
}
