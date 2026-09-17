import { describe, expect, it } from "vitest";
import { buildInTripContext, contextLocation, validateInTripContext, type ContextLocation } from "./in-trip-context";
import { inTripFixture } from "./in-trip-context.fixture";
import { createTrip, type ItineraryItem } from "./trip";
import type { ItinerarySchedule } from "./itinerary-schedule";
import { tripImpactId } from "./trip-impact";

const at = (time: string, zone = "UTC") => ({ at: time, timeZone: zone });
const now = at("2026-09-20T12:00:00Z");
const fixed = (start: string, end?: string): ItinerarySchedule => ({ type: "fixed", startAt: at(start), ...(end ? { endAt: at(end) } : {}) });
function tripWith(schedules: ItinerarySchedule[]) {
  return { ...createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-09-01T00:00:00Z", schedules.map((schedule, i): ItineraryItem => ({
    id: `item-${i}`, title: `予定${i}`, type: "activity", category: "free-time", schedule }))), lifecycleState: "in_trip" as const };
}
describe("bounded in-trip read model", () => {
  it("classifies fixed current/overlap/previous/next, excludes past history and remains pure", () => {
    const trip = tripWith([fixed("2026-09-20T10:00:00Z", "2026-09-20T11:00:00Z"),
      fixed("2026-09-20T11:00:00Z", "2026-09-20T13:00:00Z"), fixed("2026-09-20T11:30:00Z", "2026-09-20T12:30:00Z"),
      ...Array.from({ length: 12 }, () => fixed("2026-09-20T14:00:00Z", "2026-09-20T15:00:00Z"))]);
    const before = JSON.stringify(trip), s = buildInTripContext(trip, now)!; validateInTripContext(s);
    expect(s.itinerary.previous.map((i) => i.itemId)).toEqual(["item-0"]);
    expect(s.itinerary.current.map((i) => i.itemId)).toEqual(["item-1", "item-2"]);
    expect(s.itinerary.next).toHaveLength(2); expect(s.itinerary.upcoming).toHaveLength(4);
    expect(s.itinerary.omitted).toBe(6); expect(s.truncation.truncated).toBe(true);
    expect(s.location).toEqual({ status: "not-requested" }); expect(JSON.stringify(trip)).toBe(before);
  });
  it("keeps window/day/unscheduled and missing fixed end precision", () => {
    const s = buildInTripContext(tripWith([{ type: "window", earliestStart: at("2026-09-20T11:00:00Z"), latestEnd: at("2026-09-20T15:00:00Z") },
      { type: "day", date: "2026-09-20", timeZone: "UTC" }, { type: "unscheduled" }, fixed("2026-09-20T11:00:00Z")]), now)!;
    expect(s.itinerary.current.map((i) => i.position)).toEqual(["possible-current", "date-current"]);
    expect(s.itinerary.uncertain.map((i) => i.position)).toEqual(["unknown", "unknown"]);
    expect(s.itinerary.current[1]!.schedule).not.toHaveProperty("startAt");
  });
  it("uses local date across midnight, exclusive checkout and unknown zone", () => {
    const trip = tripWith([{ type: "day", date: "2026-09-21", timeZone: "Asia/Tokyo" },
      { type: "day", date: "2026-09-20", endDate: "2026-09-21", timeZone: "Asia/Tokyo" }, { type: "day", date: "2026-09-21" }]);
    const s = buildInTripContext(trip, at("2026-09-20T15:01:00Z"))!;
    expect(s.itinerary.current[0]?.itemId).toBe("item-0"); expect(s.itinerary.previous[0]?.itemId).toBe("item-1");
    expect(s.itinerary.uncertain[0]?.itemId).toBe("item-2");
  });
  it("handles repeated DST wall times with explicit offsets", () => {
    const trip = tripWith([{ type: "fixed", startAt: at("2026-11-01T01:30:00-04:00", "America/New_York"), endAt: at("2026-11-01T01:30:00-05:00", "America/New_York") }]);
    expect(buildInTripContext(trip, at("2026-11-01T06:00:00Z"))!.itinerary.current).toHaveLength(1);
  });
  it.each(["pre_trip", "completed", "cancelled"] as const)("does not activate for %s", (lifecycleState) => {
    const f = inTripFixture(); expect(buildInTripContext({ ...f.trip, lifecycleState }, f.now)).toBeUndefined();
  });
  it("projects typed rail facts without internal impact/event IDs or provenance", () => {
    const f = inTripFixture(); validateInTripContext(f.snapshot);
    expect(f.snapshot.impacts.items[0]?.facts.some((fact) => fact.type === "connection-buffer")).toBe(true);
    expect(JSON.stringify(f.snapshot)).not.toMatch(/eventId|impactId|sourceUrl|owner|dedupeKey|episodeId/);
  });
  it("keeps unknown; excludes historical, stale and unconfirmed rather than declaring safety", () => {
    const f = inTripFixture(), unknown = { ...f.impact, status: "unknown" as const, severity: "informational" as const };
    unknown.id = tripImpactId(unknown);
    expect(buildInTripContext(f.trip, f.now, { ...f.facts, impacts: [{ ...f.facts.impacts![0]!, impact: unknown }] })!.impacts.items[0]?.status).toBe("unknown");
    for (const changes of [{ fresh: false }, { expiresAt: f.now.at }, { impact: { ...f.impact, tripRevision: 99 } }]) {
      const value = { ...f.facts.impacts![0]!, ...changes }; value.impact = { ...value.impact, id: tripImpactId(value.impact) };
      const s = buildInTripContext(f.trip, f.now, { impacts: [value] })!;
      expect(s.impacts.items).toEqual([]); expect(s.impacts.status).toBe("unknown");
    }
  });
  it("bounds facts and rejects provider raw and private keys", () => {
    const f = inTripFixture();
    expect(() => validateInTripContext({ ...f.snapshot, owner: "PRIVATE" } as never)).toThrow();
    const bad = structuredClone(f.snapshot); Object.assign(bad.impacts.items[0]!.facts[0]!, { raw: "PRIVATE" });
    expect(() => validateInTripContext(bad)).toThrow();
    const impact = { ...f.impact, facts: Array.from({ length: 20 }, () => f.impact.facts[0]!) }; impact.id = tripImpactId(impact);
    const s = buildInTripContext(f.trip, f.now, { impacts: [{ ...f.facts.impacts![0]!, impact }] })!;
    expect(s.impacts.items[0]!.facts).toHaveLength(4); expect(s.impacts.items[0]!.truncated).toBe(true);
  });
  it("distinguishes read failure from empty reservations and never leaks booking private values", () => {
    const f = inTripFixture();
    expect(buildInTripContext(f.trip, f.now, { unavailable: ["reservations"] })!.reservations.status).toBe("unavailable");
    const r = { reservationId: "11111111-1111-4111-8111-111111111111", revision: 0, kind: "accommodation" as const, status: "booked" as const, startsAt: f.now };
    const s = buildInTripContext(f.trip, f.now, { reservations: [r] })!;
    expect(s.reservations.items[0]).toMatchObject({ status: "booked", startsAt: f.now }); validateInTripContext(s);
    expect(JSON.stringify(s)).not.toContain("reservationId");
    expect(() => buildInTripContext(f.trip, f.now, { reservations: [{ ...r, bookingReference: "PRIVATE" } as never] })).toThrow();
  });
  it.each(["not-requested", "permission-denied", "unavailable"] as const)("keeps location %s without inference", (status) => {
    expect(contextLocation({ status }, now)).toEqual({ status });
  });
  it("requires explicit recent location consent and does not change Trip", () => {
    const f = inTripFixture(), before = JSON.stringify(f.trip);
    const location: ContextLocation = { status: "available", consent: "explicit", observedAt: f.now.at, longitude: 135, latitude: 35, accuracyMeters: 20 };
    const s = buildInTripContext(f.trip, f.now, {}, location)!; validateInTripContext(s);
    expect(s.location).toEqual(location); expect(JSON.stringify(f.trip)).toBe(before);
    expect(contextLocation({ ...location, consent: undefined } as never, f.now).status).toBe("unavailable");
    expect(contextLocation({ ...location, longitude: Infinity }, f.now).status).toBe("unavailable");
    expect(contextLocation({ ...location, observedAt: "2020-01-01T00:00:00Z" }, f.now).status).toBe("unavailable");
  });
  it("keeps notification current/historical/unconfirmed and omits IDs", () => {
    const f = inTripFixture();
    const notifications = (["current", "historical", "unconfirmed"] as const).map((currency) => ({
      id: "a".repeat(64), version: 0, tripId: f.trip.id, tripRevision: f.trip.revision, itemIds: [f.trip.items[0]!.id],
      severity: "attention" as const, status: "sent" as const, phase: "warning" as const, createdAt: f.now.at, message: "未確認事項があります", currency,
    }));
    const s = buildInTripContext(f.trip, f.now, { notifications })!; validateInTripContext(s);
    expect(s.notifications.items.map((n) => n.currency)).toEqual(["current", "historical", "unconfirmed"]);
    expect(JSON.stringify(s.notifications)).not.toContain('"id"');
    expect(buildInTripContext({ ...f.trip, revision: f.trip.revision + 1 }, f.now, { notifications })!.notifications.items.every((n) => n.currency === "historical")).toBe(true);
  });
});
