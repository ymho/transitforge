import type { StationLineCatalog, StationCoordinate } from "../data/station-line-catalog";
import type { Train, TrainStop } from "../data/train-index";

export interface DirectRouteResult {
  train: Train;
  originStation: string;
  destinationStation: string;
  departureTimeMinutes: number;
  arrivalTimeMinutes: number;
}

export interface NearestDirectOrigin {
  stationName: string;
  distanceMeters: number;
}

interface StopGroup {
  stationName: string;
  normalizedName: string;
  stops: TrainStop[];
}

export function searchDirectRoutes(
  trains: Train[],
  originStation: string,
  destinationStation: string,
  departureTimeMinutes: number,
  limit = 3,
): DirectRouteResult[] {
  const origin = normalizeStationName(originStation);
  const destination = normalizeStationName(destinationStation);
  if (!origin || !destination || origin === destination) {
    return [];
  }

  const results = trains.flatMap((train) => {
    const groups = groupedStops(train.stops);
    const originIndex = groups.findIndex((group) => group.normalizedName === origin);
    if (originIndex < 0) {
      return [];
    }
    const destinationGroup = groups
      .slice(originIndex + 1)
      .find((group) => group.normalizedName === destination);
    if (!destinationGroup) {
      return [];
    }
    const originGroup = groups[originIndex];
    const departure = departureTimeFor(originGroup);
    const arrival = arrivalTimeFor(destinationGroup);
    if (
      departure === undefined ||
      arrival === undefined ||
      departure < departureTimeMinutes ||
      arrival < departure
    ) {
      return [];
    }
    return [{
      train,
      originStation: originGroup.stationName,
      destinationStation: destinationGroup.stationName,
      departureTimeMinutes: departure,
      arrivalTimeMinutes: arrival,
    }];
  });

  return results
    .sort((left, right) =>
      left.departureTimeMinutes - right.departureTimeMinutes ||
      left.arrivalTimeMinutes - right.arrivalTimeMinutes,
    )
    .slice(0, Math.max(1, limit));
}

export function nearestDirectOrigin(
  trains: Train[],
  catalog: StationLineCatalog,
  destinationStation: string,
  departureTimeMinutes: number,
  userCoordinate: StationCoordinate,
): NearestDirectOrigin | undefined {
  const destination = normalizeStationName(destinationStation);
  const eligibleOrigins = new Set<string>();

  for (const train of trains) {
    const groups = groupedStops(train.stops);
    const destinationIndex = groups.findIndex(
      (group) => group.normalizedName === destination,
    );
    if (destinationIndex <= 0) {
      continue;
    }
    const destinationArrival = arrivalTimeFor(groups[destinationIndex]);
    for (const group of groups.slice(0, destinationIndex)) {
      const departure = departureTimeFor(group);
      if (
        departure !== undefined &&
        destinationArrival !== undefined &&
        departure >= departureTimeMinutes &&
        destinationArrival >= departure
      ) {
        eligibleOrigins.add(group.normalizedName);
      }
    }
  }

  let nearest: NearestDirectOrigin | undefined;
  for (const line of catalog.lines) {
    for (const station of line.stations) {
      if (!eligibleOrigins.has(normalizeStationName(station.name))) {
        continue;
      }
      const distanceMeters = haversineDistanceMeters(
        userCoordinate,
        station.coordinate,
      );
      if (!nearest || distanceMeters < nearest.distanceMeters) {
        nearest = { stationName: station.name, distanceMeters };
      }
    }
  }
  return nearest;
}

export function stationNamesFromCatalog(catalog: StationLineCatalog): string[] {
  return Array.from(
    new Map(
      catalog.lines.flatMap((line) =>
        line.stations.map((station) => [normalizeStationName(station.name), station.name]),
      ),
    ).values(),
  ).sort((left, right) => left.localeCompare(right, "ja"));
}

export function normalizeStationName(value: string): string {
  return value.normalize("NFKC").trim().replace(/[\s　]+/g, "").replace(/駅$/, "");
}

function groupedStops(stops: TrainStop[]): StopGroup[] {
  const groups: StopGroup[] = [];
  for (const stop of stops) {
    if (!stop.station_name || !Number.isFinite(stop.route_time_minutes)) {
      continue;
    }
    const normalizedName = normalizeStationName(stop.station_name);
    const previous = groups.at(-1);
    if (previous?.normalizedName === normalizedName) {
      previous.stops.push(stop);
    } else {
      groups.push({ stationName: stop.station_name, normalizedName, stops: [stop] });
    }
  }
  return groups;
}

function departureTimeFor(group: StopGroup): number | undefined {
  return preferredTime(group.stops, "発", Math.max);
}

function arrivalTimeFor(group: StopGroup): number | undefined {
  return preferredTime(group.stops, "着", Math.min);
}

function preferredTime(
  stops: TrainStop[],
  event: string,
  fallback: (...values: number[]) => number,
): number | undefined {
  const eventTimes = stops
    .filter((stop) => stop.event?.includes(event))
    .map((stop) => stop.route_time_minutes)
    .filter((time): time is number => time !== undefined && Number.isFinite(time));
  if (eventTimes.length > 0) {
    return fallback(...eventTimes);
  }
  const times = stops
    .map((stop) => stop.route_time_minutes)
    .filter((time): time is number => time !== undefined && Number.isFinite(time));
  return times.length > 0 ? fallback(...times) : undefined;
}

function haversineDistanceMeters(
  [leftLongitude, leftLatitude]: StationCoordinate,
  [rightLongitude, rightLatitude]: StationCoordinate,
): number {
  const earthRadiusMeters = 6_371_000;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(rightLatitude - leftLatitude);
  const longitudeDelta = radians(rightLongitude - leftLongitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(leftLatitude)) * Math.cos(radians(rightLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
