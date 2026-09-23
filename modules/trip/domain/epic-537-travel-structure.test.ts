import { describe, expect, it } from "vitest";
import { bindRelativeSchedule, bindTimelineFromAnchor, clearSequentialCalendarBindings, type TripTimeline } from "./itinerary-schedule";
import { createTrip, decodeTrip, type ItineraryItem, type Trip } from "./trip";
import { projectDailyItinerary } from "./daily-itinerary";
import { measureTripWorkload } from "./trip-workload";
import { evaluateScopedTripConstraints } from "./trip-constraint-evaluation";
import { projectTripStructure } from "./trip-structure";
import { resolvedPlace } from "./trip-places.fixture";

const tripId = "11111111-1111-4111-8111-111111111111";
const at = "2026-09-12T08:00:00Z";
const timeline: TripTimeline = { version: 1, logicalDays: [1, 2, 3, 4].map((n) => ({ id: `day-${n}`, label: `${n}日目` })), calendarBindings: [] };
const activity = (id: string, dayId: string): ItineraryItem => ({ id, title: "美術館", type: "activity", category: "sightseeing",
  logicalDayId: dayId, schedule: { type: "relative", dayId, part: "afternoon", durationMinutes: { minimum: 90, maximum: 120 } } });
const movement = (id: string, dayId: string, start: string, end: string): ItineraryItem => ({ id, title: "移動", type: "transport", logicalDayId: dayId,
  schedule: { type: "fixed", startAt: { at: start, timeZone: "Asia/Tokyo" }, endAt: { at: end, timeZone: "Asia/Tokyo" } },
  detail: { status: "selected", mode: "walk", origin: { name: `${id}-origin`, sources: [] }, destination: { name: `${id}-destination`, sources: [] }, provenance: { type: "manual" } } });

