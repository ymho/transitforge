import { describe, expect, it } from "vitest";
import { evaluateTripFeasibility } from "./trip-feasibility";
import { orderedScheduleRelation } from "./trip-feasibility-schedule";
import { feasibilityActivity as activity, feasibilityTrip, feasibilityFacts, feasibilityNow as now, feasibilityInstant as at, feasibilityObservation as observation } from "./trip-feasibility.fixture";
import { requestTrip, requestRailItem, requestConstraint, assumedRequest } from "./trip-request.fixture";
import { reservationFact } from "./reservation";
import { reservationFixture } from "./reservation.fixture";
import { placeStay } from "./trip-places.fixture";
import { requireFeasibleTrip } from "./trip-ready";
import { applyTripProposal, type Trip } from "./trip";
import type { ItinerarySchedule } from "./itinerary-schedule";

const evaluate = (trip: Trip, input = feasibilityFacts(trip)) => evaluateTripFeasibility(trip, input, now);
const codes = (trip: Trip, input = feasibilityFacts(trip)) => evaluate(trip, input).issues.map((i) => i.code);
describe("whole adopted Trip feasibility", () => {
  it("is pure, deterministic, revision-bound and derived, with all three states", () => {
    const trip = { ...feasibilityTrip(), revision: 5 }, before = structuredClone(trip);
    expect(evaluate(trip)).toMatchObject({ status: "feasible", tripId: trip.id, tripRevision: 5, evaluatedAt: now });
    expect(evaluate(trip)).toEqual(evaluate(trip)); expect(trip).toEqual(before);
    expect(evaluateTripFeasibility(trip, undefined, now).status).toBe("unknown");
    expect(evaluate(requestTrip(undefined, [activity("a"), activity("b", 9, 11)])).status).toBe("infeasible");
    expect(evaluate(requestTrip()).status).toBe("unknown");
  });
  it("uses absolute instants, preserves order and finds non-adjacent collisions", () => {
    const a = activity("a"); let b = activity("b", 10, 11);
    expect(evaluate(requestTrip(undefined, [a, b])).status).toBe("feasible");
    b = { ...b, schedule: { type: "fixed", startAt: { at: "2026-09-14T01:00:00Z", timeZone: "UTC" }, endAt: { at: "2026-09-14T02:00:00Z", timeZone: "UTC" } } };
    expect(evaluate(requestTrip(undefined, [a, b])).status).toBe("feasible");
    expect(codes(requestTrip(undefined, [b, a]))).toContain("schedule_overlap");
    expect(codes(requestTrip(undefined, [activity("long", 9, 14), { ...activity("unknown"), schedule: { type: "unscheduled" } }, activity("c", 12, 13)]))).toContain("schedule_overlap");
  });
  it("does not fix a window at earliestStart; distinguishes necessary/possible/unknown relations", () => {
    const window: ItinerarySchedule = { type: "window", earliestStart: at(9), latestEnd: at(13), durationMinutes: 60 };
    expect(orderedScheduleRelation(window, activity("b", 12, 13).schedule)).toBe("possible");
    expect(orderedScheduleRelation(window, activity("b", 13, 14).schedule)).toBe("satisfied");
    expect(orderedScheduleRelation(window, activity("b", 9, 10).schedule)).toBe("violated");
    const { durationMinutes: _, ...noDuration } = window;
    expect(orderedScheduleRelation(noDuration, activity().schedule)).toBe("unknown");
    const trip = requestTrip(undefined, [{ ...activity("a"), schedule: window }, activity("b", 12, 13)]);
    expect(evaluate(trip).status).toBe("unknown"); expect(codes(trip)).toContain("schedule_window_possible");
  });
  it.each<ItinerarySchedule>([{ type: "day", date: "2026-09-14" }, { type: "unscheduled" }, { type: "fixed", startAt: at(9) }])("does not fill missing precision: %j", (schedule) => {
    const trip = requestTrip(undefined, [{ ...activity(), schedule }, activity("b", 10, 11)]);
    expect(evaluate(trip).status).toBe("unknown"); expect(codes(trip)).not.toContain("schedule_overlap");
  });
  it("requires movement facts between distinct identities; same names cannot teleport", () => {
    const a = activity("a"); let b = { ...activity("b", 10, 11), place: { ...a.place!, ref: { ...a.place!.ref!, providerPlaceId: "different-id" } } };
    const trip = requestTrip(undefined, [a, b]), input = feasibilityFacts(trip);
    expect(codes(trip)).toContain("movement_unknown");
    input.external = [observation({ type: "movement", beforeItem: a, afterItem: b, minimumMinutes: 20 })];
    expect(evaluate(trip, input).status).toBe("infeasible");
    b = { ...b, schedule: activity("b", 11, 12).schedule };
    const later = requestTrip(undefined, [a, b]); input.external = [observation({ type: "movement", beforeItem: a, afterItem: b, minimumMinutes: 20 })];
    expect(evaluate(later, input).status).toBe("feasible");
    const returnTrip = requestTrip(undefined, [a, b, activity("return", 13, 14)]);
    expect(codes(returnTrip, feasibilityFacts(returnTrip))).toContain("movement_unknown");
    const manual = requestTrip(undefined, [a, { ...b, place: { name: a.place!.name, sources: [] } }]);
    expect(codes(manual)).toContain("movement_unknown");
  });
  it("uses selected rail validation and scheduled facts, rejecting injected realtime data", () => {
    const rail = requestRailItem(), trip = requestTrip(undefined, [rail]);
    expect(evaluate(trip).status).toBe("feasible");
    if (rail.detail.status !== "selected" || rail.detail.mode !== "rail") throw new Error("fixture");
    expect(rail.detail.journey.transfers.length).toBeGreaterThan(0);
    const invalid = structuredClone(trip) as any;
    invalid.items[0].detail.journey.delayMinutes = 10;
    expect(() => evaluate(invalid)).toThrow();
    const transfer = structuredClone(trip) as any;
    transfer.items[0].detail.journey.transfers[0].minimumTransferMinutes = 999;
    expect(() => evaluate(transfer)).toThrow();
    expect(codes(requestTrip(undefined, [{ ...rail, detail: { status: "unresolved", mode: "rail" } }]))).toContain("transport_unresolved");
  });
  it("does not certify manual non-rail schedules without an acquired duration fact", () => {
    const item = { id: "walk", title: "徒歩", type: "transport" as const, schedule: activity().schedule,
      detail: { status: "selected" as const, mode: "walk" as const, origin: { name: "A", sources: [] }, destination: { name: "B", sources: [] }, provenance: { type: "manual" as const } } };
    const trip = requestTrip(undefined, [item]);
    expect(codes(trip)).toContain("transport_unverified");
    const input = { ...feasibilityFacts(trip), external: [observation({ type: "transport", item, minimumMinutes: 30 })] };
    expect(evaluate(trip, input).status).toBe("feasible");
    input.external = [observation({ type: "transport", item, minimumMinutes: 90 })];
    expect(codes(trip, input)).toContain("movement_insufficient");
  });
  it("respects selected stay date spans without fabricating check-in time or complete prices", () => {
    const stay = placeStay("stay", "宿"), trip = requestTrip(undefined, [stay]);
    const before = structuredClone(trip);
    const result = evaluate(trip);
    expect(result.status).toBe("unknown"); expect(result.issues).toContainEqual(expect.objectContaining({ code: "stay_time_precision", details: { precision: "day" } }));
    expect(JSON.stringify(result)).not.toContain("15:00"); expect(trip).toEqual(before);
    expect(() => evaluate({ ...trip, items: [{ ...stay, schedule: { type: "day", date: "2026-09-23", endDate: "2026-09-24" } }] })).toThrow();
    const impossible = requestTrip({ constraints: [requestConstraint({ type: "dates", start: { earliest: "2026-09-25", latest: "2026-09-25" } })], assumptions: [] }, [stay]);
    expect(evaluate(impossible).status).toBe("infeasible");
  });
  it("requires acquired visit facts and honors unavailable/stale/unknown sources", () => {
    const item = { ...activity(), category: "sightseeing" as const }, trip = requestTrip(undefined, [item]);
    expect(codes(trip)).toContain("visit_unknown");
    const fact = observation({ type: "visit", item, available: true, reservationRequired: false });
    const input = { ...feasibilityFacts(trip), external: [fact] };
    expect(evaluate(trip, input).status).toBe("feasible");
    for (const changed of [{ ...fact, status: "unavailable" as const }, { ...fact, freshness: "stale" as const },
      { ...fact, evidence: [{ ...fact.evidence[0]!, validUntil: "2026-09-12T23:00:00Z" }] }, { ...fact, evidence: [] }]) {
      expect(evaluate(trip, { ...input, external: [changed] }).status).toBe("unknown");
    }
    expect(codes(trip, { ...input, external: [observation({ type: "visit", item, available: false, reservationRequired: false })] })).toContain("visit_unavailable");
    expect(codes(trip, { ...input, external: [observation({ type: "visit", item, available: true, reservationRequired: true })] })).toContain("reservation_required");
    const required = { ...input, reservations: [reservationFact(reservationFixture({ status: "not-booked" }))],
      external: [observation({ type: "visit", item, available: true, reservationRequired: true })] };
    expect(evaluate(trip, required).status).toBe("infeasible");
    const changed = requestTrip(undefined, [{ ...item, schedule: activity("a", 11, 12).schedule }]);
    expect(evaluate(changed, input).status).toBe("unknown"); // same revision, different proposed item
    const raw = { ...fact, data: { ...fact.data!, providerRaw: { secret: "RAW-PRIVATE" } } };
    const rejected = evaluate(trip, { ...input, external: [raw] });
    expect(rejected.status).toBe("unknown"); expect(JSON.stringify(rejected)).not.toContain("RAW-PRIVATE");
  });
  it("combines hard violations and unknowns without treating model confidence as a proof", () => {
    const trip = requestTrip({ constraints: [requestConstraint({ type: "dates", start: { earliest: "2026-09-15", latest: "2026-09-15" } }),
      requestConstraint({ type: "pace", value: 0.4 }, { id: "subjective" })], assumptions: [] }, [activity()]);
    expect(codes(trip)).toContain("hard_constraint_violated"); expect(codes(trip)).toContain("hard_constraint_unknown");
    expect(evaluate(trip).status).toBe("infeasible");
    expect(evaluate(requestTrip(assumedRequest(), [activity()])).status).toBe("unknown");
  });
  it("blocks stale input/ready, evaluates actual proposed content, and never rewrites persisted ready", () => {
    const trip = { ...feasibilityTrip(), revision: 6 };
    expect(() => requireFeasibleTrip(trip, { ...feasibilityFacts(trip), tripRevision: 5 }, now)).toThrow();
    const ready = applyTripProposal(trip, { tripId: trip.id, baseRevision: 6, summary: "ready", patches: [{ type: "planning", state: "ready" }] });
    expect(requireFeasibleTrip(ready, feasibilityFacts(ready), now).status).toBe("feasible");
    expect(evaluateTripFeasibility(ready, undefined, now).status).toBe("unknown");
    expect(ready.planningState).toBe("ready"); expect(trip.planningState).not.toBe("ready");
  });
});

