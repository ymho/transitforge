import type { WeatherGridPoint } from "@raiquora/trip/weather-grid";

export interface WeatherDetailBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface WeatherDetailGrid {
  bounds: WeatherDetailBounds;
  points: WeatherGridPoint[];
}

export function weatherDetailGrid(
  bounds: WeatherDetailBounds,
  zoom: number,
): WeatherDetailGrid | undefined {
  if (zoom < 7) return undefined;
  const clipped = {
    west: Math.max(122, bounds.west),
    south: Math.max(20, bounds.south),
    east: Math.min(154, bounds.east),
    north: Math.min(46, bounds.north),
  };
  if (clipped.west >= clipped.east || clipped.south >= clipped.north) return undefined;
  const divisions = zoom >= 11 ? 4 : zoom >= 9 ? 3 : 2;
  const longitudeStep = (clipped.east - clipped.west) / divisions;
  const latitudeStep = (clipped.north - clipped.south) / divisions;
  const points = Array.from({ length: divisions * divisions }, (_, index) => {
    const row = Math.floor(index / divisions);
    const column = index % divisions;
    const latitude = clipped.south + latitudeStep * (row + 0.5);
    const longitude = clipped.west + longitudeStep * (column + 0.5);
    return {
      id: `detail-${latitude.toFixed(4)}-${longitude.toFixed(4)}`,
      latitude,
      longitude,
    };
  });
  return { bounds: clipped, points };
}
