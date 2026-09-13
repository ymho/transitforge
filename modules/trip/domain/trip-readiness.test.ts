import { it, expect } from "vitest";
import { projectTripReadiness } from "./trip-readiness";
import { evaluateTripFeasibility } from "./trip-feasibility";
import { feasibilityTrip, feasibilityStayTrip, feasibilityFacts, feasibilityNow, feasibilityObservation } from "./trip-feasibility.fixture";
import { checklistItem } from "./trip-checklist.fixture";
import { requestTrip, requestConstraint, assumedRequest } from "./trip-request.fixture";
import type { ReservationFact } from "./reservation";

it("keeps selected stay unknowns informational, ready independent from open preparation, and snapshots unchanged", () => {
  const fixture = feasibilityStayTrip(), { facts, stay } = fixture;
  const trip = { ...fixture.trip, planningState: "ready" as const };
  const before = structuredClone(trip), items = [checklistItem({ tripId: trip.id })];
  const r = projectTripReadiness(trip, evaluateTripFeasibility(trip, facts, feasibilityNow), facts.reservations, items);
  expect(r.feasibilityStatus).toBe("unknown"); expect(r.blocksReady).toBe(false);
  expect(r.planning.some((i) => i.code === "stay_visit_unchecked")).toBe(true);
  expect(r.preparation.categories.find((c) => c.category === "connectivity")?.open).toBe(1);
  expect(r.reservations.unrecordedItemIds).toContain(stay.id); expect(r.reservations.records).toEqual([]);
  expect(trip).toEqual(before); expect(stay.schedule.type).toBe("day");
});
it("does not let complete preparation conceal planning violations/unknowns", () => {
  for (const trip of [requestTrip(undefined, []), feasibilityTrip()]) {
    const result = projectTripReadiness(trip, evaluateTripFeasibility(trip, undefined, feasibilityNow), undefined, [checklistItem({ tripId: trip.id, status: "done" })]);
    expect(result.blocksReady).toBe(true);
    if (!trip.items.length) expect(result.planning.some((i) => i.code === "empty_trip")).toBe(true);
    expect(result.reservations.readState).toBe("unavailable"); expect(result.booking.some((i) => i.code === "reservations_unknown")).toBe(true);
  }
  const { trip, facts, stay } = feasibilityStayTrip();
  facts.external = [...facts.external!, feasibilityObservation({ type: "visit", item: stay, available: false, reservationRequired: false })];
  const r = projectTripReadiness(trip, evaluateTripFeasibility(trip, facts, feasibilityNow), [], [checklistItem({ status: "done" })]);
  expect(r.feasibilityStatus).toBe("infeasible"); expect(r.planningBlocksReady).toBe(true);
});
it("preserves all five booking states without selected/URL/no record inference", () => {
  const { trip, facts, stay } = feasibilityStayTrip();
  for (const status of ["booked", "not-booked", "cancelled", "not-required", "unknown"] as const) {
    const record: ReservationFact = { reservationId: checklistItem().id, revision: 3, itineraryItemId: stay.id, kind: "accommodation", status };
    facts.reservations = [record];
    const r = projectTripReadiness(trip, evaluateTripFeasibility(trip, facts, feasibilityNow), [record], undefined);
    expect(r.reservations.records[0]?.status).toBe(status); expect(r.reservations.unrecordedItemIds).not.toContain(stay.id);
    expect(r.preparation.readState).toBe("unavailable");
  }
  facts.external = [...facts.external!, feasibilityObservation({ type: "visit", item: stay, available: true, reservationRequired: true })];
  facts.reservations = [];
  const r = projectTripReadiness(trip, evaluateTripFeasibility(trip, facts, feasibilityNow), [], []);
  expect(r.booking.some((i) => i.code === "reservation_required")).toBe(true); expect(r.bookingBlocksReady).toBe(true);
});
it("rejects stale Feasibility and private Reservation payload; reports dangling links without deleting items", () => {
  const trip = feasibilityTrip(), evaluation = evaluateTripFeasibility(trip, feasibilityFacts(trip), feasibilityNow);
  expect(() => projectTripReadiness(trip, { ...evaluation, tripRevision: 9 }, [], [])).toThrow();
  expect(() => projectTripReadiness(trip, evaluation, [{ reservationId: checklistItem().id, kind: "other", revision: 0, status: "booked", bookingReference: "private" }] as never, [])).toThrow();
  const item = checklistItem({ status: "done", relatedItineraryItemId: "deleted", relatedReservationId: checklistItem().id });
  const r = projectTripReadiness(trip, evaluation, [], [item]);
  expect(r.preparation.warnings.map((w) => w.code)).toEqual(["itinerary_link_missing", "reservation_link_missing"]);
  expect(projectTripReadiness(trip, evaluation, undefined, [item]).preparation.warnings[1]?.code).toBe("reservation_link_unchecked");
  expect(item.status).toBe("done");
});

it("reuses unresolved selections, hard violations/unknown and unconfirmed assumptions rather than another completeness DSL", () => {
  const base = feasibilityTrip();
  const trips = [
    requestTrip(undefined, [{ id: "move", title: "移動", type: "transport", detail: { status: "unresolved" }, schedule: { type: "unscheduled" } },
      { id: "stay", title: "宿", type: "stay", selection: { status: "unselected" }, schedule: { type: "unscheduled" } }]),
    requestTrip({ constraints: [requestConstraint({ type: "dates", start: { earliest: "2026-09-15", latest: "2026-09-15" } }),
      requestConstraint({ type: "pace", value: 0.4 }, { id: "subjective" })], assumptions: [] }, base.items),
    requestTrip(assumedRequest(), base.items),
  ];
  for (const [index, trip] of trips.entries()) {
    const result = projectTripReadiness(trip, evaluateTripFeasibility(trip, feasibilityFacts(trip), feasibilityNow), [], []);
    const expected = [["transport_unresolved", "stay_unselected"], ["hard_constraint_violated", "hard_constraint_unknown"], ["assumption_unconfirmed"]][index]!;
    expect(result.planning.map((i) => i.code)).toEqual(expect.arrayContaining(expected)); expect(result.planningBlocksReady).toBe(true);
  }
  const result = projectTripReadiness(base, evaluateTripFeasibility(base, feasibilityFacts(base), feasibilityNow), [], []);
  expect(result.feasibilityStatus).toBe("feasible"); expect(result.planning).toEqual([]); expect(result.blocksReady).toBe(false);
});
