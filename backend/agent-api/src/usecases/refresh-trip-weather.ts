import { normalizeStationName } from "@raiquora/train/station-name";
import type { StationCatalogRepository } from "../ports/station-catalog-repository.js";
import type { Trip, ItineraryItem } from "@raiquora/trip/trip";
import { tripWeatherTargets, tripWeatherBasis, weatherDate, type TripItemWeather, type RetainedTripForecast, type TripWeatherTarget } from "@raiquora/trip/trip-weather";
import type { WeatherForecastProvider } from "../ports/weather-provider.js";

/** Server-owned provider observations, bounded to two endpoint requests and 16 daily rows. */
export async function refreshTripWeather(trip: Trip, item: ItineraryItem, provider: WeatherForecastProvider, now: Date, stations?: StationCatalogRepository, clock: () => Date = () => new Date()): Promise<TripItemWeather> {
  const targets = tripWeatherTargets(trip, item);
  if (!targets.length) throw new Error("Weather needs a place and date");
  const fetchedAt = now.toISOString(), observedTimes: string[] = [], expiryTimes: string[] = [];
  const isRail = item.type === "transport" && item.detail.status === "selected" && item.detail.mode === "rail";
  let catalog: Awaited<ReturnType<StationCatalogRepository["load"]>> | undefined;
  if (isRail && targets.some(t => !t.place.coordinate) && stations) { try { catalog = await stations.load(); } catch { /* Unresolved stations stay unavailable. */ } }

  const forecasts = await Promise.all(targets.map(async (target): Promise<RetainedTripForecast> => {
    const zone = target.at?.timeZone ?? target.place.timeZone ?? "UTC";
    const today = weatherDate(fetchedAt, zone);
    const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 15 * 86400000).toISOString().slice(0, 10);
    const startDate = target.startDate < today ? today : target.startDate, endDate = target.endDate > horizon ? horizon : target.endDate;
    if (startDate > endDate) return { target, status: "outside-forecast", rows: [] };
    try {
      let coordinate = target.place.coordinate;
      if (!coordinate && isRail) {
        const matches = catalog?.lines.flatMap(line => line.stations).filter(station => normalizeStationName(station.name) === normalizeStationName(target.place.name)) ?? [];
        const coordinates = [...new Map(matches.map(station => [JSON.stringify(station.coordinate), station.coordinate])).values()];
        if (coordinates.length !== 1) return { target, status: "unavailable", rows: [] };
        coordinate = { longitude: coordinates[0]![0], latitude: coordinates[0]![1] };
      }
      const result = await provider.search({ location: target.place.area ?? target.place.name, startDate, endDate,
        ...(coordinate ? { coordinate } : {}),
        ...(target.at?.timeZone || target.place.timeZone ? { timeZone: target.at?.timeZone ?? target.place.timeZone } : {}) });
      if (result.status !== "available" || result.freshness !== "fresh" || !result.data) return { target, status: "unavailable", rows: [] };
      // A provider records its observation during the request, after this operation starts.
      const receivedAt = Math.max(now.getTime(), clock().getTime());
      const sources = result.evidence.filter(source => source.kind === "weather" && Number.isFinite(Date.parse(source.retrievedAt)) && Date.parse(source.retrievedAt) <= receivedAt);
      if (!sources.length) return { target, status: "unavailable", rows: [] };
      observedTimes.push(...sources.map(source => source.retrievedAt));
      expiryTimes.push(...sources.map(source => source.validUntil ?? new Date(Date.parse(source.retrievedAt) + 3_600_000).toISOString()));
      const data = result.data;
      const rows = target.at ? data.hourly.filter(h => h.time.slice(0, 16) === localHour(target, data.timezone)).map(h => ({ date: target.startDate,
        hour: h.time.slice(11, 16), weatherCode: h.weatherCode, temperatureCelsius: h.temperatureCelsius, precipitationProbabilityPercent: h.precipitationProbabilityPercent }))
        : data.daily.filter(d => d.date >= startDate && d.date <= endDate).slice(0, 16).map(d => ({ date: d.date, weatherCode: d.weatherCode,
          minimumTemperatureCelsius: d.minimumTemperatureCelsius, maximumTemperatureCelsius: d.maximumTemperatureCelsius,
          precipitationProbabilityPercent: d.maximumPrecipitationProbabilityPercent }));
      if (!rows.length || target.at && rows.length !== 1) return { target, status: "unavailable", rows: [] };
      return { target, status: "available", locationName: data.locationName, timeZone: data.timezone, coordinate: { latitude: data.latitude, longitude: data.longitude }, rows };
    } catch { return { target, status: "unavailable", rows: [] }; }
  }));
  const observedAt = observedTimes.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? fetchedAt;
  const validUntil = expiryTimes.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? new Date(now.getTime() + 3_600_000).toISOString();
  return { itemId: item.id, basis: tripWeatherBasis(trip, item), fetchedAt: observedAt, validUntil,
    provider: "open-meteo", sourceUrl: "https://open-meteo.com/", forecasts };
}
function localHour(target: TripWeatherTarget, timeZone: string): string {
  const at = target.at!.at;
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(at));
  return `${weatherDate(at, timeZone)}T${hour}:00`;
}
