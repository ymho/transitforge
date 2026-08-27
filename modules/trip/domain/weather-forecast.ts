import type { ExternalTravelProviderPort } from "./external-travel-information";

export interface WeatherForecastQuery {
  location: string;
  startDate?: string;
  endDate?: string;
}

export interface HourlyWeatherForecast {
  time: string;
  temperatureCelsius: number;
  precipitationProbabilityPercent: number;
  precipitationMillimeters: number;
  weatherCode: number;
}

export interface DailyWeatherForecast {
  date: string;
  minimumTemperatureCelsius: number;
  maximumTemperatureCelsius: number;
  maximumPrecipitationProbabilityPercent: number;
  precipitationMillimeters: number;
  weatherCode: number;
}

export interface WeatherForecast {
  locationName: string;
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: HourlyWeatherForecast[];
  daily: DailyWeatherForecast[];
  alertsAvailable: boolean;
}

export type WeatherForecastProvider = ExternalTravelProviderPort<
  WeatherForecastQuery,
  WeatherForecast
>;
