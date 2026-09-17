import { impactInput, impactNow } from "./rail-trip-impact.fixture";
import { evaluateRailTripImpact } from "./rail-trip-impact";
import { buildInTripContext, type InTripFacts } from "./in-trip-context";
import type { Trip } from "./trip";

/** Synthetic facts through the existing evaluator, never invented by the model. */
export function inTripFixture() {
  const input = impactInput(6);
  const trip: Trip = { ...input.trip, lifecycleState: "in_trip", items: [...input.trip.items,
    { id: "garden", type: "activity", category: "sightseeing", title: "庭園の散策", place: { name: "評価用庭園", sources: [] },
      schedule: { type: "fixed", startAt: { at: "2026-09-13T11:00:00+09:00", timeZone: "Asia/Tokyo" },
        endAt: { at: "2026-09-13T12:00:00+09:00", timeZone: "Asia/Tokyo" } } },
  ] };
  const impact = evaluateRailTripImpact({ ...input, trip });
  const now = { at: impactNow, timeZone: "UTC" };
  const facts: InTripFacts = { tripConfirmed: true, impacts: [{ impact, observedAt: impactNow, expiresAt: "2026-09-13T01:05:00Z", fresh: true }], notifications: [], reservations: [] };
  return { trip, impact, now, facts, snapshot: buildInTripContext(trip, now, facts)! };
}
