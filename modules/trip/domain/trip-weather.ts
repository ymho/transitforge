import type { Trip, ItineraryItem } from "./trip";
import { validatePlaceCoordinate, type PlaceSnapshot } from "./place-snapshot";
import { bindRelativeSchedule, validateTimeZone, type ZonedInstant } from "./itinerary-schedule";
import { exactKeys, validInstant, validDate } from "./snapshot-validation";

export interface TripWeatherTarget {
  readonly role: "visit" | "stay" | "departure" | "arrival";
  readonly place: Pick<PlaceSnapshot, "name" | "area" | "coordinate" | "timeZone">;
  readonly startDate: string; readonly endDate: string; readonly at?: ZonedInstant;
}
export interface TripWeatherRow {
  readonly date: string; readonly hour?: string; readonly weatherCode: number;
  readonly temperatureCelsius?: number; readonly minimumTemperatureCelsius?: number; readonly maximumTemperatureCelsius?: number;
  readonly precipitationProbabilityPercent: number;
}
export interface RetainedTripForecast {
  readonly target: TripWeatherTarget;
  readonly status: "available" | "outside-forecast" | "unavailable";
  readonly locationName?: string; readonly timeZone?: string; readonly coordinate?: PlaceSnapshot["coordinate"];
  readonly rows: readonly TripWeatherRow[];
}
/** Retained forecasts are observations at fetchedAt, never current conditions or safety certification. */
export interface TripItemWeather {
  readonly itemId: string; readonly basis: string; readonly fetchedAt: string; readonly validUntil: string;
  readonly provider: "open-meteo"; readonly sourceUrl: "https://open-meteo.com/";
  readonly forecasts: readonly RetainedTripForecast[];
}
function place(value: PlaceSnapshot): TripWeatherTarget["place"] {
  return { name: value.name, ...(value.area ? { area: value.area } : {}), ...(value.coordinate ? { coordinate: value.coordinate } : {}), ...(value.timeZone ? { timeZone: value.timeZone } : {}) };
}
export function weatherDate(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}
export function tripWeatherTargets(trip: Pick<Trip, "timeline">, item: ItineraryItem): TripWeatherTarget[] {
  const target = (role: TripWeatherTarget["role"], p: PlaceSnapshot, startDate: string, endDate = startDate, at?: ZonedInstant): TripWeatherTarget =>
    ({ role, place: place(p), startDate, endDate, ...(at ? { at } : {}) });
  if (item.type === "transport") {
    if (item.detail.status !== "selected") return [];
    if (item.detail.mode === "rail") {
      const first = item.detail.journey.legs[0]!, last = item.detail.journey.legs.at(-1)!;
      return [target("departure", first.origin, weatherDate(first.scheduledDeparture.at, first.scheduledDeparture.timeZone), undefined, first.scheduledDeparture),
        target("arrival", last.destination, weatherDate(last.scheduledArrival.at, last.scheduledArrival.timeZone), undefined, last.scheduledArrival)];
    }
    if (item.schedule.type !== "fixed" || !item.schedule.endAt) return [];
    return [target("departure", item.detail.origin, weatherDate(item.schedule.startAt.at, item.schedule.startAt.timeZone), undefined, item.schedule.startAt),
      target("arrival", item.detail.destination, weatherDate(item.schedule.endAt.at, item.schedule.endAt.timeZone), undefined, item.schedule.endAt)];
  }
  const p = item.type === "activity" ? item.place : item.selection.status === "selected" ? item.selection.accommodation.place : item.selection.place;
  if (!p) return [];
  const bound = item.schedule.type === "relative" && trip.timeline ? bindRelativeSchedule(item.schedule, trip.timeline) : undefined;
  const s = bound ? { type: "day" as const, date: bound.date, endDate: bound.endDate, timeZone: bound.timeZone } : item.schedule;
  if (!s) return [];
  const role = item.type === "stay" ? "stay" : "visit";
  if (s.type === "fixed") return [target(role, p, weatherDate(s.startAt.at, s.startAt.timeZone), undefined, s.startAt)];
  if ("date" in s) return [target(role, { ...p, ...(s.timeZone && !p.timeZone ? { timeZone: s.timeZone } : {}) }, s.date, s.endDate ?? s.date)];
  // A flexible time window is a daily forecast, not an invented appointment time.
  if (s.type === "window") return [target(role, p, weatherDate(s.earliestStart.at, s.earliestStart.timeZone), weatherDate(s.latestEnd.at, s.latestEnd.timeZone))];
  return [];
}
export function tripWeatherBasis(trip: Pick<Trip, "timeline">, item: ItineraryItem): string { return JSON.stringify(tripWeatherTargets(trip, item)); }
export function currentTripWeather(trip: Trip, item: ItineraryItem): TripItemWeather | undefined {
  return trip.weather?.find(value => value.itemId === item.id && value.basis === tripWeatherBasis(trip, item));
}
export function retainTripWeather(trip: Trip, values: readonly TripItemWeather[] | undefined): readonly TripItemWeather[] | undefined {
  const result = values?.filter(value => trip.items.some(item => item.id === value.itemId && value.basis === tripWeatherBasis(trip, item)));
  return result?.length ? result : undefined;
}
export function validateTripWeather(values: readonly TripItemWeather[], trip: Trip): void {
  if (!Array.isArray(values) || values.length > 100 || new Set(values.map(v => v.itemId)).size !== values.length) throw new Error("Invalid trip weather");
  for (const value of values) {
    exactKeys(value, ["itemId", "basis", "fetchedAt", "validUntil", "provider", "sourceUrl", "forecasts"]);
    const item = trip.items.find(item => item.id === value.itemId);
    if (!item || value.basis !== tripWeatherBasis(trip, item) || !validInstant(value.fetchedAt) || !validInstant(value.validUntil) ||
        Date.parse(value.validUntil) <= Date.parse(value.fetchedAt) || value.provider !== "open-meteo" || value.sourceUrl !== "https://open-meteo.com/" ||
        !Array.isArray(value.forecasts) || JSON.stringify(value.forecasts.map((f: RetainedTripForecast) => f.target)) !== value.basis) throw new Error("Invalid weather scope");
    for (const f of value.forecasts) {
      exactKeys(f, ["target", "status", "locationName", "timeZone", "coordinate", "rows"]);
      if (!["available", "outside-forecast", "unavailable"].includes(f.status) || !Array.isArray(f.rows) || f.rows.length > 16 ||
          (f.status === "available") !== (f.rows.length > 0) || f.status === "available" && (!f.locationName?.trim() || f.locationName.length > 200 || !f.timeZone)) throw new Error("Invalid forecast");
      if (f.timeZone) validateTimeZone(f.timeZone);
      if (f.coordinate) validatePlaceCoordinate(f.coordinate);
      for (const row of f.rows) {
        exactKeys(row, ["date", "hour", "weatherCode", "temperatureCelsius", "minimumTemperatureCelsius", "maximumTemperatureCelsius", "precipitationProbabilityPercent"]);
        if (!validDate(row.date) || row.date < f.target.startDate || row.date > f.target.endDate || !Number.isInteger(row.weatherCode) || row.weatherCode < 0 || row.weatherCode > 99 ||
            !Number.isFinite(row.precipitationProbabilityPercent) || row.precipitationProbabilityPercent < 0 || row.precipitationProbabilityPercent > 100 ||
            [row.temperatureCelsius, row.minimumTemperatureCelsius, row.maximumTemperatureCelsius].some(t => t !== undefined && (!Number.isFinite(t) || t < -100 || t > 70)) ||
            (f.target.at ? !/^(?:[01]\d|2[0-3]):00$/u.test(row.hour ?? "") || row.temperatureCelsius === undefined || f.rows.length !== 1 : row.hour !== undefined || row.minimumTemperatureCelsius === undefined || row.maximumTemperatureCelsius === undefined) ||
            row.minimumTemperatureCelsius !== undefined && row.maximumTemperatureCelsius !== undefined && row.minimumTemperatureCelsius > row.maximumTemperatureCelsius) throw new Error("Invalid weather row");
      }
    }
  }
}
