import type { Trip } from "@raiquora/trip/trip";
import type { Coordinate } from "@raiquora/train/path";
import type { TrainIndex } from "@raiquora/train/train";
import { normalizeStationName } from "@raiquora/train/station-name";
import { PathGeometryIndex } from "./train-position";

export interface TripRouteGeometry {
  readonly itemId: string;
  readonly legId: string;
  readonly coordinates: readonly Coordinate[];
}

/** Resolve only an adopted rail leg that still exactly identifies the loaded timetable service and stops. */
export function projectTripRouteGeometry(trip: Trip, index: TrainIndex, geometry: PathGeometryIndex): TripRouteGeometry[] {
  const routes: TripRouteGeometry[] = [];
  for (const item of trip.items) {
    if (item.type !== "transport" || item.detail.status !== "selected" || item.detail.mode !== "rail") continue;
    for (const leg of item.detail.journey.legs) {
      if (index.service_date !== undefined && index.service_date !== leg.serviceDate) continue;
      const matches = index.trains.filter((train) => train.service_uid === leg.serviceUid && train.train_no === leg.trainNumber);
      if (matches.length !== 1) continue;
      const train = matches[0]!, origin = train.stops[leg.originStopIndex], destination = train.stops[leg.destinationStopIndex];
      if (!train.path_id || !origin?.station_name || !destination?.station_name ||
          normalizeStationName(origin.station_name) !== normalizeStationName(leg.origin.name) ||
          normalizeStationName(destination.station_name) !== normalizeStationName(leg.destination.name) ||
          typeof origin.route_meter !== "number" || typeof destination.route_meter !== "number") continue;
      const coordinates = geometry.coordinatesBetween(train.path_id, origin.route_meter, destination.route_meter);
      if (coordinates && coordinates.length >= 2) routes.push({ itemId: item.id, legId: leg.id, coordinates });
    }
  }
  return routes;
}
