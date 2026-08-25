import type { Train, TrainStop } from "./rail/train";

export function mergeSameOperationTrains(
  trains: Train[],
  activeTrain: Train,
): Train {
  if (trains.length < 2) {
    return activeTrain;
  }

  const stops = distinctStopsInTimeOrder(trains.flatMap((train) => train.stops));
  return {
    ...activeTrain,
    origin_station: stops[0]?.station_name ?? activeTrain.origin_station,
    destination_station:
      stops.at(-1)?.station_name ?? activeTrain.destination_station,
    stops,
  };
}

function distinctStopsInTimeOrder(stops: TrainStop[]): TrainStop[] {
  const seen = new Set<string>();
  return stops
    .map((stop, index) => ({ stop, index }))
    .sort(
      (left, right) =>
        sortableTime(left.stop) - sortableTime(right.stop) ||
        left.index - right.index,
    )
    .flatMap(({ stop }) => {
      const key = [
        stop.station_name ?? "",
        stop.route_time_minutes ?? stop.normalized_time ?? stop.time ?? "",
        stop.event ?? "",
      ].join("|");
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);
      return [stop];
    });
}

function sortableTime(stop: TrainStop): number {
  return typeof stop.route_time_minutes === "number"
    ? stop.route_time_minutes
    : Number.POSITIVE_INFINITY;
}
