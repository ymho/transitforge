import { describe, expect, it } from "vitest";
import { projectTripWatches, diffTripWatches, watchSubjectKey, tripWatchId, validateTripWatch, type WatchSubject } from "./trip-watch";
import { watchTrip } from "./trip-watch.fixture";
import { createTrip, type ItineraryItem } from "./trip";
import { feasibilityActivity, feasibilityInstant } from "./trip-feasibility.fixture";
import type { ItinerarySchedule } from "./itinerary-schedule";

describe("TripWatch projection", () => {
  it("projects every adopted leg, scheduled not delayed, stable across revision/title edits and pure", () => {
    const trip = watchTrip(), original = structuredClone(trip), watches = projectTripWatches(trip);
    expect(watches).toHaveLength(2);
    expect(watches[0]!.activeWindow).toMatchObject({ type: "fixed", startAt: { at: "2026-09-13T09:00:00.000+09:00" } });
    expect(watches.map((w) => w.subject)).toEqual([
      { type: "rail-service", serviceDate: "2026-09-13", serviceUid: "s1", trainNumber: "1M" },
      { type: "rail-service", serviceDate: "2026-09-13", serviceUid: "s2", trainNumber: "2M" },
    ]);
    const updated = projectTripWatches({ ...trip, revision: 1, title: "新名称" });
    expect(updated.map((w) => w.id)).toEqual(watches.map((w) => w.id));
    expect(updated.every((w) => w.sourceTripRevision === 1)).toBe(true);
    Object.assign(watches[0]!, { activeWindow: { type: "unscheduled" } });
    expect(trip).toEqual(original);
  });
  it("UID wins; date+number only fallback; opaque IDs and different dates never collapse", () => {
    const subject: WatchSubject = { type: "rail-service", serviceDate: "2026-09-13", serviceUid: "s1", trainNumber: "1M" };
    expect(watchSubjectKey(subject)).toBe(watchSubjectKey({ ...subject, trainNumber: "renumbered" }));
    expect(watchSubjectKey(subject)).not.toBe(watchSubjectKey({ ...subject, serviceUid: undefined }));
    expect(watchSubjectKey(subject)).not.toBe(watchSubjectKey({ ...subject, serviceDate: "2026-09-14" }));
    expect(() => watchSubjectKey({ ...subject, serviceDate: "" })).toThrow();
    expect(() => watchSubjectKey({ type: "rail-service", serviceDate: "2026-09-13" })).toThrow();
    expect(tripWatchId("trip", "item", { type: "rail-service", serviceDate: "2026-09-13", trainNumber: "1M" })).toContain("number");
  });
  it("does not infer unresolved/nonrail/place-name watches, and deactivates terminal plans", () => {
    const trip = watchTrip();
    expect(projectTripWatches({ ...trip, items: [{ id: "unresolved", type: "transport", title: "移動", schedule: { type: "unscheduled" }, detail: { mode: "rail", status: "unresolved" } },
      { id: "walk", type: "transport", title: "移動", schedule: { type: "unscheduled" }, detail: { mode: "walk", status: "selected", origin: { name: "大阪", sources: [] }, destination: { name: "京都", sources: [] }, provenance: { type: "manual" } } }, feasibilityActivity()] })).toEqual([]);
    expect(projectTripWatches({ ...trip, lifecycleState: "cancelled" })).toEqual([]);
  });
  it.each<ItinerarySchedule>([
    { type: "fixed", startAt: feasibilityInstant(9), endAt: feasibilityInstant(10) },
    { type: "window", earliestStart: feasibilityInstant(9), latestEnd: feasibilityInstant(12), durationMinutes: 60 },
    { type: "day", date: "2026-09-14", endDate: "2026-09-16" }, { type: "unscheduled" },
  ])("preserves trusted area watch schedule precision $type", (schedule) => {
    const item = { ...feasibilityActivity(), schedule }, trip = createTrip(watchTrip().id, "旅", watchTrip().createdAt, [item]);
    const projected = projectTripWatches(trip, [{ itineraryItemId: item.id, subject: { type: "hazard-area", area: "trusted-area" } }]);
    expect(projected[0]!.activeWindow).toEqual(schedule);
    expect(projected[0]).not.toHaveProperty("activeFrom");
  });
  it("rejects unknown watch fields and unknown resolved item references", () => {
    const trip = watchTrip(), w = projectTripWatches(trip)[0]!;
    expect(() => validateTripWatch({ ...w, notified: true } as typeof w)).toThrow();
    expect(() => projectTripWatches(trip, [{ itineraryItemId: "missing", subject: { type: "weather-area", area: "area" } }])).toThrow();
  });
});

describe("Watch differential sync", () => {
  it("retries unchanged, replaces subjects explicitly, retains inactive history and never mutates input", () => {
    const trip = watchTrip(), desired = projectTripWatches(trip), existing = desired.map((watch) => ({ watch, active: true }));
    const original = structuredClone(existing);
    expect(diffTripWatches(trip.id, 0, existing, desired)).toEqual({ unchanged: existing, writes: [] });
    const next = desired.map((w) => ({ ...w, sourceTripRevision: 1 }));
    expect(diffTripWatches(trip.id, 1, existing, next).writes).toHaveLength(2);
    const replacement = { ...next[0]!, subject: { type: "rail-service" as const, serviceDate: "2026-09-14", serviceUid: "new" } };
    replacement.id = tripWatchId(trip.id, replacement.itineraryItemId, replacement.subject);
    const diff = diffTripWatches(trip.id, 1, existing, [replacement]);
    expect(diff.writes.filter((r) => r.active)).toHaveLength(1);
    expect(diff.writes.filter((r) => !r.active)).toHaveLength(2);
    expect(diffTripWatches(trip.id, 1, diff.writes, [replacement]).writes).toEqual([]);
    expect(existing).toEqual(original);
    expect(() => diffTripWatches(trip.id, 0, diff.writes, desired)).toThrow();
  });
  it("supports single leg and added/removed item projections", () => {
    const trip = watchTrip(), rail = trip.items[0]!;
    if (rail.type !== "transport" || rail.detail.status !== "selected" || rail.detail.mode !== "rail") throw new Error();
    const journey = { ...rail.detail.journey, legs: rail.detail.journey.legs.slice(0, 1), transfers: [],
      provenance: { ...rail.detail.journey.provenance, sources: rail.detail.journey.provenance.sources.slice(0, 1), timetableInputs: rail.detail.journey.provenance.timetableInputs.slice(0, 1) } };
    const item: ItineraryItem = { ...rail, detail: { ...rail.detail, journey }, schedule: { type: "fixed", startAt: journey.legs[0]!.scheduledDeparture, endAt: journey.legs[0]!.scheduledArrival } };
    expect(projectTripWatches({ ...trip, items: [item] })).toHaveLength(1);
    expect(projectTripWatches({ ...trip, items: [item, { ...item, id: "another" }] })).toHaveLength(2);
    expect(projectTripWatches({ ...trip, items: [] })).toHaveLength(0);
  });
});
