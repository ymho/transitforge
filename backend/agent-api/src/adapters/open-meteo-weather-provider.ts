import {
  availableExternalInformation,
  failedExternalInformation,
  type ExternalTravelInformation,
} from "@raiquora/trip/external-travel-information";
import type {
  WeatherForecast,
  WeatherForecastProvider,
  WeatherForecastQuery,
} from "@raiquora/trip/weather-forecast";
import {
  localWeatherMode,
  type WeatherCellObservation,
  type WeatherGridProvider,
  type WeatherGridQuery,
  type WeatherGridSnapshot,
} from "@raiquora/trip/weather-grid";

interface FetchPort {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export class OpenMeteoWeatherProvider implements WeatherForecastProvider, WeatherGridProvider {
  private readonly cache = new Map<string, { expiresAt: number; value: ExternalTravelInformation<WeatherForecast> }>();
  private readonly gridCache = new Map<string, { expiresAt: number; value: ExternalTravelInformation<WeatherGridSnapshot> }>();
  constructor(
    private readonly http: FetchPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async search(query: WeatherForecastQuery): Promise<ExternalTravelInformation<WeatherForecast>> {
    const location = query.location.normalize("NFKC").trim().slice(0, 100);
    if (!location) return failedExternalInformation({ code: "invalid_request", message: "場所が必要です", retryable: false });
    if (outsideForecastRange(query.startDate, this.now()) || outsideForecastRange(query.endDate, this.now())) return failedExternalInformation({ code: "invalid_request", message: "指定日は予報期間外のため判断できません", retryable: false });
    const cacheKey = JSON.stringify({ location, startDate: query.startDate, endDate: query.endDate });
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now().getTime()) return cached.value;
    try {
      const place = await this.geocode(location);
      if (!place) return failedExternalInformation({ code: "invalid_request", message: `${location}の位置を確認できません`, retryable: false });
      const retrievedAt = this.now();
      const url = forecastUrl(place, query);
      const response = await this.http.fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return providerHttpFailure(response.status);
      const value: unknown = await response.json();
      const data = weatherForecast(value, place);
      if (!data) return failedExternalInformation({ code: "invalid_response", message: "天気予報の形式が不正です", retryable: true });
      const result = availableExternalInformation(data, [{
        id: `weather:open-meteo:${place.id}:${retrievedAt.toISOString()}`,
        kind: "weather",
        provider: "open-meteo",
        sourceId: String(place.id),
        sourceUrl: url,
        retrievedAt: retrievedAt.toISOString(),
        validUntil: new Date(retrievedAt.getTime() + 60 * 60 * 1_000).toISOString(),
        attribution: "Weather data by Open-Meteo.com",
        confidence: "provider-forecast",
      }], retrievedAt);
      this.cache.set(cacheKey, { expiresAt: retrievedAt.getTime() + 15 * 60_000, value: result });
      return result;
    } catch {
      return failedExternalInformation({ code: "unavailable", message: "天気予報を取得できません", retryable: true });
    }
  }

  async searchGrid(query: WeatherGridQuery): Promise<ExternalTravelInformation<WeatherGridSnapshot>> {
    if (
      query.points.length < 1 ||
      query.points.length > 64 ||
      query.points.some((point) =>
        !point.id.trim() || point.id.length > 40 ||
        !number(point.latitude) || point.latitude < -90 || point.latitude > 90 ||
        !number(point.longitude) || point.longitude < -180 || point.longitude > 180) ||
      query.targetTime !== undefined && !validGridTargetTime(query.targetTime, this.now())
    ) {
      return failedExternalInformation({
        code: "invalid_request",
        message: "気象範囲または日時が予報対象外です",
        retryable: false,
      });
    }
    const cacheKey = JSON.stringify(query);
    const cached = this.gridCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now().getTime()) return cached.value;
    try {
      const retrievedAt = this.now();
      const url = weatherGridUrl(query);
      const response = await this.http.fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return providerHttpFailure<WeatherGridSnapshot>(response.status);
      const value: unknown = await response.json();
      const cells = weatherGridCells(value, query);
      if (cells.length !== query.points.length) {
        return failedExternalInformation({
          code: "invalid_response",
          message: "局地天気の形式が不正です",
          retryable: true,
        });
      }
      const result = availableExternalInformation({ cells }, [{
        id: `weather-grid:open-meteo:${retrievedAt.toISOString()}`,
        kind: "weather",
        provider: "open-meteo",
        sourceId: "weather-grid",
        sourceUrl: url,
        retrievedAt: retrievedAt.toISOString(),
        validUntil: new Date(retrievedAt.getTime() + 15 * 60_000).toISOString(),
        attribution: "Weather data by Open-Meteo.com",
        confidence: query.targetTime ? "provider-forecast" : "observed",
      }], retrievedAt);
      this.gridCache.set(cacheKey, {
        expiresAt: retrievedAt.getTime() + 10 * 60_000,
        value: result,
      });
      return result;
    } catch {
      return failedExternalInformation({
        code: "unavailable",
        message: "局地天気を取得できません",
        retryable: true,
      });
    }
  }

