import type { ExternalTravelInformation } from "./external-travel-information";

export type LocalWeatherMode = "clear" | "cloudy" | "rain" | "snow";

export interface WeatherGridPoint {
  id: string;
  latitude: number;
  longitude: number;
}

export interface WeatherGridQuery {
  points: WeatherGridPoint[];
  targetTime?: string;
}

export interface WeatherCellObservation extends WeatherGridPoint {
  observedAt: string;
  mode: LocalWeatherMode;
  precipitationMillimeters: number;
  cloudCoverPercent: number;
  weatherCode: number;
}

export interface WeatherGridSnapshot {
  cells: WeatherCellObservation[];
}

export interface WeatherGridProvider {
  searchGrid(
    query: WeatherGridQuery,
  ): Promise<ExternalTravelInformation<WeatherGridSnapshot>>;
}

const japanWeatherRows = [
  { latitude: 24, west: 123, east: 129 },
  { latitude: 25.5, west: 126, east: 131 },
  { latitude: 27, west: 127, east: 131 },
  { latitude: 28.5, west: 129, east: 132 },
  { latitude: 30, west: 129, east: 133.5 },
  { latitude: 31.5, west: 130, east: 135 },
  { latitude: 33, west: 130, east: 136 },
  { latitude: 34.5, west: 131, east: 138 },
  { latitude: 36, west: 134, east: 140 },
  { latitude: 37.5, west: 136, east: 141 },
  { latitude: 39, west: 139, east: 142.5 },
  { latitude: 40.5, west: 140, east: 144 },
  { latitude: 42, west: 140.5, east: 145 },
  { latitude: 43.5, west: 141, east: 145.5 },
  { latitude: 45, west: 141.5, east: 145.5 },
] as const;

export function japanWeatherGridPoints(): WeatherGridPoint[] {
  return japanWeatherRows.flatMap((row, rowIndex) => {
    const pointCount = Math.ceil((row.east - row.west) / 1.75) + 1;
    return Array.from({ length: pointCount }, (_, columnIndex) => ({
      id: `jp-${rowIndex}-${columnIndex}`,
      latitude: row.latitude,
      longitude: Math.min(row.east, row.west + columnIndex * 1.75),
    }));
  });
}

export function nearestWeatherObservation(
  observations: readonly WeatherCellObservation[],
  coordinate: { latitude: number; longitude: number },
): WeatherCellObservation | undefined {
  const longitudeScale = Math.cos(coordinate.latitude * Math.PI / 180);
  return observations.reduce<WeatherCellObservation | undefined>((nearest, candidate) => {
    if (!nearest) return candidate;
    return weatherDistance(candidate, coordinate, longitudeScale) <
        weatherDistance(nearest, coordinate, longitudeScale)
      ? candidate
      : nearest;
  }, undefined);
}

function weatherDistance(
  point: Pick<WeatherGridPoint, "latitude" | "longitude">,
  coordinate: { latitude: number; longitude: number },
  longitudeScale: number,
): number {
  const latitudeDistance = point.latitude - coordinate.latitude;
  const longitudeDistance = (point.longitude - coordinate.longitude) * longitudeScale;
  return latitudeDistance ** 2 + longitudeDistance ** 2;
}

export function isInJapanWeatherArea(
  point: Pick<WeatherGridPoint, "latitude" | "longitude">,
): boolean {
  return point.latitude >= 20 && point.latitude <= 46 &&
    point.longitude >= 122 && point.longitude <= 154;
}

export function localWeatherMode(
  weatherCode: number,
  precipitationMillimeters: number,
  cloudCoverPercent: number,
): LocalWeatherMode {
  if (weatherCode >= 71 && weatherCode <= 77 || weatherCode >= 85) return "snow";
  if (precipitationMillimeters > 0 || weatherCode >= 51) return "rain";
  if (cloudCoverPercent >= 45 || weatherCode >= 1) return "cloudy";
  return "clear";
}
