import type {
  FogSpecification,
  RainSpecification,
  SnowSpecification,
} from "mapbox-gl";

export type WeatherMode = "clear" | "cloudy" | "rain" | "snow";

export interface WeatherMap {
  setFog(fog?: FogSpecification | null): unknown;
  setRain(rain?: RainSpecification | null): unknown;
  setSnow(snow?: SnowSpecification | null): unknown;
}

const cloudyFog: FogSpecification = {
  range: [-0.2, 2.5],
  color: "#c8d0d5",
  "high-color": "#aeb9c0",
  "space-color": "#7e8a92",
  "horizon-blend": 0.32,
  "star-intensity": 0,
  "vertical-range": [0, 2_500],
};

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
  map.setFog(null);
  map.setRain(null);
  map.setSnow(null);

  if (mode !== "clear") {
    map.setFog(cloudyFog);
  }

  if (mode === "rain") {
    map.setRain(rain);
  } else if (mode === "snow") {
    map.setSnow(snow);
  }
}

export function isWeatherMode(value: string | undefined): value is WeatherMode {
  return (
    value === "clear" ||
    value === "cloudy" ||
    value === "rain" ||
    value === "snow"
  );
}
