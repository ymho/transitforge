import { describe, expect, it } from "vitest";
import { assessTripTime } from "./trip-temporal";
import { applyTripProposal } from "./trip";
import type { ItinerarySchedule } from "./itinerary-schedule";
import { requestTrip, requestConstraint } from "./trip-request.fixture";

const now = "2026-09-12T15:30:00Z"; // Tokyo 9/13 00:30, Vienna 9/12 17:30
const clock = { now: () => new Date(now) };
const fixed = (start: string, end?: string, timeZone = "Asia/Tokyo"): ItinerarySchedule => ({ type: "fixed",
  startAt: { at: start, timeZone }, ...(end ? { endAt: { at: end, timeZone } } : {}) });
function tripFor(...schedules: ItinerarySchedule[]) {
  return requestTrip(undefined, schedules.map((schedule, index) => ({ id: `item-${index}`, title: "予定", type: "stay", selection: { status: "unselected" }, schedule })));
}
describe("adopted schedule temporal assessment", () => {
  it.each([
    [fixed("2026-09-13T01:00:00+09:00", "2026-09-13T02:00:00+09:00"), "upcoming", "pre_trip", "instant"],
    [fixed("2026-09-12T23:00:00+09:00", "2026-09-13T01:00:00+09:00"), "current", "in_trip", "instant"],
    [fixed("2025-09-22T08:00:00+09:00", "2025-09-22T20:00:00+09:00"), "past", undefined, "instant"],
    [fixed("2026-09-12T17:00:00+02:00", "2026-09-12T18:00:00+02:00", "Europe/Vienna"), "current", "in_trip", "instant"],
    [fixed("2026-09-12T23:00:00+09:00"), "unknown", undefined, "unknown"],
    [{ type: "day", date: "2026-09-13", timeZone: "Asia/Tokyo" }, "current", undefined, "bounded"],
    [{ type: "day", date: "2026-09-13", timeZone: "Europe/Vienna" }, "upcoming", "pre_trip", "bounded"],
    [{ type: "day", date: "2026-09-12", endDate: "2026-09-13", timeZone: "Asia/Tokyo" }, "past", undefined, "bounded"],
    [{ type: "day", date: "2025-09-22" }, "unknown", undefined, "unknown"],
    [{ type: "unscheduled" }, "unknown", undefined, "unknown"],
    [{ type: "window", earliestStart: { at: "2026-09-12T23:00:00+09:00", timeZone: "Asia/Tokyo" }, latestEnd: { at: "2026-09-13T01:00:00+09:00", timeZone: "Asia/Tokyo" } }, "current", undefined, "bounded"],
  ] as const)("preserves schedule precision: %j", (schedule, position, suggestedLifecycle, precision) => {
    const trip = tripFor(schedule); const before = structuredClone(trip);
    const result = assessTripTime(trip, clock);
    expect(result).toMatchObject({ position, precision, assessedAt: now.replace("Z", ".000Z") });
    expect(result.suggestedLifecycle).toBe(suggestedLifecycle);
    expect(trip).toEqual(before);
  });
  it("derives the trip span from all adopted items, including between fixed items", () => {
    const trip = tripFor(fixed("2026-09-12T22:00:00+09:00", "2026-09-12T23:00:00+09:00"),
      fixed("2026-09-13T02:00:00+09:00", "2026-09-13T03:00:00+09:00"));
    expect(assessTripTime(trip, clock)).toMatchObject({ position: "current", suggestedLifecycle: "in_trip" });
    expect(assessTripTime(tripFor(...trip.items.map((i) => i.schedule), { type: "unscheduled" }), clock).position).toBe("unknown");
  });
  it("treats exact end as past, never automatically completed", () => {
    const trip = tripFor(fixed("2026-09-13T00:00:00+09:00", "2026-09-13T00:30:00+09:00"));
    expect(assessTripTime(trip, clock)).toMatchObject({ position: "past" });
    expect(() => applyTripProposal(trip, { tripId: trip.id, summary: "完了", patches: [{ type: "lifecycle", state: "completed", basis: "schedule" }] }, { clock })).toThrow();
  });
  it("request dates alone are never trip-period evidence", () => {
    const trip = requestTrip({ constraints: [requestConstraint({ type: "dates", start: { earliest: "2026-09-12", latest: "2026-09-13" } })], assumptions: [] });
    expect(assessTripTime(trip, clock).position).toBe("unknown");
    expect(assessTripTime(trip, clock).suggestedLifecycle).toBeUndefined();
  });
  it.each(["cancelled", "completed"] as const)("keeps %s separate from temporal position", (lifecycleState) => {
    const trip = { ...tripFor(fixed("2026-09-12T23:00:00+09:00", "2026-09-13T01:00:00+09:00")), lifecycleState };
    expect(assessTripTime(trip, clock).position).toBe("current");
    expect(assessTripTime(trip, clock).suggestedLifecycle).toBeUndefined();
  });
  it("rejects missing/invalid zones, invalid instants and invalid clocks instead of defaulting", () => {
    expect(() => assessTripTime(tripFor({ type: "unscheduled" }), { now: () => new Date(NaN) })).toThrow();
    expect(() => assessTripTime({ items: [{ id: "x", schedule: fixed("2026-09-12T23:00:00+09:00", undefined, "bad") }] as never, lifecycleState: "pre_trip" }, clock)).toThrow();
  });
});
