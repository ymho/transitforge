import { describe, expect, it } from "vitest";
import { applyTripProposal, createTrip, type ItineraryItem } from "./trip";
import { projectRailSchedule, selectRailJourney, revalidateSelectedRailJourney } from "./selected-rail-journey";
import { railSelectionFixture } from "./selected-rail-journey.fixture";
import { projectStaySchedule } from "./itinerary-schedule";

const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-09-12T08:00:00Z";
describe("Trip schedule invariant", () => {
  it("requires an explicit schedule rather than defaulting missing V2 fields", () => {
    const item = { id: "rail", title: "移動", type: "transport", detail: { status: "unresolved" } };
    expect(() => createTrip(id, "旅", at, [item as ItineraryItem])).toThrow();
  });
  it("projects only selected scheduled rail facts and rejects a separate schedule truth", () => {
    const { candidate, inputs, selectedAt } = railSelectionFixture();
    const journey = selectRailJourney(candidate, inputs, selectedAt);
    const schedule = projectRailSchedule(journey);
    const item: ItineraryItem = { id: "rail", title: "移動", type: "transport", schedule, detail: { status: "selected", mode: "rail", journey } };
    const trip = createTrip(id, "旅", at, [item]);
    expect(schedule.startAt.at).toBe("2026-09-13T09:00:00.000+09:00");
    expect(schedule.endAt!.at).toBe("2026-09-13T10:40:00.000+09:00");
    expect(JSON.stringify(trip)).not.toMatch(/delay|congestion|estimate|journeys/);
    expect(revalidateSelectedRailJourney(journey, inputs)).toBe(true);
    for (const changed of [
      { type: "unscheduled" as const },
      { type: "fixed" as const, startAt: schedule.startAt },
      { ...schedule, startAt: { at: "2026-09-13T09:10:00+09:00", timeZone: "Asia/Tokyo" } },
    ]) {
      expect(() => applyTripProposal(trip, { tripId: id, baseRevision: 0, summary: "時刻変更", patches: [
        { type: "replace", itemId: item.id, item: { ...item, schedule: changed } },
      ] })).toThrow();
    }
    expect(trip.items[0]!.schedule).toEqual(schedule);
    expect(schedule.startAt).not.toBe(journey.legs[0]!.scheduledDeparture);
  });
  it("projects a multi-day rail schedule without dropping date rollover", () => {
    const { candidate, inputs, selectedAt } = railSelectionFixture();
    for (const leg of candidate.journey.legs) {
      leg.scheduledDepartureTimeMinutes! += 880; leg.scheduledArrivalTimeMinutes! += 880;
    }
    for (const input of inputs) for (const train of input.index.trains) for (const stop of train.stops) stop.route_time_minutes! += 880;
    const schedule = projectRailSchedule(selectRailJourney(candidate, inputs, selectedAt));
    expect(schedule.startAt.at).toBe("2026-09-13T23:40:00.000+09:00");
    expect(schedule.endAt!.at).toBe("2026-09-14T01:20:00.000+09:00");
  });
  it("keeps selected stay dates authoritative, including an explicit place zone", () => {
    const accommodation = { provider: "fixture", providerItemId: "hotel", place: { name: "宿", timeZone: "Europe/Vienna", sources: [] }, selectedAt: at,
      checkInDate: "2026-09-22", checkOutDate: "2026-09-24", sources: [
        { id: "hotel", kind: "accommodation" as const, provider: "fixture", sourceId: "hotel", retrievedAt: at, confidence: "observed" as const },
      ] };
    const item: ItineraryItem = { id: "stay", title: "宿", type: "stay", schedule: projectStaySchedule(accommodation.checkInDate, accommodation.checkOutDate, accommodation.place.timeZone),
      selection: { status: "selected", accommodation } };
    expect(() => createTrip(id, "旅", at, [item])).not.toThrow();
    expect(() => createTrip(id, "旅", at, [{ ...item, schedule: { type: "day", date: "2026-09-22", endDate: "2026-09-25", timeZone: "Europe/Vienna" } }])).toThrow();
    expect(() => createTrip(id, "旅", at, [{ ...item, schedule: { type: "day", date: "2026-09-22", endDate: "2026-09-24" } }])).toThrow();
  });
  it("updates schedule by atomic replace without adding a writer/revision mutation", () => {
    const item: ItineraryItem = { id: "manual", title: "移動", type: "transport", detail: { status: "unresolved" }, schedule: { type: "unscheduled" } };
    const trip = createTrip(id, "旅", at, [item]);
    const replacement = { ...item, schedule: { type: "day" as const, date: "2026-09-22" } };
    const patch = { type: "replace" as const, itemId: item.id, item: replacement };
    const updated = applyTripProposal(trip, { tripId: id, baseRevision: 0, summary: "日付指定", patches: [patch] });
    expect(updated.items[0]!.schedule).toEqual(replacement.schedule);
    expect(updated.revision).toBe(0); expect(updated.updatedAt).toBe(at);
    expect(() => applyTripProposal(trip, { tripId: id, baseRevision: 0, summary: "不正", patches: [patch, { ...patch, item: { ...replacement, schedule: { type: "day", date: "2026-02-30" } } }] })).toThrow();
    expect(trip.items[0]!.schedule).toEqual({ type: "unscheduled" });
  });
});