describe("reservation feasibility, independent of adopted selection", () => {
  const trip = feasibilityTrip();
  const booked = reservationFact(reservationFixture({ startsAt: at(9), endsAt: at(10) }));
  it("aligns booked fixed times and detects conflicts with record/item IDs", () => {
    expect(evaluate(trip, { ...feasibilityFacts(trip), reservations: [booked] }).status).toBe("feasible");
    const r = { ...booked, startsAt: at(8) };
    const result = evaluate(trip, { ...feasibilityFacts(trip), reservations: [r] });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "reservation_conflict", itemIds: ["activity"], reservationIds: [booked.reservationId] }));
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|bookingReference|providerItemId/);
  });
  it.each(["day", "unscheduled"] as const)("does not infer booking time from %s", (type) => {
    const item = { ...activity(), schedule: type === "day" ? { type, date: "2026-09-14" } : { type } };
    const plan = requestTrip(undefined, [item]);
    expect(codes(plan, { ...feasibilityFacts(plan), reservations: [booked] })).toContain("reservation_time_unknown");
  });
  it.each(["cancelled", "not-required", "not-booked"] as const)("does not treat %s as booked", (status) => {
    expect(evaluate(trip, { ...feasibilityFacts(trip), reservations: [{ ...booked, status, startsAt: at(8) }] }).status).toBe("feasible");
  });
  it("exposes unknown/dangling separately, rejects private payload, and does not relink", () => {
    const input = { ...feasibilityFacts(trip), reservations: [{ ...booked, status: "unknown" as const }] };
    expect(codes(trip, input)).toContain("reservation_unknown");
    input.reservations[0]!.itineraryItemId = "removed";
    expect(codes(trip, input)).toContain("reservation_dangling");
    expect(input.reservations[0]!.itineraryItemId).toBe("removed");
    const bad = { ...feasibilityFacts(trip), reservations: [{ ...booked, bookingReference: "SECRET" }] };
    const result = evaluate(trip, bad);
    expect(result.status).toBe("unknown"); expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});
