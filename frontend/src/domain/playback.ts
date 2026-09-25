import { japanDateTimeParts } from "./japan-time";

export interface RouteTimeRange {
  minimum: number;
  maximum: number;
}

export const operatingDayStartMinutes = 4 * 60;

export function operatingDayRouteTime(routeTimeMinutes: number): number {
  return routeTimeMinutes >= 0 && routeTimeMinutes < operatingDayStartMinutes
    ? routeTimeMinutes + 24 * 60
    : routeTimeMinutes;
}

export function currentRouteTime(date: Date): number {
  const japan = japanDateTimeParts(date);
  return operatingDayRouteTime(
    japan.hour * 60 +
      japan.minute +
      japan.second / 60 +
      date.getMilliseconds() / 60_000,
  );
}

export function advanceRouteTime(
  current: number,
  elapsedMilliseconds: number,
  minutesPerSecond: number,
  range: RouteTimeRange,
): number {
  const span = range.maximum - range.minimum;

  if (span <= 0) {
    return range.minimum;
  }

  const advanced = current + (elapsedMilliseconds / 1_000) * minutesPerSecond;
  const offset = ((advanced - range.minimum) % span + span) % span;

  return range.minimum + offset;
}
