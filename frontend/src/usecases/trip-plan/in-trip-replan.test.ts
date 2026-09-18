import { describe, expect, it } from "vitest";
import { createTrip, type ItineraryItem, type Trip, type TripPatch } from "@raiquora/trip/trip";
import type { ReservationFact } from "@raiquora/trip/reservation";
import { calculateInTripReplanScope, previewInTripReplan, replanScopeContext } from "./in-trip-replan";
import { createTripWorkspaceController } from "./trip-workspace-controller";
import { reservationChangeKey } from "@raiquora/trip/reservation";

const now = new Date("2026-09-20T01:00:00Z");
const zoned = (hour: string) => ({ at: `2026-09-20T${hour}:00:00+09:00`, timeZone: "Asia/Tokyo" });
const activity = (id: string, schedule: ItineraryItem["schedule"]): ItineraryItem => ({ id, title: id, type: "activity", category: "free-time", schedule });
const replanTestTrip = (): Trip => ({ ...createTrip("11111111-1111-4111-8111-111111111111", "旅行", "2026-09-19T00:00:00Z", [
  activity("past", { type: "fixed", startAt: zoned("08"), endAt: zoned("09") }),
  activity("current", { type: "window", earliestStart: zoned("09"), latestEnd: zoned("11") }),
  activity("next", { type: "window", earliestStart: zoned("11"), latestEnd: zoned("12") }),
  activity("booked", { type: "fixed", startAt: zoned("13"), endAt: zoned("14") }),
  activity("distant", { type: "day", date: "2026-09-21", timeZone: "Asia/Tokyo" }),
  activity("unknown", { type: "unscheduled" }),
]), lifecycleState: "in_trip" });
const reservation: ReservationFact = { reservationId: "22222222-2222-4222-8222-222222222222", revision: 0, kind: "activity", status: "booked", itineraryItemId: "booked" };
const input = { now, reservations: [reservation] };
const proposal = (trip: Trip, patches: TripPatch[]) => ({ tripId: trip.id, baseRevision: trip.revision, summary: "変更案", patches });
describe("in-trip Application scope and existing Proposal", () => {
  it("protects definitely past, fixed/booked, unrelated future, unknown; preserves schedule precision", () => {
    const trip = replanTestTrip(), scope = calculateInTripReplanScope(trip, input);
    expect(scope.mutableItemIds).toEqual(["current", "next"]);
    expect(scope.immutableProtectedItemIds).toEqual(["past", "booked", "distant", "unknown"]);
    expect(scope.confirmationProtectedItemIds).toContain("booked");
    expect(replanScopeContext(scope)).not.toHaveProperty("reservations");
    for (const id of scope.immutableProtectedItemIds) for (const patch of [
      { type: "remove" as const, itemId: id }, { type: "replace" as const, itemId: id, item: trip.items.find((i) => i.id === id)! },
    ]) expect(() => previewInTripReplan(trip, proposal(trip, [patch]), input)).toThrow();
  });
  it("explicit targets never authorize past; booked/fixed changes require a separate exact confirmation", async () => {
    const trip = replanTestTrip(), targets = { tripId: trip.id, baseRevision: 0, itemIds: ["booked"] };
    const p = proposal(trip, [{ type: "remove", itemId: "booked" }]);
    const preview = previewInTripReplan(trip, p, { ...input, targets });
    expect(preview.confirmationKey).toBeTruthy();
    expect(preview.protectedChanges).toEqual([{ itemId: "booked", codes: ["booked", "fixed"] }]);
    let writes = 0;
    const c = createTripWorkspaceController("s", () => now);
    c.attach("s", { getCurrentTrip: () => trip, getReservationFacts: () => input.reservations, getReplanTargets: () => targets, confirmProposal: async () => { writes++; } });
    c.preview(p); await expect(c.confirm()).rejects.toThrow(); expect(writes).toBe(0);
    c.dismiss(); expect(writes).toBe(0); expect(trip.items).toHaveLength(6);
    c.preview(p);
    await c.confirm({ replanConfirmationKey: preview.confirmationKey, reservationChangeKey: reservationChangeKey(p, input.reservations) });
    expect(writes).toBe(1);
    expect(() => previewInTripReplan(trip, proposal(trip, [{ type: "remove", itemId: "past" }]), { ...input, targets: { ...targets, itemIds: ["past"] } })).toThrow();
  });
  it("does not intercept a separate Request-only preview", () => {
    const trip = replanTestTrip(), c = createTripWorkspaceController("s", () => now);
    c.attach("s", { getCurrentTrip: () => trip, getReservationFacts: () => input.reservations });
    expect(() => c.preview(proposal(trip, [{ type: "request", request: trip.request }]))).not.toThrow();
    expect(c.replan()).toBeUndefined();
  });
  it("is pure, keeps outside items, evaluates unknown movement/constraints rather than declaring feasible", () => {
    const trip = replanTestTrip(), original = structuredClone(trip);
    const p = proposal(trip, [{ type: "replace", itemId: "next", item: { ...trip.items[2]!, title: "休憩" } }]);
    const preview = previewInTripReplan(trip, p, input);
    expect(preview.proposed.items[2]?.title).toBe("休憩"); expect(preview.keptItemIds).toContain("booked");
    expect(preview.feasibility.status).not.toBe("feasible"); expect(trip).toEqual(original);
    expect(previewInTripReplan(trip, p, input)).toEqual(preview);
  });
  it("guards add/move slots, atomic patches, and no constraint/lifecycle erasure", () => {
    const trip = replanTestTrip();
    const newItem = activity("new", { type: "unscheduled" });
    expect(previewInTripReplan(trip, proposal(trip, [{ type: "add", item: newItem, afterId: "next" }]), input).proposed.items).toHaveLength(7);
    for (const patches of [
      [{ type: "add", item: newItem, afterId: "past" }], [{ type: "add", item: newItem }],
      [{ type: "move", itemId: "next", afterId: "past" }],
      [{ type: "remove", itemId: "next" }, { type: "remove", itemId: "past" }],
      [{ type: "request", request: trip.request }],
    ] as TripPatch[][]) expect(() => previewInTripReplan(trip, proposal(trip, patches), input)).toThrow();
    expect(trip.items).toHaveLength(6);
  });
  it("uses full Reservation facts, never treats read failure as absence", () => {
    const trip = replanTestTrip();
    expect(calculateInTripReplanScope(trip, { now, reservations: undefined }).mutableItemIds).toEqual([]);
    expect(calculateInTripReplanScope(trip, { now, reservations: [] }).mutableItemIds).toContain("next");
  });
  it("protects hard-supporting items and preserves unknowns", () => {
    const trip = replanTestTrip();
    const hard: Trip = { ...trip, request: { ...trip.request, constraints: [{ id: "must", source: "user", strength: "hard", scope: { type: "item", itemId: "next" }, requirement: { type: "pace", value: 0.3 } }] } };
    expect(calculateInTripReplanScope(hard, input).mutableItemIds).not.toContain("next");
    const preview = previewInTripReplan(hard, proposal(hard, [{ type: "replace", itemId: "next", item: hard.items[2]! }]), { ...input,
      targets: { tripId: trip.id, baseRevision: 0, itemIds: ["next"] } });
    expect(preview.protectedChanges[0]?.codes).toContain("hard-constraint");
  });
  it("rejects terminal, stale scope and stale Proposal; never silently rebases", () => {
    const trip = replanTestTrip();
    for (const lifecycleState of ["completed", "cancelled", "pre_trip"] as const) expect(() => calculateInTripReplanScope({ ...trip, lifecycleState }, input)).toThrow();
    expect(() => calculateInTripReplanScope({ ...trip, revision: 1 }, { ...input, targets: { tripId: trip.id, baseRevision: 0, itemIds: ["next"] } })).toThrow();
    expect(() => previewInTripReplan({ ...trip, revision: 1 }, proposal(trip, [{ type: "remove", itemId: "next" }]), input)).toThrow();
  });
  it("rechecks advancing clock and date precision without invented completion/location", () => {
    const trip = replanTestTrip();
    const day = calculateInTripReplanScope(trip, { ...input, targets: { tripId: trip.id, baseRevision: 0, itemIds: ["distant", "unknown"] } });
    expect(day.mutableItemIds).toEqual(["distant", "unknown"]);
    expect(() => previewInTripReplan(trip, proposal(trip, [{ type: "remove", itemId: "next" }]), { ...input, now: new Date("2026-09-20T03:00:00Z") })).toThrow();
    const dst = { ...trip, items: [activity("dst", { type: "window", earliestStart: { at: "2026-11-01T01:00:00-04:00", timeZone: "America/New_York" }, latestEnd: { at: "2026-11-01T01:30:00-05:00", timeZone: "America/New_York" } })] };
    expect(calculateInTripReplanScope(dst, { now: new Date("2026-11-01T06:00:00Z"), reservations: [] }).currentItemIds).toEqual(["dst"]);
  });
  it("bounds overlapping current items and preserves local midnight precision", () => {
    const trip = { ...replanTestTrip(), items: ["a", "b", "c"].map((id) => activity(id,
      { type: "day", date: "2026-09-20", timeZone: "Asia/Tokyo" })) };
    expect(calculateInTripReplanScope(trip, input).mutableItemIds).toEqual(["a", "b"]);
    expect(calculateInTripReplanScope(trip, { ...input, now: new Date("2026-09-20T15:00:00Z") }).immutableProtectedItemIds).toEqual(["a", "b", "c"]);
    const ordered = replanTestTrip(), targets = { tripId: ordered.id, baseRevision: 0, itemIds: ["next", "distant"] };
    expect(() => previewInTripReplan(ordered, proposal(ordered, [{ type: "move", itemId: "next", afterId: "distant" }]), { ...input, targets })).toThrow();
  });
});