  private async geocode(location: string): Promise<GeocodedPlace | undefined> {
    const params = new URLSearchParams({ name: location, count: "1", language: "ja", format: "json" });
    const response = await this.http.fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return undefined;
    const value: unknown = await response.json();
    if (!isRecord(value) || !Array.isArray(value.results)) return undefined;
    const first = value.results[0];
    if (!isRecord(first) || !number(first.id) || !number(first.latitude) || !number(first.longitude) ||
      typeof first.name !== "string") return undefined;
    return {
      id: first.id,
      name: first.name.slice(0, 100),
      latitude: first.latitude,
      longitude: first.longitude,
      timezone: typeof first.timezone === "string" ? first.timezone : "auto",
    };
  }
}

interface GeocodedPlace { id: number; name: string; latitude: number; longitude: number; timezone: string }

function forecastUrl(place: GeocodedPlace, query: WeatherForecastQuery): string {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    timezone: place.timezone,
    forecast_days: "7",
    hourly: "temperature_2m,precipitation_probability,precipitation,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
  });
  if (isoDate(query.startDate)) params.set("start_date", query.startDate!);
  if (isoDate(query.endDate)) params.set("end_date", query.endDate!);
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function weatherForecast(value: unknown, place: GeocodedPlace): WeatherForecast | undefined {
  if (!isRecord(value) || !isRecord(value.hourly) || !isRecord(value.daily)) return undefined;
  const h = value.hourly;
  const d = value.daily;
  const hourly = parallelRows([h.time, h.temperature_2m, h.precipitation_probability, h.precipitation, h.weather_code], 168)
    .flatMap(([time, temperature, probability, precipitation, code]) =>
      typeof time === "string" && number(temperature) && number(probability) && number(precipitation) && number(code)
        ? [{ time, temperatureCelsius: temperature, precipitationProbabilityPercent: probability, precipitationMillimeters: precipitation, weatherCode: code }]
        : []);
  const daily = parallelRows([d.time, d.temperature_2m_min, d.temperature_2m_max, d.precipitation_probability_max, d.precipitation_sum, d.weather_code], 16)
    .flatMap(([date, minimum, maximum, probability, precipitation, code]) =>
      typeof date === "string" && number(minimum) && number(maximum) && number(probability) && number(precipitation) && number(code)
        ? [{ date, minimumTemperatureCelsius: minimum, maximumTemperatureCelsius: maximum, maximumPrecipitationProbabilityPercent: probability, precipitationMillimeters: precipitation, weatherCode: code }]
        : []);
  if (hourly.length === 0 || daily.length === 0) return undefined;
  return { locationName: place.name, latitude: place.latitude, longitude: place.longitude, timezone: typeof value.timezone === "string" ? value.timezone : place.timezone, hourly, daily, alertsAvailable: false };
}

