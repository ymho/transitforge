import { createTrip } from "./trip";
import { tripWeatherBasis, tripWeatherTargets, type TripItemWeather } from "./trip-weather";
/** Synthetic retained forecast; no live provider or user data. */
export function tripWeatherFixture() {
  const trip = createTrip("11111111-1111-4111-8111-111111111111", "町を巡る旅", "2026-10-10T00:00:00Z", [{ id: "visit", type: "activity", title: "公園", category: "sightseeing",
    place: { name: "公園", coordinate: { latitude: 35, longitude: 135 }, timeZone: "Asia/Tokyo", sources: [] }, schedule: { type: "day", date: "2026-10-11", timeZone: "Asia/Tokyo" } }]);
  const item = trip.items[0]!;
  const weather: TripItemWeather = { itemId: item.id, basis: tripWeatherBasis(trip, item), fetchedAt: "2026-10-10T01:00:00Z", validUntil: "2026-10-10T02:00:00Z",
    provider: "open-meteo", sourceUrl: "https://open-meteo.com/", forecasts: [{ target: tripWeatherTargets(trip, item)[0]!, status: "available", locationName: "公園", timeZone: "Asia/Tokyo",
      rows: [{ date: "2026-10-11", weatherCode: 61, minimumTemperatureCelsius: 15, maximumTemperatureCelsius: 22, precipitationProbabilityPercent: 80 }] }] };
  return { trip: { ...trip, weather: [weather] }, weather, item };
}
