import { describe, it, expect } from "vitest";
import { evaluateTripFeasibility } from "./trip-feasibility";
import { requireFeasibleTrip, blocksReady, hasReadyBlockers } from "./trip-ready";
import { feasibilityStayTrip, feasibilityNow as now, feasibilityInstant as at, feasibilityActivity, feasibilityTrip, feasibilityFacts, feasibilityObservation } from "./trip-feasibility.fixture";
import { applyTripProposal, validateTrip, type Trip } from "./trip";
import { requestConstraint, requestTrip } from "./trip-request.fixture";
import { reservationFact } from "./reservation";
import { reservationFixture } from "./reservation.fixture";

describe("ready policy independent of overall unknown", () => {
  it("permits a selected overnight Trip without inventing hours or weakening day invariant", () => {
    const { trip, facts, stay } = feasibilityStayTrip(), original = structuredClone(trip);
    const evaluation = requireFeasibleTrip(trip, facts, now);
    expect(evaluation.status).toBe("unknown"); expect(hasReadyBlockers(evaluation)).toBe(false);
    expect(evaluation.issues.map((i) => i.code)).toEqual(["stay_time_precision", "stay_movement_time_precision", "stay_movement_time_precision"]);
    const ready = applyTripProposal(trip, { tripId: trip.id, baseRevision: trip.revision, summary: "ready", patches: [{ type: "planning", state: "ready" }] });
    expect(requireFeasibleTrip(ready, facts, now).status).toBe("unknown");
    expect(ready.items[1]!.schedule).toEqual(stay.schedule); expect(trip).toEqual(original);
    expect(JSON.stringify(ready)).not.toMatch(/15:00|10:00/);
    expect(() => validateTrip({ ...trip, items: [{ ...stay, schedule: { type: "fixed", startAt: at(9), endAt: at(10) } }] })).toThrow();
  });
  it("keeps persisted ready unchanged when informational booking precision appears", () => {
    const { trip, facts } = feasibilityStayTrip(); const ready: Trip = { ...trip, planningState: "ready" }, original = structuredClone(ready);
    const booking = reservationFact(reservationFixture({ itineraryItemId: "hotel" }));
    const result = requireFeasibleTrip(ready, { ...facts, reservations: [booking] }, now);
    expect(result.status).toBe("unknown"); expect(result.issues.some((i) => i.code === "stay_reservation_time_precision")).toBe(true);
    expect(ready).toEqual(original); expect(() => validateTrip(ready)).not.toThrow();
    expect(() => requireFeasibleTrip(ready, { ...facts, reservations: [{ ...booking, startsAt: at(18, "2026-09-24") }] }, now)).toThrow();
  });
  it("does not waive missing routes or expired evidence as hotel precision", () => {
    const { trip, facts } = feasibilityStayTrip();
    for (const external of [facts.external!.filter((f) => f.data?.type !== "movement"),
      facts.external!.map((f) => f.data?.type === "movement" ? { ...f, freshness: "stale" as const } : f)]) {
      const result = evaluateTripFeasibility(trip, { ...facts, external }, now);
      expect(result.issues.some((i) => i.code === "movement_unknown" && blocksReady(i))).toBe(true);
      expect(() => requireFeasibleTrip(trip, { ...facts, external }, now)).toThrow();
    }
  });
  it("retains blockers for unresolved transport, hard unknown and reservation required unknown", () => {
    const { trip, facts, before, stay } = feasibilityStayTrip();
    const unresolved = { ...trip, items: [{ ...before, detail: { status: "unresolved" as const, mode: "rail" as const } }, ...trip.items.slice(1)] };
    const hard = { ...trip, request: { ...trip.request, constraints: [requestConstraint({ type: "pace", value: 0.4 })] } };
    expect(() => requireFeasibleTrip(unresolved, facts, now)).toThrow();
    expect(() => requireFeasibleTrip(hard, facts, now)).toThrow();
    const required = { ...facts, external: [...facts.external!.filter((f) => f.data?.type !== "visit"), feasibilityObservation({ type: "visit", item: stay, available: true, reservationRequired: true })] };
    expect(() => requireFeasibleTrip(trip, required, now)).toThrow();
    for (const code of ["empty_trip", "transport_unresolved", "hard_constraint_unknown", "reservation_required", "reservation_conflict", "reservation_time_unknown"] as const) {
      expect(blocksReady({ code, severity: "warning", status: "unknown", itemIds: [] })).toBe(true);
    }
  });
  it("allows bounded window precision alone, not unresolved placement conflicts", () => {
    const item = { ...feasibilityActivity(), schedule: { type: "window" as const, earliestStart: at(9), latestEnd: at(13), durationMinutes: 60 } };
    const trip = requestTrip(undefined, [item]);
    expect(requireFeasibleTrip(trip, feasibilityFacts(trip), now).status).toBe("unknown");
    const collision = requestTrip(undefined, [item, feasibilityActivity("next", 12, 13)]);
    expect(() => requireFeasibleTrip(collision, feasibilityFacts(collision), now)).toThrow();
    expect(() => requireFeasibleTrip(feasibilityTrip(), undefined, now)).toThrow();
  });
});