function weatherGridUrl(query: WeatherGridQuery): string {
  const params = new URLSearchParams({
    latitude: query.points.map(({ latitude }) => latitude).join(","),
    longitude: query.points.map(({ longitude }) => longitude).join(","),
    timezone: "Asia/Tokyo",
  });
  if (query.targetTime) {
    const date = japaneseDate(query.targetTime);
    params.set("hourly", "precipitation,weather_code,cloud_cover");
    params.set("start_date", date);
    params.set("end_date", date);
  } else {
    params.set("current", "precipitation,weather_code,cloud_cover");
  }
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function weatherGridCells(
  value: unknown,
  query: WeatherGridQuery,
): WeatherCellObservation[] {
  const responses = Array.isArray(value) ? value : [value];
  return query.points.flatMap((point, index) => {
    const response = responses[index];
    if (!isRecord(response)) return [];
    const sample = query.targetTime
      ? hourlyGridSample(response.hourly, query.targetTime)
      : currentGridSample(response.current);
    if (!sample) return [];
    return [{
      ...point,
      observedAt: sample.time,
      mode: localWeatherMode(
        sample.weatherCode,
        sample.precipitationMillimeters,
        sample.cloudCoverPercent,
      ),
      precipitationMillimeters: sample.precipitationMillimeters,
      cloudCoverPercent: sample.cloudCoverPercent,
      weatherCode: sample.weatherCode,
    }];
  });
}

interface WeatherGridSample {
  time: string;
  precipitationMillimeters: number;
  cloudCoverPercent: number;
  weatherCode: number;
}

function currentGridSample(value: unknown): WeatherGridSample | undefined {
  if (!isRecord(value) || typeof value.time !== "string" ||
    !number(value.precipitation) || !number(value.cloud_cover) ||
    !number(value.weather_code)) return undefined;
  return {
    time: value.time,
    precipitationMillimeters: value.precipitation,
    cloudCoverPercent: value.cloud_cover,
    weatherCode: value.weather_code,
  };
}

function hourlyGridSample(value: unknown, targetTime: string): WeatherGridSample | undefined {
  if (!isRecord(value)) return undefined;
  const rows = parallelRows([
    value.time,
    value.precipitation,
    value.cloud_cover,
    value.weather_code,
  ], 48);
  const target = Date.parse(targetTime);
  const samples = rows.flatMap(([time, precipitation, cloudCover, weatherCode]) =>
    typeof time === "string" && number(precipitation) && number(cloudCover) && number(weatherCode)
      ? [{
          time,
          distance: Math.abs(Date.parse(`${time}+09:00`) - target),
          precipitationMillimeters: precipitation,
          cloudCoverPercent: cloudCover,
          weatherCode,
        }]
      : []);
  return samples.sort((left, right) => left.distance - right.distance)[0];
}

function parallelRows(values: unknown[], maximum: number): unknown[][] {
  if (values.some((value) => !Array.isArray(value))) return [];
  const arrays = values as unknown[][];
  const length = Math.min(maximum, ...arrays.map((value) => value.length));
  return Array.from({ length }, (_, index) => arrays.map((value) => value[index]));
}

function providerHttpFailure<T>(status: number): ExternalTravelInformation<T> {
  if (status === 429) return failedExternalInformation({ code: "rate_limited", message: "天気Providerの利用上限に達しました", retryable: true });
  if (status === 401 || status === 403) return failedExternalInformation({ code: "unauthorized", message: "天気Providerを利用できません", retryable: false });
  return failedExternalInformation({ code: "unavailable", message: `天気Providerが応答しませんでした (${status})`, retryable: status >= 500 });
}

function validGridTargetTime(value: string, now: Date): boolean {
  const target = Date.parse(value);
  return Number.isFinite(target) &&
    target >= now.getTime() - 60 * 60_000 &&
    target <= now.getTime() + 16 * 24 * 60 * 60_000;
}

function japaneseDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function isoDate(value: string | undefined): boolean { return /^\d{4}-\d{2}-\d{2}$/u.test(value ?? ""); }
function outsideForecastRange(value: string | undefined, now: Date): boolean { if (!isoDate(value)) return false; const date = Date.parse(`${value}T00:00:00Z`); const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()); return date < today || date > today + 15 * 24 * 60 * 60_000; }
function number(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
