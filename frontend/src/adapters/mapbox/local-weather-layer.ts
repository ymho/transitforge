import {
  isInJapanWeatherArea,
  nearestWeatherObservation,
  type WeatherCellObservation,
} from "@raiquora/trip/weather-grid";
import type { WeatherMode } from "../../domain/weather";
import type { WeatherDetailBounds } from "../../domain/weather-detail-grid";

export interface LocalWeatherLayerController {
  setWeather(observations: readonly WeatherCellObservation[]): void;
  setDetailedWeather(
    observations: readonly WeatherCellObservation[],
    bounds: WeatherDetailBounds,
  ): void;
  clearDetailedWeather(): void;
  clear(): void;
  dispose(): void;
}

interface LocalWeatherMap {
  getCenter(): { lat: number; lng: number };
  on(event: "move", listener: () => void): unknown;
  off(event: "move", listener: () => void): unknown;
}

export function createLocalWeatherLayer(
  map: LocalWeatherMap,
  applyWeatherMode: (mode: WeatherMode) => void,
): LocalWeatherLayerController {
  let observations: readonly WeatherCellObservation[] = [];
  let detailedObservations: readonly WeatherCellObservation[] = [];
  let detailedBounds: WeatherDetailBounds | undefined;
  let activeObservationId: string | undefined;
  let animationFrame: number | undefined;

  const update = () => {
    animationFrame = undefined;
    const center = map.getCenter();
    if (!isInJapanWeatherArea({ latitude: center.lat, longitude: center.lng })) {
      if (activeObservationId !== undefined) {
        activeObservationId = undefined;
        applyWeatherMode("clear");
      }
      return;
    }
    const preferredObservations = detailedBounds && contains(detailedBounds, center)
      ? detailedObservations
      : observations;
    const nearest = nearestWeatherObservation(preferredObservations, {
      latitude: center.lat,
      longitude: center.lng,
    });
    if (!nearest || nearest.id === activeObservationId) return;
    activeObservationId = nearest.id;
    applyWeatherMode(nearest.mode);
  };
  const scheduleUpdate = () => {
    if (animationFrame !== undefined) return;
    animationFrame = window.requestAnimationFrame(update);
  };
  map.on("move", scheduleUpdate);

  return {
    setWeather(nextObservations) {
      observations = nextObservations;
      activeObservationId = undefined;
      update();
    },
    setDetailedWeather(nextObservations, bounds) {
      detailedObservations = nextObservations;
      detailedBounds = bounds;
      activeObservationId = undefined;
      update();
    },
    clearDetailedWeather() {
      detailedObservations = [];
      detailedBounds = undefined;
      activeObservationId = undefined;
      update();
    },
    clear() {
      observations = [];
      detailedObservations = [];
      detailedBounds = undefined;
      activeObservationId = undefined;
      applyWeatherMode("clear");
    },
    dispose() {
      map.off("move", scheduleUpdate);
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      observations = [];
      detailedObservations = [];
    },
  };
}

function contains(
  bounds: WeatherDetailBounds,
  point: { lat: number; lng: number },
): boolean {
  return point.lng >= bounds.west && point.lng <= bounds.east &&
    point.lat >= bounds.south && point.lat <= bounds.north;
}
