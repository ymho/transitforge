import { availableExternalInformation, failedExternalInformation, type ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { GroundAccessArea, GroundAccessMatrix, GroundAccessMode, GroundAccessPoint, GroundAccessProvider, GroundAccessRoute, GroundCoordinate } from "@raiquora/trip/ground-access";
import type { MapboxSearchCredentialsRepository } from "../ports/mapbox-search-credentials.js";

interface FetchPort { fetch(input: string, init?: RequestInit): Promise<Response> }
const navigationBase = "https://api.mapbox.com";

export class MapboxGroundAccessProvider implements GroundAccessProvider {
  constructor(private readonly http: FetchPort, private readonly credentials: MapboxSearchCredentialsRepository, private readonly now: () => Date = () => new Date()) {}

  route(origin: GroundAccessPoint, destination: GroundAccessPoint, mode: GroundAccessMode): Promise<ExternalTravelInformation<GroundAccessRoute>> {
    return this.request("directions", async (token) => {
      const coordinates = `${coordinateText(origin)};${coordinateText(destination)}`;
      const params = new URLSearchParams({ access_token: token, geometries: "geojson", overview: "full", steps: "false" });
      const value = await this.json(`${navigationBase}/directions/v5/mapbox/${mode}/${coordinates}?${params}`);
      const first = isRecord(value) && Array.isArray(value.routes) ? value.routes[0] : undefined;
      if (!isRecord(first) || !finite(first.duration) || !finite(first.distance) || !isRecord(first.geometry)) return undefined;
      const geometry = lineCoordinates(first.geometry.coordinates);
      return geometry.length >= 2 ? { origin, destination, mode, durationMinutes: roundedMinutes(first.duration), distanceMeters: Math.round(first.distance), geometry } : undefined;
    });
  }

  matrix(origin: GroundAccessPoint, destinations: GroundAccessPoint[], mode: GroundAccessMode): Promise<ExternalTravelInformation<GroundAccessMatrix>> {
    if (destinations.length < 1 || destinations.length > 9) return Promise.resolve(failedExternalInformation({ code: "invalid_request", message: "比較する地点数が不正です", retryable: false }));
    return this.request("matrix", async (token) => {
      const points = [origin, ...destinations];
      const params = new URLSearchParams({ access_token: token, sources: "0", annotations: "duration,distance" });
      const value = await this.json(`${navigationBase}/directions-matrix/v1/mapbox/${mode}/${points.map(coordinateText).join(";")}?${params}`);
      if (!isRecord(value) || !Array.isArray(value.durations) || !Array.isArray(value.distances)) return undefined;
      const durations = Array.isArray(value.durations[0]) ? value.durations[0] : [];
      const distances = Array.isArray(value.distances[0]) ? value.distances[0] : [];
      return { origin, mode, entries: destinations.map((destination, index) => ({
        destination,
        ...(finite(durations[index + 1]) ? { durationMinutes: roundedMinutes(durations[index + 1]) } : {}),
        ...(finite(distances[index + 1]) ? { distanceMeters: Math.round(distances[index + 1]) } : {}),
      })) };
    });
  }

  isochrone(origin: GroundAccessPoint, minutes: number, mode: GroundAccessMode): Promise<ExternalTravelInformation<GroundAccessArea>> {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) return Promise.resolve(failedExternalInformation({ code: "invalid_request", message: "到達圏の時間が不正です", retryable: false }));
    return this.request("isochrone", async (token) => {
      const params = new URLSearchParams({ access_token: token, contours_minutes: String(minutes), polygons: "true", denoise: "1", generalize: "50" });
      const value = await this.json(`${navigationBase}/isochrone/v1/mapbox/${mode}/${coordinateText(origin)}?${params}`);
      const feature = isRecord(value) && Array.isArray(value.features) ? value.features[0] : undefined;
      if (!isRecord(feature) || !isRecord(feature.geometry)) return undefined;
      const polygons = polygonCoordinates(feature.geometry.coordinates);
      return polygons.length ? { origin, mode, minutes, polygons } : undefined;
    });
  }

  private async request<T>(source: string, load: (token: string) => Promise<T | undefined>): Promise<ExternalTravelInformation<T>> {
    try {
      const credentials = await this.credentials.load();
      if (!credentials) return failedExternalInformation({ code: "unauthorized", message: "Mapbox Navigationの認証情報が設定されていません", retryable: false });
      const data = await load(credentials.accessToken);
      if (!data) return failedExternalInformation({ code: "invalid_response", message: "Mapbox Navigationの応答形式が不正です", retryable: true });
      const retrievedAt = this.now();
      return availableExternalInformation(data, [{ id: `ground-access:mapbox:${source}:${retrievedAt.toISOString()}`, kind: "ground-access", provider: "mapbox", sourceUrl: "https://www.mapbox.com/", retrievedAt: retrievedAt.toISOString(), validUntil: new Date(retrievedAt.getTime() + 15 * 60_000).toISOString(), attribution: "© Mapbox", confidence: "provider-forecast" }], retrievedAt);
    } catch {
      return failedExternalInformation({ code: "unavailable", message: "駅から目的地までの移動を検索できません", retryable: true });
    }
  }

  private async json(url: string): Promise<unknown> {
    const response = await this.http.fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Mapbox ${response.status}`);
    return response.json();
  }
}

function coordinateText(point: GroundCoordinate): string { return `${point.longitude},${point.latitude}`; }
function roundedMinutes(seconds: number): number { return Math.max(1, Math.round(seconds / 60)); }
function lineCoordinates(value: unknown): GroundCoordinate[] {
  return Array.isArray(value) ? value.slice(0, 2_000).flatMap((item) => Array.isArray(item) && finite(item[0]) && finite(item[1]) ? [{ longitude: item[0], latitude: item[1] }] : []) : [];
}
function polygonCoordinates(value: unknown): GroundCoordinate[][] {
  if (!Array.isArray(value)) return [];
  const rings = Array.isArray(value[0]) && Array.isArray(value[0][0]) && typeof value[0][0][0] === "number" ? value : value.flat(1);
  return rings.slice(0, 8).map(lineCoordinates).filter((ring) => ring.length >= 4);
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
