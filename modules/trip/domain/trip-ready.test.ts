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
    expect(facts.external!.some((f) => f.data?.type === "visit")).toBe(false);
    expect(evaluation.issues.map((i) => i.code)).toEqual(["stay_time_precision", "stay_visit_unchecked", "stay_movement_time_precision", "stay_movement_time_precision"]);
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
    expect(facts.external!.some((f) => f.data?.type === "visit")).toBe(false);
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
  it("blocks a fresh unavailable hotel fact even with an adopted hotel and no other blockers", () => {
    const { trip, facts, stay } = feasibilityStayTrip();
    const input = { ...facts, external: [...facts.external!, feasibilityObservation({ type: "visit", item: stay, available: false, reservationRequired: false })] };
    const result = evaluateTripFeasibility(trip, input, now);
    expect(result.status).toBe("infeasible");
    expect(result.issues.some((i) => i.code === "visit_unavailable" && blocksReady(i))).toBe(true);
    expect(() => requireFeasibleTrip(trip, input, now)).toThrow();
  });
  it.each(["not-booked", "unknown"] as const)("checks fresh hotel reservation requirements against %s", (status) => {
    const { trip, facts, stay } = feasibilityStayTrip();
    const input = { ...facts, reservations: [reservationFact(reservationFixture({ itineraryItemId: stay.id, status }))],
      external: [...facts.external!, feasibilityObservation({ type: "visit", item: stay, available: true, reservationRequired: true })] };
    const result = evaluateTripFeasibility(trip, input, now);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "reservation_required", status: status === "not-booked" ? "violated" : "unknown" }));
    expect(() => requireFeasibleTrip(trip, input, now)).toThrow();
  });
  it("keeps stale, expired, unavailable and invalid hotel observations blocking rather than silently dropping them", () => {
    const { trip, facts, stay } = feasibilityStayTrip();
    const visit = feasibilityObservation({ type: "visit", item: stay, available: true, reservationRequired: false });
    for (const observation of [{ ...visit, freshness: "stale" as const }, { ...visit, status: "unavailable" as const },
      { ...visit, evidence: [{ ...visit.evidence[0]!, validUntil: "2026-09-12T01:00:00Z" }] },
      { ...visit, evidence: [] }]) {
      const input = { ...facts, external: [...facts.external!, observation] };
      const result = evaluateTripFeasibility(trip, input, now);
      expect(result.status).toBe("unknown"); expect(result.issues.some((i) => i.code === "visit_unknown" && blocksReady(i))).toBe(true);
      expect(() => requireFeasibleTrip(trip, input, now)).toThrow();
    }
  });
  it("keeps general Activity visit absence blocking", () => {
    const item = { ...feasibilityActivity(), category: "sightseeing" as const }, trip = requestTrip(undefined, [item]);
    const evaluation = evaluateTripFeasibility(trip, feasibilityFacts(trip), now);
    expect(evaluation.issues.some((i) => i.code === "visit_unknown" && blocksReady(i))).toBe(true);
    expect(() => requireFeasibleTrip(trip, feasibilityFacts(trip), now)).toThrow();
  });
});
