import { expect, it } from "vitest";
import { createTrip, type ItineraryItem } from "@raiquora/trip/trip";
import type { WeatherForecastProvider } from "../../ports/weather-provider.js";
import { tripGapWeather } from "./trip-gap-weather.js";

const now = new Date("2026-09-28T12:00:00Z");
const anchor: ItineraryItem = { id: "shrine", type: "activity", title: "出雲大社", category: "sightseeing",
  schedule: { type: "day", date: "2026-10-01" }, place: { name: "出雲大社", area: "出雲市", sources: [] },
  decision: { confirmedAt: "2026-09-27T00:00:00Z" } };
const trip = createTrip("00000000-0000-4000-8000-000000000757", "出雲", "2026-09-27T00:00:00Z", [anchor]);
const forecast = { locationName: "出雲市", latitude: 35.36, longitude: 132.75, timezone: "Asia/Tokyo", hourly: [], alertsAvailable: false,
  daily: [{ date: "2026-10-01", minimumTemperatureCelsius: 15, maximumTemperatureCelsius: 20,
    maximumPrecipitationProbabilityPercent: 80, precipitationMillimeters: 11, weatherCode: 61 }] };
const evidence = [{ id: "weather-1", kind: "weather" as const, provider: "open-meteo", sourceId: "city-1",
  retrievedAt: "2026-09-28T11:00:00Z", validUntil: "2026-09-28T13:00:00Z", confidence: "provider-forecast" as const }];

it("binds rain comparison to the saved day and leaves a confirmed destination untouched", async () => {
  const requests: unknown[] = [];
  const provider: WeatherForecastProvider = { search: async query => {
    requests.push(query); return { status: "available", freshness: "fresh", data: forecast, evidence };
  } };
  const result = await tripGapWeather(trip, anchor, "出雲市", provider, now);
  expect(requests).toEqual([{ location: "出雲市", startDate: "2026-10-01", endDate: "2026-10-01" }]);
  expect(result.weatherContext).toMatchObject({ status: "forecast", rainRisk: "high", targetDate: "2026-10-01",
    sourceRevision: 0, forecastUsedForRanking: false, adopted: false });
  expect(trip.items[0]).toEqual(anchor);
});

it("does not treat old, out-of-range or failed forecasts as clear weather", async () => {
  const cases = [
    { response: { status: "available" as const, freshness: "stale" as const, data: forecast, evidence }, reason: "stale_forecast" },
    { response: { status: "unknown" as const, freshness: "unknown" as const, evidence: [],
      failure: { code: "invalid_request" as const, message: "forecast-horizon", retryable: false } }, reason: "forecast_range_out" },
    { response: { status: "unavailable" as const, freshness: "unknown" as const, evidence: [],
      failure: { code: "timeout" as const, message: "timeout", retryable: true } }, reason: "provider_failed" },
    { response: { status: "available" as const, freshness: "fresh" as const, data: { ...forecast, daily: [{ ...forecast.daily[0]!, date: "2026-10-02" }] },
      evidence }, reason: "forecast_not_verified" },
  ];
  for (const { response, reason } of cases) {
    const provider: WeatherForecastProvider = { search: async () => response };
    const result = await tripGapWeather(trip, anchor, "出雲市", provider, now);
    expect(result.weatherContext).toMatchObject({ reason, forecastUsedForRanking: false });
    expect(result.weatherContext).not.toHaveProperty("rainRisk");
  }
});

it("does not call weather without an exact trip date or saved area", async () => {
  let calls = 0;
  const provider: WeatherForecastProvider = { search: async () => { calls++; throw new Error("should not search"); } };
  const unscheduled = { ...anchor, schedule: { type: "unscheduled" as const } };
  expect((await tripGapWeather(trip, unscheduled, "出雲市", provider, now)).weatherContext)
    .toMatchObject({ status: "unconfirmed", reason: "trip_date_or_area_missing" });
  expect((await tripGapWeather(trip, anchor, "", provider, now)).weatherContext)
    .toMatchObject({ status: "unconfirmed", reason: "trip_date_or_area_missing" });
  expect(calls).toBe(0);
});
