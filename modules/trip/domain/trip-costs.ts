import { addMoney, validateMoney, type Money } from "./money";
import { exactKeys, validInstant } from "./snapshot-validation";
import { costInputFingerprint, summarizeCostLines, validateCostLine, type CostLine } from "./cost-lines";

export const costCategories = ["transport", "accommodation", "sightseeing", "food"] as const;
export type CostCategory = typeof costCategories[number];
export const costCategoryLabels: Record<CostCategory, string> = { transport: "交通", accommodation: "宿泊", sightseeing: "観光", food: "食事" };
/** Stable category IDs. Amounts cover all travelers; absence means unknown, not zero. */
export interface CostForecastItem { readonly category: CostCategory; readonly amount?: Money; readonly explanation: string; readonly assumptions: readonly string[]; }
export interface TripCostForecast { readonly tripId: string; readonly baseRevision: number; readonly generatedAt: string; readonly items: readonly CostForecastItem[]; }
export interface TripCosts { readonly forecast: TripCostForecast; readonly overrides: Partial<Record<CostCategory, Money>>; readonly stale: boolean; readonly lines?: readonly CostLine[]; }
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
  exactKeys(value, ["forecast", "overrides", "stale", "lines"]); validateCostForecast(value.forecast);
  if (value.forecast.tripId !== tripId || value.forecast.baseRevision > revision || typeof value.stale !== "boolean") throw new Error("Wrong cost basis");
  exactKeys(value.overrides, costCategories);
  for (const amount of Object.values(value.overrides)) validateMoney(amount!);
  if (value.lines && !value.lines.length) throw new Error("Detailed cost lines cannot be empty");
  value.lines?.forEach(validateCostLine);
  if (value.lines) summarizeCostLines(value.lines, value.forecast.generatedAt);
  summarizeTripCosts(value); // Reject unsafe aggregate overflow before any write.
}

/** Compatibility projection. It never invents per-day/person/room detail for legacy totals. */
export function forecastAsCostLines(forecast: TripCostForecast): readonly CostLine[] {
  validateCostForecast(forecast);
  return forecast.items.map((item): CostLine => ({ id: `forecast:${item.category}`, category: item.category, kind: "forecast",
    basis: { scope: "whole-trip", dimensions: [] }, amountRole: "total", quantities: [], targetRefs: {},
    coverage: item.amount ? "complete" : "unknown", ...(item.amount ? { amount: item.amount } : {}), included: [], excluded: [],
    assumptions: item.assumptions, inputFingerprint: costInputFingerprint({ tripId: forecast.tripId, baseRevision: forecast.baseRevision, category: item.category }) }));
}
export function summarizeTripCosts(value: TripCosts, evaluatedAt: string = value.forecast.generatedAt) {
  const legacyTotals = new Map<string, Money>(); let legacyUnknownCount = 0;
  const items = value.forecast.items.map(item => {
    const override = value.overrides[item.category], amount = override ?? item.amount;
    if (amount) legacyTotals.set(amount.currency, addMoney(legacyTotals.get(amount.currency) ?? { currency: amount.currency, amountMinor: 0 }, amount));
    else legacyUnknownCount++;
    return { ...item, displayedAmount: amount, userEdited: override !== undefined };
  });
  const lineSummary = value.lines ? summarizeCostLines(value.lines, evaluatedAt) : undefined;
  const unknownCount = lineSummary ? lineSummary.unknownLineIds.length + lineSummary.staleLineIds.length : legacyUnknownCount;
  return { items, totals: lineSummary?.totals ?? [...legacyTotals.values()], unknownCount,
    partial: lineSummary ? lineSummary.coverage !== "complete" : legacyUnknownCount > 0,
    authoritativeSource: lineSummary ? "cost-lines" as const : "legacy-forecast" as const, ...(lineSummary ? { lineSummary } : {}) };
}