describe("Epic #537 PR3 travel structure", () => {
  it("round-trips an undated 3-night/4-day intent without inventing a calendar date", () => {
    const trip = createTrip(tripId, "日付未定", at, [activity("museum", "day-2")], { constraints: [], assumptions: [] }, "itinerary_draft", undefined, timeline);
    expect(decodeTrip(JSON.parse(JSON.stringify(trip)))).toEqual(trip);
    const day = projectDailyItinerary(trip).days.find(({ logicalDayId }) => logicalDayId === "day-2");
    expect(day).not.toHaveProperty("localDate");
    expect(day).toMatchObject({ entries: [{ sourceItemId: "museum", placement: "unbound" }] });
    expect(JSON.stringify(trip)).not.toMatch(/2026-09-1[3-9]/u);
  });

  it("binds, changes and clears dates without changing stable logical references", () => {
    const schedule = activity("museum", "day-2").schedule;
    if (schedule.type !== "relative") throw new Error("fixture");
    const first = bindTimelineFromAnchor(timeline, "day-1", "2026-12-30", "Europe/Vienna");
    const changed = bindTimelineFromAnchor(clearSequentialCalendarBindings(first), "day-1", "2028-02-28", "Europe/Vienna");
    expect(bindRelativeSchedule(schedule, first)?.date).toBe("2026-12-31");
    expect(bindRelativeSchedule(schedule, changed)?.date).toBe("2028-02-29");
    expect(bindRelativeSchedule(schedule, clearSequentialCalendarBindings(changed))).toBeUndefined();
    expect(schedule).toMatchObject({ dayId: "day-2", part: "afternoon" });
  });

  it("keeps DST elapsed time, date-line labels and an overnight item distinct", () => {
    const dst = { ...movement("dst", "day-1", "2026-10-25T02:30:00+02:00", "2026-10-25T02:30:00+01:00"),
      schedule: { type: "fixed" as const, startAt: { at: "2026-10-25T02:30:00+02:00", timeZone: "Europe/Vienna" }, endAt: { at: "2026-10-25T02:30:00+01:00", timeZone: "Europe/Vienna" } } };
    const line = { ...movement("line", "day-2", "2026-09-23T15:00:00+09:00", "2026-09-24T05:00:00+09:00"),
      schedule: { type: "fixed" as const, startAt: { at: "2026-09-22T23:00:00-07:00", timeZone: "America/Los_Angeles" }, endAt: { at: "2026-09-24T05:00:00+09:00", timeZone: "Asia/Tokyo" } } };
    const trip = createTrip(tripId, "時差", at, [dst, line], { constraints: [], assumptions: [] }, "itinerary_draft", undefined, timeline);
    const daily = projectDailyItinerary(trip);
    const workload = measureTripWorkload(trip, daily);
    expect(workload.tripTravelMinutes.knownLowerBound).toBe(900);
    expect(daily.days.flatMap(({ entries }) => entries).filter(({ sourceItemId }) => sourceItemId === "line").map(({ role, localDate }) => [role, localDate])).toEqual([
      ["start", "2026-09-22"], ["end", "2026-09-24"],
    ]);
  });

  it("projects a three-night stay once per day while keeping one source item and checkout exclusive", () => {
    const place = { ...resolvedPlace("base"), timeZone: "Europe/Vienna" };
    const stay: ItineraryItem = { id: "stay", title: "宿", type: "stay", schedule: { type: "day", date: "2026-09-20", endDate: "2026-09-23", timeZone: "Europe/Vienna" },
      selection: { status: "selected", accommodation: { provider: "fixture", providerItemId: "base", selectedAt: at, checkInDate: "2026-09-20", checkOutDate: "2026-09-23", place,
        sources: [{ id: "stay-source", kind: "accommodation", provider: "fixture", sourceId: "base", retrievedAt: at, confidence: "observed" }] } } };
    const trip = createTrip(tripId, "連泊", at, [stay]);
    const daily = projectDailyItinerary(trip);
    expect(daily.days.map(({ entries }) => entries[0]!.role)).toEqual(["start", "continue", "continue", "end"]);
    expect(new Set(daily.days.flatMap(({ entries }) => entries).map(({ sourceItemId }) => sourceItemId))).toEqual(new Set(["stay"]));
    expect(daily.days.map(({ overnightRefs }) => overnightRefs.length)).toEqual([1, 1, 1, 0]);
  });

  it("retains empty logical days and separates them from unscheduled items", () => {
    const loose: ItineraryItem = { id: "loose", title: "未配置", type: "activity", category: "free-time", schedule: { type: "unscheduled" } };
    const trip = createTrip(tripId, "空白日", at, [activity("museum", "day-2"), loose], { constraints: [], assumptions: [] }, "itinerary_draft", undefined, timeline);
    const daily = projectDailyItinerary(trip);
    expect(daily.days.filter(({ emptyReason }) => emptyReason === "not-planned").map(({ logicalDayId }) => logicalDayId)).toEqual(["day-1", "day-3", "day-4"]);
    expect(daily.unscheduled.map(({ sourceItemId }) => sourceItemId)).toEqual(["loose"]);
  });

  it("pages a 30+ day relative itinerary with explicit coverage and a stable continuation", () => {
    const longTimeline: TripTimeline = { version: 1, logicalDays: Array.from({ length: 35 }, (_, index) => ({ id: `day-${index + 1}` })), calendarBindings: [] };
    const trip = createTrip(tripId, "長期", at, [], { constraints: [], assumptions: [] }, "inspiration", undefined, longTimeline);
    const first = projectDailyItinerary(trip, { limit: 30 });
    const rest = projectDailyItinerary(trip, { cursor: first.continuation, limit: 30 });
    expect(first.coverage).toMatchObject({ complete: false, omittedCount: 5 }); expect(first.days).toHaveLength(30);
    expect(rest.coverage).toMatchObject({ complete: true, omittedCount: 0 }); expect(rest.days).toHaveLength(5);
    expect(new Set([...first.days, ...rest.days].map(({ dayKey }) => dayKey)).size).toBe(35);
  });

  it("distinguishes per-movement 90 minutes from a day-total 90 minute constraint", () => {
    const items = [movement("a", "day-2", "2026-09-22T09:00:00+09:00", "2026-09-22T10:00:00+09:00"),
      movement("b", "day-2", "2026-09-22T15:00:00+09:00", "2026-09-22T16:00:00+09:00")];
    const request = { constraints: [
      { id: "each", strength: "hard" as const, source: "user" as const, scope: { type: "trip" as const }, requirement: { type: "mobility" as const, maxTravelMinutes: 90 } },
      { id: "total", strength: "hard" as const, source: "user" as const, scope: { type: "logical-day" as const, logicalDayId: "day-2" }, requirement: { type: "aggregate_metric" as const, metric: "travel_minutes" as const, aggregation: "sum" as const, maximum: 90 } },
    ], assumptions: [] };
    const trip = createTrip(tripId, "条件", at, items, request, "itinerary_draft", undefined, timeline);
    const results = evaluateScopedTripConstraints(trip, { metrics: [{ scopeRef: "day-2", metric: "travel_minutes", knownLowerBound: 120, upperBound: 120, completeness: "complete", sourceFactRefs: ["a", "b"] }] });
    expect(results.map(({ constraintId, status }) => [constraintId, status])).toEqual([["each", "satisfied"], ["total", "violated"]]);
  });

  it("does not turn an unknown movement into zero or an apparent improvement", () => {
    const known = movement("known", "day-2", "2026-09-22T09:00:00+09:00", "2026-09-22T10:00:00+09:00");
    const before = createTrip(tripId, "負荷", at, [known], { constraints: [], assumptions: [] }, "itinerary_draft", undefined, timeline);
    const unknown: ItineraryItem = { id: "unknown", title: "未確認移動", type: "transport", logicalDayId: "day-2", schedule: { type: "relative", dayId: "day-2" }, detail: { status: "unresolved" } };
    const after = createTrip(tripId, "負荷", at, [known, unknown], { constraints: [], assumptions: [] }, "itinerary_draft", undefined, timeline);
    const a = measureTripWorkload(before, projectDailyItinerary(before));
    const b = measureTripWorkload(after, projectDailyItinerary(after));
    expect(a.tripTravelMinutes).toMatchObject({ knownLowerBound: 60, completeness: "complete" });
    expect(b.tripTravelMinutes).toMatchObject({ knownLowerBound: 60, completeness: "partial" });
    expect(b.days.find(({ dayKey }) => dayKey === "logical:day-2")?.travelMinutes.completeness).toBe("unknown");
  });

  it("keeps structure identity and authored baggage dependencies revision-bound", () => {
    const trip = createTrip(tripId, "物流", at, [activity("drop", "day-1"), activity("pickup", "day-3")], { constraints: [], assumptions: [] }, "itinerary_draft", undefined, timeline) as Trip;
    const withIntent: Trip = { ...trip, structureIntent: { version: 1, authoredSegments: [{ segmentId: "segment:base", anchorItemIds: ["drop"], logicalDayIds: ["day-1"] }],
      relations: [{ relationId: "relation:baggage", beforeItemRef: "drop", afterItemRef: "pickup", kind: "baggage-drop-pickup", status: "authored" }] } };
    const projection = projectTripStructure(withIntent);
    expect(projection.relations).toContainEqual(expect.objectContaining({ relationId: "relation:baggage", status: "authored", revision: 0 }));
    expect(projection.segments).toContainEqual(expect.objectContaining({ segmentId: "segment:base", provenance: "authored" }));
  });
});
