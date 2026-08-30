import type { ExternalTravelInformation } from "./external-travel-information";

export type GroundAccessMode = "walking" | "driving" | "cycling";
export interface GroundCoordinate { latitude: number; longitude: number }
export interface GroundAccessPoint extends GroundCoordinate { entityId: string; name: string }
export interface GroundAccessRoute {
  origin: GroundAccessPoint;
  destination: GroundAccessPoint;
  mode: GroundAccessMode;
  durationMinutes: number;
  distanceMeters: number;
  geometry: GroundCoordinate[];
}
export interface GroundAccessMatrixEntry {
  destination: GroundAccessPoint;
  durationMinutes?: number;
  distanceMeters?: number;
}
export interface GroundAccessMatrix {
  origin: GroundAccessPoint;
  mode: GroundAccessMode;
  entries: GroundAccessMatrixEntry[];
}
export interface GroundAccessArea {
  origin: GroundAccessPoint;
  mode: GroundAccessMode;
  minutes: number;
  polygons: GroundCoordinate[][];
}
export interface GroundAccessProvider {
  route(origin: GroundAccessPoint, destination: GroundAccessPoint, mode: GroundAccessMode): Promise<ExternalTravelInformation<GroundAccessRoute>>;
  matrix(origin: GroundAccessPoint, destinations: GroundAccessPoint[], mode: GroundAccessMode): Promise<ExternalTravelInformation<GroundAccessMatrix>>;
  isochrone(origin: GroundAccessPoint, minutes: number, mode: GroundAccessMode): Promise<ExternalTravelInformation<GroundAccessArea>>;
}
