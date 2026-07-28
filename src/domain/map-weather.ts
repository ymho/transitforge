import type { RainSpecification, SnowSpecification } from "mapbox-gl";

export type WeatherMode = "clear" | "rain" | "snow";

export interface WeatherMap {
  setRain(rain?: RainSpecification | null): unknown;
  setSnow(snow?: SnowSpecification | null): unknown;
}

const rain: RainSpecification = {
  density: 0.65,
  intensity: 0.7,
  opacity: 0.78,
  color: "#a9c7df",
  direction: [0, 80],
  "droplet-size": [1.2, 18],
  "distortion-strength": 0.12,
  "center-thinning": 0.2,
  vignette: 0.12,
  "vignette-color": "#6d8293",
};

const snow: SnowSpecification = {
  density: 0.7,
  intensity: 0.75,
  opacity: 0.92,
  color: "#ffffff",
  direction: [0, 50],
  "flake-size": 0.72,
  "center-thinning": 0.15,
  vignette: 0.18,
  "vignette-color": "#edf5ff",
};

export function applyWeather(map: WeatherMap, mode: WeatherMode): void {
  map.setRain(null);
  map.setSnow(null);

  if (mode === "rain") {
    map.setRain(rain);
  } else if (mode === "snow") {
    map.setSnow(snow);
  }
}

export function isWeatherMode(value: string | undefined): value is WeatherMode {
  return value === "clear" || value === "rain" || value === "snow";
}
