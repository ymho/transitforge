import { expect, it } from "vitest";
import { applyTripProposal, validateTrip, createTrip } from "./trip";
import { currentTripWeather, tripWeatherTargets } from "./trip-weather";
import { tripWeatherFixture } from "./trip-weather.fixture";
import { railSelectionFixture } from "./selected-rail-journey.fixture";
import { selectRailJourney, projectRailSchedule } from "./selected-rail-journey";
import { officialGuideSnapshot } from "./official-guide";
it("retains forecasts on titles/reorder and removes them when date/place changes; official guides omit dated forecasts", () => {
 const f = tripWeatherFixture(); validateTrip(f.trip);
 const apply = (patches: Parameters<typeof applyTripProposal>[1]["patches"]) => applyTripProposal(f.trip, { tripId: f.trip.id, baseRevision: 0, summary: "変更", patches });
 expect(apply([{ type: "title", title: "新しい旅" }]).weather).toEqual(f.trip.weather);
 expect(apply([{ type: "replace", itemId: f.item.id, item: { ...f.item, title: "新名称" } }]).weather).toEqual(f.trip.weather);
 expect(apply([{ type: "replace", itemId: f.item.id, item: { ...f.item, schedule: { type: "day", date: "2026-10-12" } } }]).weather).toBeUndefined();
 const changed = { ...f.trip, items: [{ ...f.item, schedule: { type: "unscheduled" as const } }] };
 expect(currentTripWeather(changed, changed.items[0]!)).toBeUndefined();
 expect(() => validateTrip(changed)).toThrow();
 expect(officialGuideSnapshot(f.trip).weather).toBeUndefined();
 expect(() => validateTrip({ ...f.trip, weather: [{ ...f.weather, forecasts: [{ ...f.weather.forecasts[0]!, rows: [{ ...f.weather.forecasts[0]!.rows[0]!, precipitationProbabilityPercent: 101 }] }] }] })).toThrow();
});
it("targets only the whole journey's departure and arrival, not transfers", () => {
 const f = railSelectionFixture(), journey = selectRailJourney(f.candidate, f.inputs, f.selectedAt);
 const trip = createTrip("11111111-1111-4111-8111-111111111111", "鉄道の旅", f.selectedAt, [{ id: "rail", title: "移動", type: "transport", detail: { status: "selected", mode: "rail", journey }, schedule: projectRailSchedule(journey) }]);
 const targets = tripWeatherTargets(trip, trip.items[0]!);
 expect(targets.map(t => t.role)).toEqual(["departure", "arrival"]);
 expect(targets[0]!.at).toEqual(journey.legs[0]!.scheduledDeparture);
 expect(targets[1]!.place.name).toBe(journey.legs.at(-1)!.destination.name);
 expect(targets[1]!.at).toEqual(journey.legs.at(-1)!.scheduledArrival);
});
