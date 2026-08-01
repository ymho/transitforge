import type { TrainStop } from "../data/train-index";

export interface TrainTimetableRow {
  stationName: string;
  times: string[];
}

export interface TrainTimetableProgressTime {
  scheduled: string;
  adjusted?: string;
}

export interface TrainTimetableProgressRow {
  stationName: string;
  times: TrainTimetableProgressTime[];
  status?: "approaching" | "stopped";
}

interface DetailedTimetableEntry {
  displayTime: string;
  event?: string;
  routeTimeMinutes?: number;
}

interface DetailedTimetableRow {
  stationName: string;
  entries: DetailedTimetableEntry[];
  routeMeters: number[];
}

const stoppedDistanceToleranceMeters = 1;

export function timetableRowsFor(stops: TrainStop[]): TrainTimetableRow[] {
  return detailedTimetableRowsFor(stops).map(({ stationName, entries }) => ({
    stationName,
    times: entries.map(({ displayTime }) => displayTime),
  }));
}

export function timetableProgressRowsFor(
  stops: TrainStop[],
  currentRouteMeter: number | undefined,
  delayMinutes: number | undefined,
): TrainTimetableProgressRow[] {
  const rows = detailedTimetableRowsFor(stops);
  const current = currentTimetableRow(rows, currentRouteMeter);

  return rows.map(({ stationName, entries }, index) => ({
    stationName,
    times: entries.map(({ displayTime, event, routeTimeMinutes }) => ({
      scheduled: displayTime,
      ...(delayMinutes !== undefined &&
      delayMinutes > 0 &&
      current !== undefined &&
      index >= current.index &&
      routeTimeMinutes !== undefined
        ? {
            adjusted: displayEventTime(
              event,
              formatRouteTime(routeTimeMinutes + delayMinutes),
            ),
          }
        : {}),
    })),
    ...(current?.index === index ? { status: current.status } : {}),
  }));
}

function detailedTimetableRowsFor(stops: TrainStop[]): DetailedTimetableRow[] {
  const rows: DetailedTimetableRow[] = [];

  for (const stop of stops) {
    const stationName = stop.station_name?.trim() || "駅名不明";
    const event = stop.event?.trim();
    const time =
      stop.normalized_time?.trim() ||
      stop.time?.trim() ||
      formatRouteTime(stop.route_time_minutes);
    const entry = {
      displayTime: displayEventTime(event, time),
      event,
      routeTimeMinutes: stop.route_time_minutes,
    };
    const routeMeters =
      typeof stop.route_meter === "number" && Number.isFinite(stop.route_meter)
        ? [stop.route_meter]
        : [];
    const previousRow = rows.at(-1);

    if (
      previousRow &&
      stationName !== "駅名不明" &&
      previousRow.stationName === stationName
    ) {
      previousRow.entries.push(entry);
      previousRow.routeMeters.push(...routeMeters);
    } else {
      rows.push({ stationName, entries: [entry], routeMeters });
    }
  }

  return rows;
}

function currentTimetableRow(
  rows: DetailedTimetableRow[],
  currentRouteMeter: number | undefined,
): { index: number; status: "approaching" | "stopped" } | undefined {
  if (currentRouteMeter === undefined) {
    return undefined;
  }

  let nearest: { index: number; distance: number } | undefined;
  for (const [index, row] of rows.entries()) {
    for (const routeMeter of row.routeMeters) {
      const distance = Math.abs(routeMeter - currentRouteMeter);
      if (!nearest || distance < nearest.distance) {
        nearest = { index, distance };
      }
    }
  }
  if (nearest && nearest.distance <= stoppedDistanceToleranceMeters) {
    return { index: nearest.index, status: "stopped" };
  }

  const approachingIndex = rows.findIndex((row) =>
    row.routeMeters.some((routeMeter) => routeMeter > currentRouteMeter),
  );
  return approachingIndex >= 0
    ? { index: approachingIndex, status: "approaching" }
    : undefined;
}

function displayEventTime(event: string | undefined, time: string): string {
  return event ? `${event} ${time}` : time;
}

function formatRouteTime(routeTimeMinutes: number | undefined): string {
  if (routeTimeMinutes === undefined) {
    return "—";
  }

  const totalMinutes = Math.round(routeTimeMinutes);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
