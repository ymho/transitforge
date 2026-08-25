import type { StationCoordinate, StationLineCatalog } from "./rail/station";
import type { Train, TrainStop } from "./rail/train";
import type {
  JourneyRankingPreference,
  TransferPace,
} from "./journey-search-preferences";
import { normalizeStationName } from "./station-name";

export { normalizeStationName } from "./station-name";

export interface DirectRouteResult {
  train: Train;
  originStation: string;
  destinationStation: string;
  departureTimeMinutes: number;
  arrivalTimeMinutes: number;
}

export interface JourneyRouteLeg {
  serviceUid: string;
  trainNumber: string;
  serviceType: string;
  trainName: string;
  serviceDestination?: string;
  originStation: string;
  destinationStation: string;
  departureTimeMinutes: number;
  arrivalTimeMinutes: number;
  scheduledDepartureTimeMinutes?: number;
  scheduledArrivalTimeMinutes?: number;
  delayMinutes?: number;
  delayStatus?: "observed" | "estimated";
  delaySampleCount?: number;
  delayBasis?: string;
  lineName?: string;
  lineColor?: string;
  stops?: JourneyRouteStop[];
}

export interface JourneyRouteStop {
  stationName: string;
  arrivalTimeMinutes?: number;
  departureTimeMinutes?: number;
}

export interface JourneyRouteResult {
  departureTimeMinutes: number;
  arrivalTimeMinutes: number;
  transferCount: number;
  legs: JourneyRouteLeg[];
}

export interface NearestDirectOrigin {
  stationName: string;
  distanceMeters: number;
}

export interface DirectRouteSearchResponse {
  originStation: string;
  serviceDate?: string;
  departureDate?: string;
  transferPace?: TransferPace;
  rankingPreference?: JourneyRankingPreference;
  maxTransfers?: number;
  excludedServiceTypes?: string[];
  excludedTrainNames?: string[];
  excludedTrainNumbers?: string[];
  excludedServiceUids?: string[];
  requiredServiceTypes?: string[];
  requiredTrainNames?: string[];
  requiredTrainNumbers?: string[];
  allowedServiceTypes?: string[];
  distanceMeters?: number;
  results: DirectRouteResult[];
  journeys?: JourneyRouteResult[];
}

export type DirectRouteSearchHandler = (request: {
  originStation?: string;
  destinationStation: string;
  departureTimeMinutes: number;
  serviceDate?: string;
  departureDate?: string;
  transferPace?: TransferPace;
  rankingPreference?: JourneyRankingPreference;
  maxTransfers?: 0 | 1 | 2 | 3;
  excludedServiceTypes?: string[];
  excludedTrainNames?: string[];
  excludedTrainNumbers?: string[];
  excludedServiceUids?: string[];
  requiredServiceTypes?: string[];
  requiredTrainNames?: string[];
  requiredTrainNumbers?: string[];
  allowedServiceTypes?: string[];
}) => Promise<DirectRouteSearchResponse>;

export function directRouteDepartureTime(
  requestedTimeMinutes: number | undefined,
  currentRouteTimeMinutes: number,
  maximumRouteTimeMinutes: number,
): number {
  const candidate = requestedTimeMinutes ?? currentRouteTimeMinutes;
  return Math.max(0, Math.min(Math.round(candidate), maximumRouteTimeMinutes));
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

  return nearestCatalogStation(catalog, eligibleOrigins, userCoordinate);
}

export function nearestOriginWithDepartures(
  trains: Train[],
  catalog: StationLineCatalog,
  departureTimeMinutes: number,
  userCoordinate: StationCoordinate,
): NearestDirectOrigin | undefined {
  const eligibleOrigins = new Set<string>();
  for (const train of trains) {
    const groups = groupedStops(train.stops);
    for (const group of groups.slice(0, -1)) {
      const departure = departureTimeFor(group);
      if (departure !== undefined && departure >= departureTimeMinutes) {
        eligibleOrigins.add(group.normalizedName);
      }
    }
  }
  return nearestCatalogStation(catalog, eligibleOrigins, userCoordinate);
}

function nearestCatalogStation(
  catalog: StationLineCatalog,
  eligibleStations: ReadonlySet<string>,
  userCoordinate: StationCoordinate,
): NearestDirectOrigin | undefined {
  let nearest: NearestDirectOrigin | undefined;
  for (const line of catalog.lines) {
    for (const station of line.stations) {
      if (!eligibleStations.has(normalizeStationName(station.name))) {
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
