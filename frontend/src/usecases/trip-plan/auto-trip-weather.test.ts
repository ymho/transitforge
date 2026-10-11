import { expect, it, vi } from "vitest";
import { tripWeatherFixture } from "../../../../modules/trip/domain/trip-weather.fixture";
import { tripWeatherBasis } from "@raiquora/trip/trip-weather";
import { createAutoTripWeather } from "./auto-trip-weather";

it("serializes items at current revisions, reuses 24h observations and retries changed scopes", async () => {
  const f = tripWeatherFixture(); let trip = { ...f.trip, weather: undefined }, now = Date.parse("2026-10-11T01:00:00Z");
  const refresh = vi.fn(async current => { expect(current.revision).toBe(trip.revision); trip = { ...trip, revision: trip.revision + 1 }; });
  const identity = {};
  const auto = createAutoTripWeather({ current: () => trip, identity: () => identity, enabled: () => true, refresh, now: () => now });
  await auto.trigger(); await auto.trigger(); expect(refresh).toHaveBeenCalledOnce();
  now += 86_400_000 - 1; await auto.trigger(); expect(refresh).toHaveBeenCalledOnce();
  now++; await auto.trigger(); expect(refresh).toHaveBeenCalledTimes(2);
  trip = { ...trip, items: [{ ...f.item, schedule: { type: "day", date: "2026-10-13" } }] };
  await auto.trigger(); expect(refresh).toHaveBeenCalledTimes(3); auto.destroy();
});

it("does not loop failed requests or issue them for disabled/viewer screens", async () => {
  const f = tripWeatherFixture(), identity = {}; let enabled = false;
  const refresh = vi.fn(async () => { throw new Error("network"); });
  const auto = createAutoTripWeather({ current: () => f.trip, identity: () => identity, enabled: () => enabled, refresh, now: () => Date.parse("2026-10-12T00:00:00Z") });
  await auto.trigger(); expect(refresh).not.toHaveBeenCalled(); enabled = true;
  await auto.trigger(); await auto.trigger(); expect(refresh).toHaveBeenCalledOnce();
  auto.destroy(); await auto.trigger(); expect(refresh).toHaveBeenCalledOnce();
});

it("reuses a recent unsuccessful observation after reload instead of retrying it", async () => {
  const f = tripWeatherFixture(), checkedAt = "2026-10-11T00:00:00Z";
  const trip = { ...f.trip, weather: [{ ...f.weather, checkedAt, basis: tripWeatherBasis(f.trip, f.item), forecasts: [{ target: f.weather.forecasts[0]!.target, status: "unavailable" as const, rows: [] }] }] };
  const refresh = vi.fn(async () => {});
  await createAutoTripWeather({ current: () => trip, identity: () => trip, enabled: () => true, refresh, now: () => Date.parse(checkedAt) + 1 }).trigger();
  expect(refresh).not.toHaveBeenCalled();
});
