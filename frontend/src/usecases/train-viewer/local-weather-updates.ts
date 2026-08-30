import {
  japanWeatherGridPoints,
  type WeatherGridSnapshot,
} from "@raiquora/trip/weather-grid";
import {
  weatherDetailGrid,
  type WeatherDetailBounds,
} from "../../domain/weather-detail-grid";

interface LocalWeatherPresentationPort {
  setWeather(observations: WeatherGridSnapshot["cells"]): void;
  setDetailedWeather(
    observations: WeatherGridSnapshot["cells"],
    bounds: WeatherDetailBounds,
  ): void;
  clearDetailedWeather(): void;
  clear(): void;
  dispose(): void;
}

interface WeatherMapPort {
  getBounds(): {
    getWest(): number;
    getSouth(): number;
    getEast(): number;
    getNorth(): number;
  } | null;
  getZoom(): number;
  on(event: "moveend", listener: () => void): unknown;
  off(event: "moveend", listener: () => void): unknown;
}

interface WeatherSearchRequest {
  points: Array<{ id: string; latitude: number; longitude: number }>;
  targetTime?: string;
}

type WeatherSearch = (
  request: WeatherSearchRequest,
) => Promise<{ weatherGrid: { status: string; data?: WeatherGridSnapshot } }>;

export interface LocalWeatherUpdatesController {
  refresh(): Promise<void>;
  scheduleRefresh(): void;
  dispose(): void;
}

export function configureLocalWeatherUpdates(
  map: WeatherMapPort,
  layer: LocalWeatherPresentationPort,
  search: WeatherSearch,
  targetTime: () => Date | undefined,
): LocalWeatherUpdatesController {
  let disposed = false;
  let nationalGeneration = 0;
  let detailGeneration = 0;
  let refreshTimer: number | undefined;
  let detailTimer: number | undefined;

  const request = (points: WeatherSearchRequest["points"]): WeatherSearchRequest => {
    const displayedAt = targetTime();
    return {
      points,
      ...(displayedAt ? { targetTime: displayedAt.toISOString() } : {}),
    };
  };

  const refreshNational = async () => {
    const generation = ++nationalGeneration;
    try {
      const response = await search(request(japanWeatherGridPoints()));
      if (disposed || generation !== nationalGeneration) return;
      if (response.weatherGrid.status !== "available" || !response.weatherGrid.data) {
        layer.clear();
        return;
      }
      layer.setWeather(response.weatherGrid.data.cells);
    } catch {
      // 一時的なProvider障害では直前の全国天気を維持する。
    }
  };

  const refreshDetail = async () => {
    const generation = ++detailGeneration;
    const bounds = map.getBounds();
    if (!bounds) return;
    const grid = weatherDetailGrid({
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    }, map.getZoom());
    if (!grid) {
      layer.clearDetailedWeather();
      return;
    }
    try {
      const response = await search(request(grid.points));
      if (disposed || generation !== detailGeneration) return;
      if (response.weatherGrid.status !== "available" || !response.weatherGrid.data) {
        layer.clearDetailedWeather();
        return;
      }
      layer.setDetailedWeather(response.weatherGrid.data.cells, grid.bounds);
    } catch {
      // 詳細取得に失敗しても先読み済みの全国天気を使える。
    }
  };

  const refresh = async () => {
    await Promise.all([refreshNational(), refreshDetail()]);
  };
  const scheduleRefresh = () => {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => void refresh(), 500);
  };
  const scheduleDetailRefresh = () => {
    if (detailTimer !== undefined) window.clearTimeout(detailTimer);
    detailTimer = window.setTimeout(() => void refreshDetail(), 350);
  };

  map.on("moveend", scheduleDetailRefresh);
  const interval = window.setInterval(() => void refresh(), 10 * 60_000);
  void refresh();

  return {
    refresh,
    scheduleRefresh,
    dispose() {
      disposed = true;
      map.off("moveend", scheduleDetailRefresh);
      window.clearInterval(interval);
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      if (detailTimer !== undefined) window.clearTimeout(detailTimer);
      layer.dispose();
    },
  };
}
