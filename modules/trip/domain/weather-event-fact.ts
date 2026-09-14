import { exactKeys, validInstant, validDate } from "./snapshot-validation";
import { validateTimeZone, validateZonedInstant, type ZonedInstant } from "./itinerary-schedule";
import { monitoringText } from "./trip-watch";

/** Seven days per evaluation input; a host may query separate bounded periods. */
export const weatherEventHourLimit = 168;
export const weatherCodes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99] as const;
export interface WeatherEventHour {
  readonly at: string;
  readonly temperatureCelsius: number;
  readonly precipitationProbabilityPercent: number;
  readonly precipitationMillimeters: number;
  readonly weatherCode: number;
}
export interface ObservedWeatherFact {
  readonly status: "observed";
  /** Current WeatherForecast provider: precipitation/probability aggregate BEFORE the sample instant. */
  readonly precipitationPeriod: "preceding-hour";
  readonly timezone: string;
  readonly location: { readonly name: string; readonly longitude: number; readonly latitude: number };
  readonly requestedRange: { readonly startDate: string; readonly endDate: string };
  readonly forecast: readonly WeatherEventHour[];
}
export function validateWeatherMeasurements(value: Omit<WeatherEventHour, "at">): void {
  if (!Number.isFinite(value.temperatureCelsius) || !Number.isFinite(value.precipitationProbabilityPercent) ||
      value.precipitationProbabilityPercent < 0 || value.precipitationProbabilityPercent > 100 ||
      !Number.isFinite(value.precipitationMillimeters) || value.precipitationMillimeters < 0 ||
      !weatherCodes.includes(value.weatherCode as typeof weatherCodes[number])) throw new Error("Invalid weather measurements");
}
export function instantInZone(epoch: number, timeZone: string): ZonedInstant {
  validateTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(epoch));
  const p = (type: Intl.DateTimeFormatPartTypes) => parts.find((v) => v.type === type)!.value;
  const wall = `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}`;
  const offset = (Date.parse(`${wall}Z`) - Math.floor(epoch / 1000) * 1000) / 60000;
  const at = `${wall}${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
  const result = { at, timeZone }; validateZonedInstant(result); return result;
}
/** Offsetless provider hours must resolve uniquely. DST folds/gaps are not silently guessed. */
export function forecastHourInstant(time: string, timezone: string): string {
  validateTimeZone(timezone);
  if (validInstant(time)) {
    const local = instantInZone(Date.parse(time), timezone);
    if (local.at.slice(14, 19) !== "00:00" || Date.parse(time) % 1000 !== 0) throw new Error("Not an hourly sample");
    return new Date(time).toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00(?::00)?$/u.test(time) || !validDate(time.slice(0, 10))) throw new Error("Invalid forecast hour");
  const wall = time.length === 16 ? `${time}:00` : time, base = Date.parse(`${wall}Z`), matches = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = base + hours * 3600000, local = instantInZone(probe, timezone);
    const offset = Date.parse(`${local.at.slice(0, 19)}Z`) - probe;
    const epoch = base - offset;
    if (instantInZone(epoch, timezone).at.slice(0, 19) === wall) matches.add(epoch);
  }
  if (matches.size !== 1) throw new Error("Ambiguous or nonexistent forecast hour");
  return new Date([...matches][0]!).toISOString();
}
export function validateWeatherScope(fact: Pick<ObservedWeatherFact, "timezone" | "location" | "requestedRange">): void {
  validateTimeZone(fact.timezone); exactKeys(fact.location, ["name", "longitude", "latitude"]); monitoringText(fact.location.name);
  if (!Number.isFinite(fact.location.longitude) || Math.abs(fact.location.longitude) > 180 ||
      !Number.isFinite(fact.location.latitude) || Math.abs(fact.location.latitude) > 90) throw new Error("Invalid forecast coordinate");
  exactKeys(fact.requestedRange, ["startDate", "endDate"]);
  const { startDate, endDate } = fact.requestedRange;
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate ||
      Date.parse(endDate) - Date.parse(startDate) > 6 * 86400000) throw new Error("Invalid forecast bounds");
}
export function validateObservedWeatherFact(fact: ObservedWeatherFact): void {
  exactKeys(fact, ["status", "precipitationPeriod", "timezone", "location", "requestedRange", "forecast"]);
  if (fact.precipitationPeriod !== "preceding-hour") throw new Error("Unknown precipitation time basis");
  validateWeatherScope(fact);
  const { startDate, endDate } = fact.requestedRange;
  if (!Array.isArray(fact.forecast) || !fact.forecast.length || fact.forecast.length > weatherEventHourLimit) throw new Error("Invalid forecast bounds");
  let previous = -Infinity;
  for (const hour of fact.forecast) {
    exactKeys(hour, ["at", "temperatureCelsius", "precipitationProbabilityPercent", "precipitationMillimeters", "weatherCode"]);
    validateWeatherMeasurements(hour);
    if (!validInstant(hour.at) || forecastHourInstant(hour.at, fact.timezone) !== hour.at) throw new Error("Noncanonical forecast instant");
    const epoch = Date.parse(hour.at), date = instantInZone(epoch, fact.timezone).at.slice(0, 10);
    if (epoch <= previous || date < startDate || date > endDate ||
        epoch - Date.parse(fact.forecast[0]!.at) >= 7 * 86400000) throw new Error("Invalid forecast order/range");
    previous = epoch;
  }
}
