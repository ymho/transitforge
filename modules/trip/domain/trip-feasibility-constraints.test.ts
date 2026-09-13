import { expect, it } from "vitest";
import { evaluateTripFeasibility } from "./trip-feasibility";
import { evaluateTripHardConstraints } from "./trip-constraint-evaluation";
import { requestTrip, requestConstraint, requestRailItem } from "./trip-request.fixture";
import { feasibilityActivity as activity, feasibilityFacts, feasibilityNow as now, feasibilityObservation as observation } from "./trip-feasibility.fixture";
import type { TripRequirement } from "./trip-requirement";
import type { Money } from "./money";

it("evaluates destination order and repeat visits with Place identity, not a set or names", () => {
  const a = activity("a"), again = activity("again", 13, 14);
  const b = { ...activity("b", 11, 12), place: { ...a.place!, ref: { ...a.place!.ref!, providerPlaceId: "B" } } };
  const wanted = { type: "destinations" as const, order: "fixed" as const, places: [a.place!, b.place!, a.place!] };
  const check = (items: typeof a[], req = wanted) => evaluateTripHardConstraints(requestTrip({ constraints: [requestConstraint(req)], assumptions: [] }, items))[0]!.status;
  expect(check([a, b, again])).toBe("satisfied");
  expect(check([a, again, b])).toBe("violated");
  expect(check([a, b], { ...wanted, places: [{ name: "散策", sources: [] }] })).toBe("unknown");
  expect(check([a, b], { ...wanted, places: [{ ...a.place!, ref: { provider: "other", providerPlaceId: "A" },
    sources: [{ ...a.place!.sources[0]!, provider: "other" }] }] })).toBe("unknown");
});

it.each<[TripRequirement, string]>([
  [{ type: "duration", unit: "days", minimum: 1, maximum: 1 }, "satisfied"],
  [{ type: "duration", unit: "nights", minimum: 1, maximum: 2 }, "violated"],
  [{ type: "dates", start: { earliest: "2026-09-14", latest: "2026-09-14" } }, "satisfied"],
  [{ type: "dates", start: { earliest: "2026-09-15", latest: "2026-09-15" } }, "violated"],
  [{ type: "origin", place: activity().place! }, "satisfied"],
])("reuses effective hard constraint evaluator %j", (requirement, expected) => {
  const trip = requestTrip({ constraints: [requestConstraint(requirement)], assumptions: [] }, [activity()]);
  expect(evaluateTripHardConstraints(trip)[0]!.status).toBe(expected);
  expect(evaluateTripFeasibility(trip, feasibilityFacts(trip), now).status).toBe(expected === "violated" ? "infeasible" : "feasible");
});

it("reuses scheduled rail arrive/depart/mobility facts and preserves proven violations despite unknown legs", () => {
  const rail = requestRailItem();
  if (rail.detail.status !== "selected" || rail.detail.mode !== "rail") throw new Error("fixture");
  const first = rail.detail.journey.legs[0]!, last = rail.detail.journey.legs.at(-1)!;
  // The rail fixture has name-only station snapshots. Missing identity must not certify arrival.
  const requirement: TripRequirement = { type: "arrive_by", place: last.destination, at: last.scheduledArrival };
  const check = (req: TripRequirement) => evaluateTripHardConstraints(requestTrip({ constraints: [requestConstraint(req)], assumptions: [] }, [rail]))[0]!.status;
  expect(check(requirement)).toBe(last.destination.ref ? "satisfied" : "unknown");
  expect(check({ type: "depart_after", place: first.origin, at: first.scheduledDeparture })).toBe(first.origin.ref ? "satisfied" : "unknown");
  expect(check({ type: "mobility", maxTravelMinutes: 1 })).toBe("violated");
  expect(check({ type: "mobility", modes: ["rail"] })).toBe("satisfied");
  Object.assign(last.destination, { ref: { provider: "timetable", providerPlaceId: "station-c" } });
  const deadline: TripRequirement = { type: "arrive_by", place: last.destination,
    at: { ...last.scheduledArrival, at: "2026-09-13T10:30:00+09:00" } };
  const unknown = { ...rail, id: "unknown", detail: { status: "unresolved" as const }, schedule: { type: "unscheduled" as const } };
  const plan = requestTrip({ constraints: [requestConstraint(deadline)], assumptions: [] }, [rail, unknown]);
  expect(evaluateTripHardConstraints(plan)[0]!.status).toBe("violated");
  expect(evaluateTripFeasibility(plan, feasibilityFacts(plan), now).status).toBe("infeasible");
});

it("budgets need complete adopted-item costs; no missing=0, mixed FX, or candidate/reference totals", () => {
  const items = [activity("a"), activity("b", 11, 12)];
  const trip = requestTrip({ constraints: [requestConstraint({ type: "budget", limit: { currency: "EUR", amountMinor: 3000 }, basis: "trip" })], assumptions: [] }, items);
  const cost = (index: number, total: Money) => observation({ type: "cost", item: items[index]!, total, coverage: "complete-item", party: undefined });
  const check = (external: ReturnType<typeof cost>[]) => evaluateTripFeasibility(trip, { ...feasibilityFacts(trip), external }, now);
  expect(check([]).status).toBe("unknown");
  expect(check([cost(0, { currency: "EUR", amountMinor: 1000 })]).status).toBe("unknown");
  expect(check([cost(0, { currency: "EUR", amountMinor: 1000 }), cost(1, { currency: "CHF", amountMinor: 1000 })]).status).toBe("unknown");
  expect(check([cost(0, { currency: "EUR", amountMinor: 1000 }), cost(1, { currency: "EUR", amountMinor: 2000 })]).status).toBe("feasible");
  const over = check([cost(0, { currency: "EUR", amountMinor: 2000 }), cost(1, { currency: "EUR", amountMinor: 2000 })]);
  expect(over.status).toBe("infeasible"); expect(over.issues[0]!.constraintIds).toEqual(["condition"]);
  const duplicate = cost(0, { currency: "EUR", amountMinor: 1000 });
  expect(check([duplicate, duplicate, cost(1, { currency: "EUR", amountMinor: 1000 })]).status).toBe("unknown");
});

it("per-person budget uses only this confirmed party; cost facts cannot survive party changes", () => {
  const item = activity(), party = { adults: 2, children: [], source: "user" as const };
  const trip = requestTrip({ party, constraints: [requestConstraint({ type: "budget", limit: { currency: "EUR", amountMinor: 1000 }, basis: "per-person" })], assumptions: [] }, [item]);
  const external = [observation({ type: "cost", item, party, total: { currency: "EUR", amountMinor: 1800 }, coverage: "complete-item" })];
  expect(evaluateTripFeasibility(trip, { ...feasibilityFacts(trip), external }, now).status).toBe("feasible");
  const changed = { ...trip, request: { ...trip.request, party: { ...party, adults: 1 } } };
  expect(evaluateTripFeasibility(changed, { ...feasibilityFacts(changed), external }, now).status).toBe("unknown");
  const missing = { ...trip, request: { ...trip.request, party: undefined } };
  expect(evaluateTripFeasibility(missing, { ...feasibilityFacts(missing), external }, now).status).toBe("unknown");
});
