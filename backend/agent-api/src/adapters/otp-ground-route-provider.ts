/** OTP GraphQL GTFS API adapter. The graph is built from OSM and a separately versioned GTFS feed. */
import type { GroundRouteCoverage, RoutePoint, GroundRouteRequest, RouteLeg, GroundRoute, GroundRouteResult, GroundRouteProvider } from "../ports/ground-route-provider.js";

const planQuery = `query Route($origin: PlanLabeledLocationInput!, $destination: PlanLabeledLocationInput!, $dateTime: PlanDateTimeInput!, $modes: PlanModesInput!) {
  planConnection(origin: $origin, destination: $destination, dateTime: $dateTime, modes: $modes, first: 4) {
    edges { node { start end duration legs {
      mode distance start { scheduledTime } end { scheduledTime }
      from { name } to { name } route { shortName longName }
      legGeometry { points }
    } } }
    routingErrors { code }
  }
}`;

export class OtpGroundRouteProvider implements GroundRouteProvider {
  constructor(private readonly endpoint: string, private readonly coverage: GroundRouteCoverage,
    private readonly http: { fetch(input: string, init?: RequestInit): Promise<Response> } = globalThis,
    private readonly now: () => Date = () => new Date()) {}

  async search(request: GroundRouteRequest, signal?: AbortSignal): Promise<GroundRouteResult> {
    const { origin, destination, departureAt, mode } = request;
    if (![origin, destination].every(point => inside(point, this.coverage.bounds)) ||
      this.coverage.feeds && ![origin, destination].every(point => this.coverage.feeds!.some(feed => inside(point, feed.bounds) &&
        (mode === "walk" || departureAt.slice(0, 10) >= feed.serviceStart && departureAt.slice(0, 10) <= feed.serviceEnd))) ||
      mode === "bus" && (departureAt.slice(0, 10) < this.coverage.serviceStart || departureAt.slice(0, 10) > this.coverage.serviceEnd)) {
      return { status: "outside_coverage", reason: "地点または運行日が登録済みの提供範囲外です", coverage: this.coverage };
    }
    try {
      const response = await this.http.fetch(this.endpoint, {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query: planQuery, variables: {
          origin: location(origin), destination: location(destination), dateTime: { earliestDeparture: departureAt },
          modes: mode === "walk" ? { direct: ["WALK"], directOnly: true } :
            { transitOnly: true, transit: { transit: [{ mode: "BUS" }], access: ["WALK"], egress: ["WALK"], transfer: ["WALK"] } },
        } }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error("OTP HTTP failure");
      const body: unknown = await response.json();
      if (!record(body) || Array.isArray(body.errors) && body.errors.length || !record(body.data) || !record(body.data.planConnection)) throw new Error("OTP GraphQL failure");
      const connection = body.data.planConnection;
      if (!Array.isArray(connection.edges)) throw new Error("OTP malformed response");
      const routingErrors = connection.routingErrors;
      if (routingErrors !== undefined && !Array.isArray(routingErrors)) throw new Error("OTP malformed routing errors");
      if (Array.isArray(routingErrors) && routingErrors.length && !connection.edges.length) {
        const codes = routingErrors.map(error => record(error) ? error.code : undefined);
        if (codes.every(code => code === "OUTSIDE_BOUNDS" || code === "OUTSIDE_SERVICE_PERIOD"))
          return { status: "outside_coverage", reason: "地点または運行日がグラフの提供範囲外です", coverage: this.coverage };
        if (codes.every(code => code === "LOCATION_NOT_FOUND" || code === "NO_DIRECT_MODE_CONNECTION" ||
            code === "NO_STOPS_IN_RANGE" || code === "NO_TRANSIT_CONNECTION" ||
            code === "NO_TRANSIT_CONNECTION_IN_SEARCH_WINDOW" || code === "WALKING_BETTER_THAN_TRANSIT"))
          return { status: "no_route", routes: [], coverage: this.coverage, checkedAt: this.now().toISOString() };
        throw new Error("OTP routing error");
      }
      const routes = connection.edges.slice(0, 4).map(edge => parseRoute(edge, mode)).filter((route): route is GroundRoute => !!route);
      if (connection.edges.length && !routes.length) throw new Error("OTP malformed itinerary");
      const checkedAt = this.now().toISOString();
      return routes.length ? { status: "available", routes, coverage: this.coverage, checkedAt } :
        { status: "no_route", routes: [], coverage: this.coverage, checkedAt };
    } catch {
      return { status: "unavailable", reason: "経路検索サービスに接続できないか、応答を検証できません", coverage: this.coverage };
    }
  }
}

function location(point: RoutePoint) { return { label: point.name, location: { coordinate: { latitude: point.latitude, longitude: point.longitude } } }; }
function inside(point: RoutePoint, bounds: GroundRouteCoverage["bounds"]) {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
    point.latitude >= bounds.south && point.latitude <= bounds.north && point.longitude >= bounds.west && point.longitude <= bounds.east;
}
function parseRoute(edge: unknown, requestedMode: GroundRouteRequest["mode"]): GroundRoute | undefined {
  if (!record(edge) || !record(edge.node) || !Array.isArray(edge.node.legs)) return;
  const node = edge.node;
  const rawLegs = node.legs as unknown[];
  const legs = rawLegs.map(parseLeg).filter((leg): leg is RouteLeg => !!leg);
  if (!legs.length || legs.length !== rawLegs.length || legs.length > 8 ||
    (requestedMode === "bus" && !legs.some(leg => leg.mode === "bus")) ||
    (requestedMode === "walk" && legs.some(leg => leg.mode !== "walk"))) return;
  const first = legs[0]!, last = legs[legs.length - 1]!;
  if (Date.parse(last.arrivalAt) < Date.parse(first.departureAt) ||
      legs.some((leg, i) => i > 0 && Date.parse(leg.departureAt) < Date.parse(legs[i - 1]!.arrivalAt))) return;
  return { departureAt: first.departureAt, arrivalAt: last.arrivalAt,
    durationMinutes: Math.ceil((Date.parse(last.arrivalAt) - Date.parse(first.departureAt)) / 60_000), legs };
}
function parseLeg(value: unknown): RouteLeg | undefined {
  if (!record(value) || value.mode !== "WALK" && value.mode !== "BUS" || !record(value.start) || !record(value.end) ||
    typeof value.start.scheduledTime !== "string" || typeof value.end.scheduledTime !== "string" ||
    !Number.isFinite(Date.parse(value.start.scheduledTime)) || !Number.isFinite(Date.parse(value.end.scheduledTime)) ||
    Date.parse(value.end.scheduledTime) < Date.parse(value.start.scheduledTime) || !record(value.from) || !record(value.to) ||
    typeof value.from.name !== "string" || typeof value.to.name !== "string" ||
    typeof value.distance !== "number" || !Number.isFinite(value.distance) || value.distance < 0 ||
    !record(value.legGeometry) || typeof value.legGeometry.points !== "string") return;
  const geometry = decodePolyline(value.legGeometry.points);
  if (geometry.length < 2) return;
  const route = record(value.route) ? value.route : undefined;
  return { mode: value.mode === "BUS" ? "bus" : "walk", from: value.from.name.slice(0, 120), to: value.to.name.slice(0, 120),
    departureAt: value.start.scheduledTime, arrivalAt: value.end.scheduledTime,
    distanceMeters: Math.round(value.distance), geometry,
    ...(value.mode === "BUS" && typeof route?.shortName === "string" ? { routeName: route.shortName.slice(0, 120) } : {}) };
}
/** Encoded polyline uses latitude/longitude deltas at 1e-5 degree precision. GeoJSON uses [longitude,latitude]. */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = []; let latitude = 0, longitude = 0, index = 0;
  while (index < encoded.length && points.length < 2_000) {
    const next = () => { let result = 0, shift = 0, value: number;
      do { if (index >= encoded.length || shift > 30) return; value = encoded.charCodeAt(index++) - 63;
        if (value < 0 || value > 63) return; result |= (value & 31) << shift; shift += 5;
      } while (value >= 32);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    const lat = next(), lon = next(); if (lat === undefined || lon === undefined) return [];
    latitude += lat; longitude += lon;
    if (Math.abs(latitude) > 9_000_000 || Math.abs(longitude) > 18_000_000) return [];
    points.push([longitude / 1e5, latitude / 1e5]);
  }
  return index === encoded.length ? points : [];
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
