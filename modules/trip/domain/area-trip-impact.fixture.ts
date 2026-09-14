import { createTrip } from "./trip";
import { projectTripWatches } from "./trip-watch";
import type { ItinerarySchedule } from "./itinerary-schedule";
import type { WeatherForecast } from "./weather-forecast";
import type { ExternalTravelInformation } from "./external-travel-information";
import { weatherTravelEvent, type WeatherEventTarget } from "./weather-travel-event";
import { hazardTravelEvent } from "./travel-event-projection";
import { hazardAlert, hazardInformation } from "./hazard-alert.fixture";
import type { TravelEvent } from "./travel-event";

export const areaNow = "2026-09-12T08:00:00Z";
export const areaZoned = (hour: number) => ({ at: `2026-09-12T${String(hour).padStart(2, "0")}:00:00+09:00`, timeZone: "Asia/Tokyo" });
export function weatherFixture() {
  const target: WeatherEventTarget = { subject: { type: "weather-area", area: "trusted:osaka-cell-1" },
    query: { location: "大阪", startDate: "2026-09-12", endDate: "2026-09-12" },
    location: { name: "大阪市", latitude: 34.69, longitude: 135.5 }, timezone: "Asia/Tokyo" };
  const result: ExternalTravelInformation<WeatherForecast> = { status: "available", freshness: "fresh", evidence: [{
    id: "synthetic-weather", kind: "weather", provider: "synthetic", sourceUrl: "https://example.com/forecast", confidence: "provider-forecast",
    retrievedAt: areaNow, validUntil: "2026-09-12T09:00:00Z" }], data: {
      locationName: target.location.name, latitude: target.location.latitude, longitude: target.location.longitude, timezone: target.timezone,
      hourly: [17, 18, 19, 20].map((hour) => ({ time: `2026-09-12T${hour}:00`, temperatureCelsius: 25,
        precipitationProbabilityPercent: 80, precipitationMillimeters: 3, weatherCode: 61 })), daily: [], alertsAvailable: false } };
  return { target, result };
}
export function areaWeatherEvent() { const f = weatherFixture(); return weatherTravelEvent(f.target, f.result, areaNow); }
export function areaHazardEvent() { return hazardTravelEvent({ area: "大阪府" }, hazardInformation([hazardAlert({ severity: "emergency" })]), areaNow); }
export function areaInput(event: TravelEvent = areaWeatherEvent(), schedule: ItinerarySchedule = { type: "fixed", startAt: areaZoned(17), endAt: areaZoned(18) }) {
  if (event.subject.type === "rail-service") throw new Error();
  const trip = createTrip("11111111-1111-4111-8111-111111111111", "合成の旅行", areaNow, [
    { id: "activity", type: "activity", category: "sightseeing", title: "屋外と推測してはいけない名称", schedule }]);
  const watches = projectTripWatches(trip, [{ itineraryItemId: "activity", subject: event.subject }]);
  return { trip, event, watches, evaluatedAt: areaNow };
}
