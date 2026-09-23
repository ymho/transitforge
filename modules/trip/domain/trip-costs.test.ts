import { expect, it } from "vitest";
import { createTrip, applyTripProposal, type Trip, type TripPatch } from "./trip";
import { costForecast, costTripId } from "./trip-costs.fixture";
import { summarizeTripCosts } from "./trip-costs";
import { parsePublicCostProposal } from "./public-cost-proposal";
import { evaluateTripFeasibility } from "./trip-feasibility";
const initial = () => createTrip(costTripId, "旅行", "2026-09-20T00:00:00Z");
const apply = (trip: Trip, patches: TripPatch[]) => applyTripProposal(trip, { tripId: trip.id, baseRevision: trip.revision, summary: "費用", patches });
it("preserves originals and zero overrides across regeneration, and resets a single item explicitly", () => {
  let trip = apply(initial(), [{ type: "cost_forecast", forecast: costForecast() }]);
  trip = apply(trip, [{ type: "cost_override", category: "food", amount: { currency: "JPY", amountMinor: 0 } }]);
  expect(summarizeTripCosts(trip.costs!).totals).toEqual([{ currency: "JPY", amountMinor: 30000 }]);
  trip = apply({ ...trip, revision: 2 }, [{ type: "cost_forecast", forecast: costForecast(costTripId, 2, 20000) }]);
  expect(trip.costs?.overrides.food?.amountMinor).toBe(0); expect(trip.costs?.forecast.items[3].amount?.amountMinor).toBe(20000);
  trip = apply(trip, [{ type: "cost_override", category: "food" }]);
  expect(summarizeTripCosts(trip.costs!).totals[0].amountMinor).toBe(80000);
});
it("marks changed conditions and itinerary stale while title/override edits preserve freshness and adoption", () => {
  const forecasted = apply(initial(), [{ type: "cost_forecast", forecast: costForecast() }]);
  expect(apply(forecasted, [{ type: "title", title: "新名称" }]).costs?.stale).toBe(false);
  const changed = apply(forecasted, [{ type: "request", request: { ...forecasted.request, party: { adults: 3, children: [], source: "user" } } }]);
  expect(changed.costs?.stale).toBe(true);
  expect(apply(changed, [{ type: "cost_override", category: "food", amount: { currency: "JPY", amountMinor: 0 } }]).costs?.stale).toBe(true);
  expect(apply(changed, [{ type: "cost_forecast", forecast: costForecast() }]).costs?.stale).toBe(false);
  expect(apply(forecasted, [{ type: "add", item: { id: "walk", type: "activity", title: "散策", category: "free-time", schedule: { type: "unscheduled" } } }]).costs?.stale).toBe(true);
});
it("keeps unknowns distinct from zero, computes per-currency partial totals and never satisfies budget with estimates", () => {
  const base = initial(), forecast = costForecast();
  const trip = apply(base, [{ type: "cost_forecast", forecast: { ...forecast, items: forecast.items.map((item, i) => ({ ...item, amount: i === 0 ? { currency: "EUR", amountMinor: 1200 } : i === 1 ? { currency: "JPY", amountMinor: 0 } : undefined })) } }]);
  expect(summarizeTripCosts(trip.costs!)).toMatchObject({ unknownCount: 2, partial: true, totals: [{ currency: "EUR", amountMinor: 1200 }, { currency: "JPY", amountMinor: 0 }] });
  expect(evaluateTripFeasibility(trip, undefined, forecast.generatedAt)).toEqual(evaluateTripFeasibility(base, undefined, forecast.generatedAt));
  const budget = { ...base.request, constraints: [{ id: "budget", source: "user" as const, strength: "hard" as const, scope: { type: "trip" as const }, requirement: { type: "budget" as const, basis: "trip" as const, limit: { currency: "JPY" as const, amountMinor: 100000 } } }] };
  const before = apply(base, [{ type: "request", request: budget }]);
  const after = apply(before, [{ type: "cost_forecast", forecast }]);
  expect(evaluateTripFeasibility(after, undefined, forecast.generatedAt)).toEqual(evaluateTripFeasibility(before, undefined, forecast.generatedAt));
});
it("uses detailed lines as authoritative totals while retaining legacy category display", () => {
  const forecasted = apply(initial(), [{ type: "cost_forecast", forecast: costForecast() }]);
  const trip = apply(forecasted, [{ type: "cost_lines", lines: [{ id: "room-nights", category: "accommodation", kind: "provider_observed",
    basis: { scope: "whole-trip", dimensions: ["room", "night"] }, amount: { currency: "JPY", amountMinor: 12_000 }, amountRole: "unit", quantities: [{ dimension: "room", count: 1 }, { dimension: "night", count: 3 }],
    targetRefs: { itemIds: ["stay"] }, coverage: "complete", included: ["room"], excluded: [], assumptions: [], evidenceRefs: ["provider-price"], inputFingerprint: "fp",
    observedAt: "2026-09-20T00:00:00Z" }] }]);
  expect(summarizeTripCosts(trip.costs!)).toMatchObject({ authoritativeSource: "cost-lines", totals: [{ currency: "JPY", amountMinor: 36_000 }], partial: false });
  expect(summarizeTripCosts(trip.costs!).items).toHaveLength(4);
});
it("rejects wrong basis, duplicate/missing categories, invalid amounts, overflow and extra authority", () => {
  const base = initial(), valid = costForecast();
  for (const forecast of [{ ...valid, baseRevision: 1 }, { ...valid, tripId: "22222222-2222-4222-8222-222222222222" },
    { ...valid, items: valid.items.slice(1) }, { ...valid, items: valid.items.map(() => valid.items[0]) },
    { ...valid, items: valid.items.map(item => ({ ...item, amount: { currency: "JPY", amountMinor: -1 } })) },
    { ...valid, items: valid.items.map(item => ({ ...item, amount: { currency: "JPY", amountMinor: Number.MAX_SAFE_INTEGER } })) },
  ]) expect(() => apply(base, [{ type: "cost_forecast", forecast: forecast as typeof valid }])).toThrow();
  expect(() => parsePublicCostProposal({ tripId: base.id, baseRevision: 0, summary: "案", patches: [{ type: "cost_forecast", forecast: valid }], actor: "user" })).toThrow();
});
