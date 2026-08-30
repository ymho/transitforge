import {
  isInJapanWeatherArea,
  type WeatherGridPoint,
  type WeatherGridProvider,
} from "@raiquora/trip/weather-grid";
import type { AgentOperation } from "../ports/agent-operation.js";

export function createWeatherGridOperation(provider: WeatherGridProvider): AgentOperation {
  return async (request) => {
    const points = weatherGridPoints(request.points);
    const targetTime = typeof request.targetTime === "string" &&
        Number.isFinite(Date.parse(request.targetTime))
      ? request.targetTime
      : undefined;
    if (!points || request.targetTime !== undefined && !targetTime) {
      return { statusCode: 400, body: { message: "局地天気の検索条件が不正です" } };
    }
    const result = await provider.searchGrid({
      points,
      ...(targetTime ? { targetTime } : {}),
    });
    return { body: { weatherGrid: result } };
  };
}

function weatherGridPoints(value: unknown): WeatherGridPoint[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) return undefined;
  const ids = new Set<string>();
  const points = value.flatMap((point) => {
    if (!isRecord(point) || typeof point.id !== "string" ||
      point.id.length < 1 || point.id.length > 40 || ids.has(point.id) ||
      !coordinate(point.latitude, -90, 90) ||
      !coordinate(point.longitude, -180, 180) ||
      !isInJapanWeatherArea({ latitude: point.latitude, longitude: point.longitude })) return [];
    ids.add(point.id);
    return [{
      id: point.id,
      latitude: point.latitude,
      longitude: point.longitude,
    }];
  });
  return points.length === value.length ? points : undefined;
}

function coordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= minimum && value <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
