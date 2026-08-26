import type { Coordinate, Path } from "@raiquora/train/path";
import type { Train, TrainStop } from "@raiquora/train/train";
import { normalizeStationName } from "@raiquora/train/station-name";

const bearingTangentDistanceMeters = 300;

export interface TrainPosition {
  serviceUid: string;
  trainNo: string;
  serviceType: string;
  routeMeter: number;
  coordinate: Coordinate;
  bearingRadians: number;
}

export class PathGeometryIndex {
  private readonly geometryByPathId = new Map<string, PathGeometry>();

  constructor(paths: Path[]) {
    for (const path of paths) {
      this.geometryByPathId.set(path.path_id, new PathGeometry(path));
    }
  }

  positionAt(pathId: string, routeMeter: number): PositionedCoordinate | undefined {
    return this.geometryByPathId.get(pathId)?.positionAt(routeMeter);
  }
}

export function activeTrainPositions(
  trains: Train[],
  geometry: PathGeometryIndex,
  routeTimeMinutes: number,
  delayByTrainNumber: ReadonlyMap<string, number> = new Map(),
  destinationChangedServiceUids: ReadonlySet<string> = new Set(),
): TrainPosition[] {
  const positions: TrainPosition[] = [];

  for (const train of trains) {
    const timetableRouteTime =
      routeTimeMinutes - (delayByTrainNumber.get(train.train_no) ?? 0);
    if (
      destinationChangedServiceUids.has(train.service_uid) &&
      hasArrivedAtDestination(train, timetableRouteTime)
    ) {
      continue;
    }
    const position = positionForTrain(
      train,
      geometry,
      timetableRouteTime,
    );
    if (position) {
      positions.push(position);
    }
  }

  return positions;
}

export function freezeLongTimeStoppingPositions(
  currentPositions: TrainPosition[],
  previousPositions: TrainPosition[],
  longTimeStoppingServiceUids: ReadonlySet<string>,
  removedServiceUids: ReadonlySet<string> = new Set(),
): TrainPosition[] {
  if (longTimeStoppingServiceUids.size === 0) {
    return currentPositions;
  }
  const previousByServiceUid = new Map(
    previousPositions.map((position) => [position.serviceUid, position]),
  );
  const frozen = currentPositions.map((position) =>
    longTimeStoppingServiceUids.has(position.serviceUid)
      ? previousByServiceUid.get(position.serviceUid) ?? position
      : position,
  );
  const currentServiceUids = new Set(
    currentPositions.map((position) => position.serviceUid),
  );
  for (const previous of previousPositions) {
    if (
      longTimeStoppingServiceUids.has(previous.serviceUid) &&
      !removedServiceUids.has(previous.serviceUid) &&
      !currentServiceUids.has(previous.serviceUid)
    ) {
      frozen.push(previous);
    }
  }
  return frozen;
}

export function hasArrivedAtDestination(
  train: Pick<Train, "stops" | "destination_station">,
  routeTimeMinutes: number,
): boolean {
  const destination = normalizeStationName(train.destination_station);
  const arrival = train.stops
    .filter(
      (stop) =>
        typeof stop.station_name === "string" &&
        normalizeStationName(stop.station_name) === destination &&
        typeof stop.route_time_minutes === "number" &&
        Number.isFinite(stop.route_time_minutes),
    )
    .map((stop) => stop.route_time_minutes as number)
    .sort((left, right) => left - right)[0];
  return arrival !== undefined && routeTimeMinutes >= arrival;
}

export function positionForTrain(
  train: Train,
  geometry: PathGeometryIndex,
  routeTimeMinutes: number,
): TrainPosition | undefined {
  if (!train.path_id) {
    return undefined;
  }

  const routeMeter = interpolatedRouteMeter(train.stops, routeTimeMinutes);
  if (routeMeter === undefined) {
    return undefined;
  }

  const positionedCoordinate = geometry.positionAt(train.path_id, routeMeter);
  if (!positionedCoordinate) {
    return undefined;
  }

  return {
    serviceUid: train.service_uid,
    trainNo: train.train_no,
    serviceType: train.service_type,
    routeMeter,
    coordinate: positionedCoordinate.coordinate,
    bearingRadians: positionedCoordinate.bearingRadians,
  };
}

export function destinationCoordinateForTrain(
  train: Pick<Train, "path_id" | "stops" | "destination_station">,
  geometry: PathGeometryIndex,
): Coordinate | undefined {
  if (!train.path_id) {
    return undefined;
  }

  const normalizedDestination = normalizeStationName(train.destination_station);
  for (let index = train.stops.length - 1; index >= 0; index -= 1) {
    const stop = train.stops[index];
    if (
      typeof stop.station_name === "string" &&
      normalizeStationName(stop.station_name) === normalizedDestination &&
      typeof stop.route_meter === "number" &&
      Number.isFinite(stop.route_meter)
    ) {
      return geometry.positionAt(train.path_id, stop.route_meter)?.coordinate;
    }
  }

  for (let index = train.stops.length - 1; index >= 0; index -= 1) {
    const routeMeter = train.stops[index].route_meter;
    if (typeof routeMeter === "number" && Number.isFinite(routeMeter)) {
      return geometry.positionAt(train.path_id, routeMeter)?.coordinate;
    }
  }

  return undefined;
}

