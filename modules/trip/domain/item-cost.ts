import type { Trip, ItineraryItem, TripPatch } from "./trip";
import { costInputFingerprint, type CostLine } from "./cost-lines";
import { validateMoney, type Money } from "./money";

/** Read one item's estimate. Historic category forecasts are never distributed to items. */
export function itemCost(trip: Trip, item: ItineraryItem): { amount: Money; source: "user" | "provider"; basis?: "reference-minimum" | "selected-dates" } | undefined {
  if (isRailItem(item)) return undefined;
  const manual = trip.costs?.lines?.find(line => line.id.startsWith("item-estimate:") && line.kind === "user_override" && line.targetRefs.itemIds?.length === 1 && line.targetRefs.itemIds[0] === item.id);
  if (manual?.amount) return { amount: manual.amount, source: "user" };
  if (item.type === "stay" && item.selection.status === "selected") {
    const price = item.selection.accommodation.observedPrice;
    if (price) return { amount: price.price, source: "provider", ...(price.basis ? { basis: price.basis } : {}) };
  }
  return undefined;
}

export function isRailItem(item: ItineraryItem): boolean {
  return item.type === "transport" && item.detail.mode === "rail";
}

/** One user-entered total per item, saved by the normal Trip proposal/CAS writer. */
export function editItemCost(trip: Trip, itemId: string, amount?: Money): TripPatch {
  const item = trip.items.find(value => value.id === itemId);
  if (!item || isRailItem(item)) throw new Error("費用を入力する予定を確認してください。");
  if (amount) validateMoney(amount);
  const id = itemCostId(itemId);
  const lines = (trip.costs?.lines ?? []).filter(line => !(line.id.startsWith("item-estimate:") && line.targetRefs.itemIds?.includes(itemId)));
  if (amount) {
    if (lines.some(line => line.id === id)) throw new Error("Cost identifier conflict");
    const line: CostLine = { id, category: item.type === "stay" ? "accommodation" : item.type === "transport" ? "transport" : item.category === "food" ? "food" : "sightseeing",
      kind: "user_override", amount, amountRole: "total", basis: { scope: "shared-resource", dimensions: [] }, quantities: [],
      targetRefs: { itemIds: [itemId] }, coverage: "complete", included: [], excluded: [], assumptions: [],
      inputFingerprint: costInputFingerprint({ itemId, amount }) };
    lines.push(line);
  }
  return { type: "cost_lines", lines };
}

function itemCostId(itemId: string): string { return `item-estimate:${costInputFingerprint({ itemId })}`; }
