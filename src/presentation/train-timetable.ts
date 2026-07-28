import type { TrainStop } from "../data/train-index";

export interface TrainTimetableRow {
  stationName: string;
  times: string[];
}

export function timetableRowsFor(stops: TrainStop[]): TrainTimetableRow[] {
  const rows: TrainTimetableRow[] = [];

  for (const stop of stops) {
    const stationName = stop.station_name?.trim() || "駅名不明";
    const time =
      stop.normalized_time?.trim() ||
      stop.time?.trim() ||
      formatRouteTime(stop.route_time_minutes);
    const event = stop.event?.trim();
    const displayTime = event ? `${event} ${time}` : time;
    const previousRow = rows.at(-1);

    if (previousRow && stationName !== "駅名不明" && previousRow.stationName === stationName) {
      previousRow.times.push(displayTime);
    } else {
      rows.push({ stationName, times: [displayTime] });
    }
  }

  return rows;
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
