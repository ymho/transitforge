import type { WeatherForecast, WeatherForecastQuery } from "./weather-forecast";
import { externalInformationFreshness, validateExternalSourceEvidence, type ExternalTravelInformation } from "./external-travel-information";
import { exactKeys, validInstant } from "./snapshot-validation";
import { monitoringText, validateWatchSubject } from "./trip-watch";
import { travelEventId, validateTravelEvent, type TravelEvent, type WeatherEventFact } from "./travel-event";
import { forecastHourInstant, validateObservedWeatherFact, validateWeatherScope, type ObservedWeatherFact, weatherEventHourLimit } from "./weather-event-fact";

/** Supplied by a trusted scope resolver, never inferred from item titles or forecast free text. */
export interface WeatherEventTarget {
  readonly subject: { readonly type: "weather-area"; readonly area: string };
  readonly query: WeatherForecastQuery & { readonly startDate: string; readonly endDate: string };
  readonly location: ObservedWeatherFact["location"];
  readonly timezone: string;
}
export function weatherTravelEvent(target: WeatherEventTarget, result: ExternalTravelInformation<WeatherForecast>, observedAt: string): TravelEvent {
  exactKeys(target, ["subject", "query", "location", "timezone"]); validateWatchSubject(target.subject);
  exactKeys(target.query, ["location", "startDate", "endDate"]); monitoringText(target.query.location);
  if (target.subject.type !== "weather-area" || !validInstant(observedAt)) throw new Error("Invalid weather target");
  const requestedRange = { startDate: target.query.startDate, endDate: target.query.endDate };
  validateWeatherScope({ timezone: target.timezone, location: target.location, requestedRange });
  exactKeys(result, ["status", "freshness", "data", "evidence", "failure"]);
  if (!["available", "unavailable", "unknown"].includes(result.status) || !["fresh", "stale", "unknown"].includes(result.freshness) ||
      !Array.isArray(result.evidence) || result.evidence.length > 24) throw new Error("Invalid weather result");
  result.evidence.forEach(validateExternalSourceEvidence);
  if (result.status !== "available" && result.data !== undefined || result.status === "available" && (!result.data || result.failure)) throw new Error("Conflicting weather result");
  let fact: WeatherEventFact = { status: result.status === "unavailable" ? "unavailable" : "unknown", reason: result.failure ? "failed" : "missing" };
  if (result.status === "available") {
    const data = result.data!;
    if (data.locationName !== target.location.name || data.longitude !== target.location.longitude || data.latitude !== target.location.latitude || data.timezone !== target.timezone) throw new Error("Forecast target mismatch");
    if (!Array.isArray(data.hourly) || data.hourly.length > weatherEventHourLimit) throw new Error("Forecast hour bound exceeded");
    if (data.hourly.length) {
      const observed: ObservedWeatherFact = { status: "observed", precipitationPeriod: "preceding-hour", timezone: data.timezone,
        location: { name: data.locationName, longitude: data.longitude, latitude: data.latitude }, requestedRange,
        forecast: data.hourly.map((h) => ({ at: forecastHourInstant(h.time, data.timezone), temperatureCelsius: h.temperatureCelsius,
          precipitationProbabilityPercent: h.precipitationProbabilityPercent, precipitationMillimeters: h.precipitationMillimeters, weatherCode: h.weatherCode })) };
      validateObservedWeatherFact(observed); fact = observed;
    }
  }
  if (fact.status === "observed" && (!result.evidence.length || result.evidence.some((s) => s.kind !== "weather" || s.confidence !== "provider-forecast" ||
      Date.parse(s.retrievedAt) > Date.parse(observedAt) || s.observedAt !== undefined && Date.parse(s.observedAt) > Date.parse(observedAt)))) fact = { status: "unknown", reason: "invalid" };
  const computed = externalInformationFreshness(result.evidence, new Date(observedAt));
  const freshness = fact.status !== "observed" ? "unknown" : result.freshness === "stale" || computed === "stale" ? "stale" : result.freshness === "fresh" && computed === "fresh" ? "fresh" : "unknown";
  const event: TravelEvent = { id: "", kind: "weather", subject: { type: "weather-area", area: target.subject.area },
    observedAt, freshness, fact, sources: structuredClone(result.evidence), sourceEvidenceIds: [...new Set(result.evidence.map((s) => s.id))].sort() };
  const complete = { ...event, id: travelEventId(event) }; validateTravelEvent(complete); return complete;
}
