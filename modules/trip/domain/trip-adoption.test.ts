import { describe, expect, it } from "vitest";
import { applyTripProposal, type Trip, type TripPatch } from "./trip";
import { classifyTrips, tripAdoptionConfirmationKey, canConfirmTrip } from "./trip-adoption";
import { requestTrip, requestRailItem } from "./trip-request.fixture";

const clock = { now: () => new Date("2026-09-12T08:00:00Z") };
const dayTrip = (date = "2026-09-20"): Trip => requestTrip(undefined, [{ id: "walk", title: "散策", type: "activity", category: "free-time",
  schedule: { type: "day", date, timeZone: "Asia/Tokyo" } }]);
const propose = (trip: Trip, patches: TripPatch[]) => ({ tripId: trip.id, baseRevision: trip.revision, summary: "確認", patches });
function confirm(trip: Trip) {
  const proposal = propose(trip, [{ type: "adoption", action: "confirm" }]);
  return applyTripProposal(trip, proposal, { clock, confirmedAdoption: tripAdoptionConfirmationKey(proposal) });
}

describe("explicit trip adoption independent of certification", () => {
  it("keeps draft and legacy ready unconfirmed; confirms without inventing feasibility, price or bookings", () => {
    const trip = dayTrip();
    expect(classifyTrips([trip, { ...trip, planningState: "ready" }], clock).every((x) => x.group === "planning")).toBe(true);
    const selected = confirm(trip);
    expect(selected.adoption).toEqual({ confirmedAt: clock.now().toISOString() });
    expect(selected.planningState).toBe(trip.planningState);
    expect(selected.request).toEqual(trip.request);
    expect(selected.items).toEqual(trip.items);
    expect(selected.revision).toBe(trip.revision);
    expect(trip.adoption).toBeUndefined();
  });
  it("requires exact separately confirmed proposal and rejects absent dates/empty/terminal", () => {
    const trip = dayTrip(), proposal = propose(trip, [{ type: "adoption", action: "confirm" }]);
    expect(() => applyTripProposal(trip, proposal)).toThrow();
    expect(() => applyTripProposal(trip, proposal, { clock, confirmedAdoption: "confirm" })).toThrow();
    for (const invalid of [requestTrip(), { ...trip, items: [{ ...trip.items[0]!, schedule: { type: "unscheduled" as const } }] },
      { ...trip, lifecycleState: "completed" as const }, { ...trip, lifecycleState: "cancelled" as const }]) {
      expect(canConfirmTrip(invalid)).toBe(false);
      expect(() => confirm(invalid)).toThrow();
    }
  });
  it("preserves intent metadata but requires review after schedule change; label-only edits preserve confirmation", () => {
    const trip = confirm(dayTrip());
    const changed = applyTripProposal(trip, propose(trip, [{ type: "replace", itemId: "walk", item: dayTrip("2026-09-21").items[0]! }]));
    expect(changed.adoption).toEqual({ ...trip.adoption, needsReconfirmation: true });
    expect(classifyTrips([changed], clock)[0]?.group).toBe("planning");
    expect(confirm(changed).adoption?.needsReconfirmation).toBeUndefined();
    const label = applyTripProposal(trip, propose(trip, [{ type: "replace", itemId: "walk", item: { ...trip.items[0]!, title: "旅先を散策" } }]));
    expect(label.adoption).toEqual(trip.adoption);
    const withdrawal = propose(trip, [{ type: "adoption", action: "withdraw" }]);
    expect(applyTripProposal(trip, withdrawal, { confirmedAdoption: tripAdoptionConfirmationKey(withdrawal) }).adoption).toBeUndefined();
  });
  it("shares stable next-trip ordering and reclassifies date changes without mutating inputs", () => {
    const first = confirm(dayTrip()), second = { ...confirm(dayTrip()), id: "22222222-2222-4222-8222-222222222222" };
    const before = structuredClone([second, first]);
    expect(classifyTrips(before, clock).map((r) => [r.trip.id, r.group])).toEqual([[first.id, "next"], [second.id, "scheduled"]]);
    expect(before).toEqual([second, first]);
    const moved = confirm({ ...first, items: dayTrip("2026-09-22").items });
    expect(classifyTrips([moved, second], clock)[0]?.trip.id).toBe(second.id);
  });
  it.each([
    ["2026-09-19T14:59:59Z", "next"], ["2026-09-19T15:00:00Z", "current"],
    ["2026-09-20T14:59:59Z", "current"], ["2026-09-20T15:00:00Z", "past-plan"],
  ])("keeps JST day precision at %s without completing the trip", (now, group) => {
    const trip = confirm(dayTrip());
    expect(classifyTrips([trip], { now: () => new Date(now) })[0]?.group).toBe(group);
    expect(trip.lifecycleState).toBe("pre_trip");
  });
  it("keeps past drafts, explicit completed/cancelled, unknown dates and checkout exclusive distinct", () => {
    const now = { now: () => new Date("2026-09-20T15:00:00Z") };
    expect(classifyTrips([dayTrip()], now)[0]?.group).toBe("past-plan");
    for (const state of ["cancelled", "completed"] as const) {
      expect(classifyTrips([{ ...confirm(dayTrip()), lifecycleState: state }], clock)[0]?.group).toBe(state);
    }
    expect(classifyTrips([requestTrip()], clock)[0]?.group).toBe("planning");
    const span = confirm({ ...dayTrip(), items: [{ ...dayTrip().items[0]!, schedule: { type: "day", date: "2026-09-20", endDate: "2026-09-21", timeZone: "Asia/Tokyo" } }] });
    expect(classifyTrips([span], now)[0]?.group).toBe("past-plan");
    expect(span.items[0]?.schedule.type).toBe("day");
  });
  it("uses rail instants independent of the browser timezone and never edits scheduled facts", () => {
    const rail = requestRailItem(), trip = confirm(requestTrip(undefined, [rail]));
    if (rail.schedule.type !== "fixed") throw new Error("fixture");
    const startAt = rail.schedule.startAt.at;
    expect(classifyTrips([trip], { now: () => new Date(startAt) })[0]?.group).toBe("current");
    expect(trip.items[0]).toEqual(rail);
  });
});
