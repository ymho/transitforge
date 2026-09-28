import type { ItineraryItem, Trip } from "@raiquora/trip/trip";
import { bindRelativeSchedule } from "@raiquora/trip/itinerary-schedule";
import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { WeatherForecast } from "@raiquora/trip/weather-forecast";
import type { WeatherForecastProvider } from "../../ports/weather-provider.js";

/** A forecast is useful only for the saved local day and area of this Trip gap. */
export async function tripGapWeather(trip: Trip, anchor: ItineraryItem, area: string, provider: WeatherForecastProvider,
  now = new Date()): Promise<{ forecast?: ExternalTravelInformation<WeatherForecast>; weatherContext: Record<string, unknown> }> {
  const targetDate = tripDay(trip, anchor);
  if (!targetDate || !area.trim()) return { weatherContext: { status: "unconfirmed", reason: "trip_date_or_area_missing",
    sourceRevision: trip.revision, forecastUsedForRanking: false } };
  let forecast: ExternalTravelInformation<WeatherForecast>;
  try { forecast = await provider.search({ location: area, startDate: targetDate, endDate: targetDate }); }
  catch { return { weatherContext: { status: "unavailable", reason: "provider_failed", targetDate, area,
    sourceRevision: trip.revision, forecastUsedForRanking: false } }; }
  const day = forecast.data?.daily.find(value => value.date === targetDate);
  const evidence = forecast.evidence.filter(source => source.kind === "weather" && source.confidence === "provider-forecast" &&
    Date.parse(source.retrievedAt) <= now.getTime() && source.validUntil && Date.parse(source.validUntil) >= now.getTime());
  const knownCode = day && [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].includes(day.weatherCode);
  const confirmed = forecast.status === "available" && forecast.freshness === "fresh" && day && evidence.length && knownCode &&
    Number.isFinite(day.maximumPrecipitationProbabilityPercent) && Number.isFinite(day.precipitationMillimeters) &&
    Number.isInteger(day.weatherCode) && day.maximumPrecipitationProbabilityPercent >= 0 && day.maximumPrecipitationProbabilityPercent <= 100 &&
    day.precipitationMillimeters >= 0;
  if (!confirmed || !day) return { forecast, weatherContext: { status: forecast.status === "unavailable" ? "unavailable" : "unconfirmed",
    reason: forecast.failure?.code === "invalid_request" ? "forecast_range_out" : forecast.freshness === "stale" ? "stale_forecast" :
      forecast.status === "unavailable" ? "provider_failed" : "forecast_not_verified",
    targetDate, area, sourceRevision: trip.revision, forecastUsedForRanking: false } };
  const rainRisk = day.maximumPrecipitationProbabilityPercent >= 70 || day.precipitationMillimeters >= 10 || day.weatherCode >= 95 ? "high" :
    day.maximumPrecipitationProbabilityPercent >= 30 || day.precipitationMillimeters >= 1 || day.weatherCode >= 51 ? "possible" : "low_in_reported_forecast";
  return { forecast, weatherContext: { status: "forecast", targetDate, area, sourceRevision: trip.revision,
    retrievedAt: evidence[0]!.retrievedAt, validUntil: evidence[0]!.validUntil, rainRisk,
    maximumPrecipitationProbabilityPercent: day.maximumPrecipitationProbabilityPercent,
    precipitationMillimeters: day.precipitationMillimeters, weatherCode: day.weatherCode,
    guidance: rainRisk === "high" ? "屋内候補と短い移動を比較。主目的地と確定済み予定は保持する" :
      "天候は候補比較の一要素。屋内性・営業時間・移動時間は別途確認する",
    forecastUsedForRanking: false, adopted: false } };
}

function tripDay(trip: Trip, item: ItineraryItem): string | undefined {
  const schedule = item.schedule;
  if (schedule.type === "day") return schedule.date;
  if (schedule.type === "fixed") return schedule.startAt.at.slice(0, 10);
  if (schedule.type === "window") return schedule.earliestStart.at.slice(0, 10) === schedule.latestEnd.at.slice(0, 10)
    ? schedule.earliestStart.at.slice(0, 10) : undefined;
  if (schedule.type === "relative" && trip.timeline) return bindRelativeSchedule(schedule, trip.timeline)?.date;
  return undefined;
}

/** An alternative comparison order, never a travel-time, indoor or opening-hours assertion. */
export function nearbyWeatherCandidateIds(candidates: unknown[], center: { latitude: number; longitude: number }, idField: string): string[] {
  const radians = (value: number) => value * Math.PI / 180;
  return candidates.flatMap(candidate => {
    if (!candidate || typeof candidate !== "object") return [];
    const value = candidate as Record<string, unknown>;
    if (typeof value[idField] !== "string" || typeof value.latitude !== "number" || typeof value.longitude !== "number" ||
        !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) return [];
    const latitude = radians(value.latitude - center.latitude), longitude = radians(value.longitude - center.longitude);
    const chord = Math.sin(latitude / 2) ** 2 + Math.cos(radians(center.latitude)) * Math.cos(radians(value.latitude)) * Math.sin(longitude / 2) ** 2;
    return [{ id: value[idField] as string, meters: 12_742_000 * Math.asin(Math.sqrt(chord)) }];
  }).sort((a, b) => a.meters - b.meters).slice(0, 8).map(({ id }) => id);
}