export function interpolatedRouteMeter(
  rawStops: TrainStop[],
  routeTimeMinutes: number,
): number | undefined {
  const stops = rawStops.filter(isPositionStop);
  const first = stops[0];
  const last = stops.at(-1);

  if (!first || !last || routeTimeMinutes < first.route_time_minutes || routeTimeMinutes > last.route_time_minutes) {
    return undefined;
  }

  for (let index = 0; index < stops.length - 1; index += 1) {
    const current = stops[index];
    const next = stops[index + 1];

    if (routeTimeMinutes < current.route_time_minutes || routeTimeMinutes > next.route_time_minutes) {
      continue;
    }

    const duration = next.route_time_minutes - current.route_time_minutes;
    if (duration === 0) {
      return next.route_meter;
    }

    const progress = (routeTimeMinutes - current.route_time_minutes) / duration;
    return current.route_meter + (next.route_meter - current.route_meter) * progress;
  }

  return last.route_meter;
}

interface PositionStop {
  route_meter: number;
  route_time_minutes: number;
}

function isPositionStop(stop: TrainStop): stop is PositionStop {
  return (
    typeof stop.route_meter === "number" &&
    Number.isFinite(stop.route_meter) &&
    typeof stop.route_time_minutes === "number" &&
    Number.isFinite(stop.route_time_minutes)
  );
}

class PathGeometry {
  private readonly cumulativeDistances: number[];
  private readonly totalCoordinateDistance: number;

  constructor(private readonly path: Path) {
    this.cumulativeDistances = [0];

    for (let index = 1; index < path.route_coords.length; index += 1) {
      const previous = path.route_coords[index - 1];
      const current = path.route_coords[index];
      this.cumulativeDistances.push(
        this.cumulativeDistances[index - 1] + distanceInMeters(previous, current),
      );
    }

    this.totalCoordinateDistance = this.cumulativeDistances.at(-1) ?? 0;
  }

  positionAt(routeMeter: number): PositionedCoordinate | undefined {
    const coordinate = this.coordinateAt(routeMeter);
    if (!coordinate) {
      return undefined;
    }

    // 駅の代表点へ接続する短い折り返しや細かな経路の揺れで
    // 車両の向きが反転しないよう 前後を広めに見て進行方向を求める
    const tangentDistance = Math.min(
      bearingTangentDistanceMeters,
      this.path.route_length_m / 2,
    );
    const before = this.coordinateAt(Math.max(0, routeMeter - tangentDistance));
    const after = this.coordinateAt(Math.min(this.path.route_length_m, routeMeter + tangentDistance));

    return {
      coordinate,
      bearingRadians: before && after ? bearingRadiansBetween(before, after) : 0,
    };
  }

  private coordinateAt(routeMeter: number): Coordinate | undefined {
    if (
      this.path.route_coords.length < 2 ||
      this.path.route_length_m <= 0 ||
      this.totalCoordinateDistance <= 0
    ) {
      return undefined;
    }

    const progress = Math.min(Math.max(routeMeter / this.path.route_length_m, 0), 1);
    const targetDistance = this.totalCoordinateDistance * progress;

    for (let index = 1; index < this.cumulativeDistances.length; index += 1) {
      if (targetDistance > this.cumulativeDistances[index]) {
        continue;
      }

      const previousDistance = this.cumulativeDistances[index - 1];
      const segmentDistance = this.cumulativeDistances[index] - previousDistance;
      const segmentProgress = segmentDistance === 0 ? 0 : (targetDistance - previousDistance) / segmentDistance;
      const [previousLongitude, previousLatitude] = this.path.route_coords[index - 1];
      const [nextLongitude, nextLatitude] = this.path.route_coords[index];

      return [
        previousLongitude + (nextLongitude - previousLongitude) * segmentProgress,
        previousLatitude + (nextLatitude - previousLatitude) * segmentProgress,
      ];
    }

    return this.path.route_coords.at(-1);
  }
}

interface PositionedCoordinate {
  coordinate: Coordinate;
  bearingRadians: number;
}

function distanceInMeters(from: Coordinate, to: Coordinate): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDifference = toRadians(to[1] - from[1]);
  const longitudeDifference = toRadians(to[0] - from[0]);
  const fromLatitude = toRadians(from[1]);
  const toLatitude = toRadians(to[1]);
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDifference / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function bearingRadiansBetween(from: Coordinate, to: Coordinate): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const longitudeDifference = toRadians(to[0] - from[0]);
  const fromLatitude = toRadians(from[1]);
  const toLatitude = toRadians(to[1]);
  const x = Math.sin(longitudeDifference) * Math.cos(toLatitude);
  const y =
    Math.cos(fromLatitude) * Math.sin(toLatitude) -
    Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDifference);

  return Math.atan2(x, y);
}
