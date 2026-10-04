import { expect, it } from "vitest";
import { createTrip, applyTripProposal, validateTrip } from "./trip";
import { multiCityTrip } from "./trip-places.fixture";
import { proposeTripItemChange } from "./trip-item-proposal";
import { projectDailyItinerary } from "./daily-itinerary";
import { railSelectionFixture } from "./selected-rail-journey.fixture";
import { selectRailJourney, projectRailSchedule } from "./selected-rail-journey";

it("stores planned stay times independently, retains daily start/end projection, and rechecks decisions", () => {
  const original = multiCityTrip(), before = structuredClone(original);
  const proposal = proposeTripItemChange(original, { action: "set-stay-planned-time", itemId: "hotel", plannedTiming: {
    checkIn: { at: "2026-09-22T15:00:00+02:00", timeZone: "Europe/Vienna" }, checkOut: { at: "2026-09-23T10:00:00+02:00", timeZone: "Europe/Vienna" } } });
  const next = applyTripProposal(original, proposal);
  expect(original).toEqual(before); expect(next.items[1]?.schedule).toEqual(original.items[1]?.schedule);
  expect(projectDailyItinerary(next).days.flatMap(d => d.entries.filter(e => e.sourceItemId === "hotel").map(e => e.role))).toEqual(["start", "end"]);
  validateTrip(JSON.parse(JSON.stringify(next)));
  expect(() => proposeTripItemChange(original, { action: "set-stay-planned-time", itemId: "hotel", plannedTiming: { checkOut: { at: "2026-09-22T10:00:00+02:00", timeZone: "Europe/Vienna" } } })).toThrow();
});
it("inserts after an unscheduled spot, edits manual times, and rejects altering a provider rail schedule", () => {
  const original = multiCityTrip();
  expect(proposeTripItemChange(original, { action: "add-activity", itemId: "after", dayKey: "unscheduled", afterId: "activity", title: "休憩", category: "free-time" }).patches[0]).toMatchObject({ afterId: "activity" });
  const timed = applyTripProposal(original, proposeTripItemChange(original, { action: "set-planned-time", itemId: "activity", startAt: { at: "2026-09-24T10:00:00+02:00", timeZone: "Europe/Zurich" } }));
  expect(timed.items[2]?.schedule.type).toBe("fixed");
  const fixture = railSelectionFixture(), journey = selectRailJourney(fixture.candidate, fixture.inputs, fixture.selectedAt);
  const rail = createTrip(original.id, "鉄道", original.createdAt, [{ id: "rail", title: "鉄道", type: "transport", detail: { status: "selected", mode: "rail", journey }, schedule: projectRailSchedule(journey) }]);
  expect(() => proposeTripItemChange(rail, { action: "set-planned-time", itemId: "rail", startAt: journey.legs[1]!.scheduledDeparture })).toThrow();
});
