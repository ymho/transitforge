import { expect, it } from "vitest";
import { applyTripProposal, createTrip, type ItineraryItem } from "./trip";
import { editItemCost, itemCost } from "./item-cost";
import { costForecast } from "./trip-costs.fixture";
const food: ItineraryItem = { id: "食事 / 1", type: "activity", category: "food", title: "昼食", schedule: { type: "unscheduled" } };
const trip = () => createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-10-01T00:00:00Z", [food]);
const save = (base: ReturnType<typeof trip>, amount?: number) => applyTripProposal(base, { tripId: base.id, baseRevision: base.revision, summary: "費用", patches: [editItemCost(base, food.id, amount === undefined ? undefined : { currency: "JPY", amountMinor: amount })] });
it("saves one item's estimate without a forecast, roundtrips zero, and clears it", () => {
  const saved = save(trip(), 0);
  expect(saved.costs?.forecast).toBeUndefined();
  expect(itemCost(JSON.parse(JSON.stringify(saved)), food)).toEqual({ amount: { currency: "JPY", amountMinor: 0 }, source: "user" });
  expect(itemCost(save(saved), food)).toBeUndefined();
  expect(() => save(trip(), -1)).toThrow();
});
it("does not distribute historic category estimates to individual items or invent rail costs", () => {
  const base = trip();
  const historic = { ...base, costs: { forecast: costForecast(base.id), overrides: {}, stale: false } };
  expect(itemCost(historic, food)).toBeUndefined();
  const rail: ItineraryItem = { id: "rail", type: "transport", title: "電車", schedule: { type: "unscheduled" }, detail: { status: "unresolved", mode: "rail" } };
  expect(itemCost(base, rail)).toBeUndefined();
  expect(() => editItemCost({ ...base, items: [rail] }, rail.id, { currency: "JPY", amountMinor: 100 })).toThrow();
});
it("preserves other items when editing or clearing one estimate", () => {
  const other = { ...food, id: "other" }, base = { ...trip(), items: [food, other] };
  const first = save(base, 1500);
  const second = applyTripProposal(first, { tripId: first.id, baseRevision: first.revision, summary: "費用", patches: [editItemCost(first, other.id, { currency: "EUR", amountMinor: 2500 })] });
  const cleared = save(second);
  expect(itemCost(cleared, food)).toBeUndefined();
  expect(itemCost(cleared, other)?.amount).toEqual({ currency: "EUR", amountMinor: 2500 });
});

it("removes an item's estimate with its item and rejects nonexistent targets", () => {
  const saved = save(trip(), 1200);
  const removed = applyTripProposal(saved, { tripId: saved.id, baseRevision: saved.revision, summary: "削除", patches: [{ type: "remove", itemId: food.id }] });
  expect(removed.costs?.lines).toEqual([]);
  const line = saved.costs!.lines![0]!;
  expect(() => applyTripProposal(trip(), { tripId: saved.id, baseRevision: 0, summary: "費用", patches: [{ type: "cost_lines", lines: [{ ...line, targetRefs: { itemIds: ["missing"] } }] }] })).toThrow();
});
