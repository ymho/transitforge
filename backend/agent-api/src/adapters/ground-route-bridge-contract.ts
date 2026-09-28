import type { GroundRouteCoverage, GroundRouteRequest, GroundRouteResult, RouteLeg } from "../ports/ground-route-provider.js";

export function parseGroundRouteBridgeRequest(value: unknown): GroundRouteRequest {
  if (!record(value) || !point(value.origin) || !point(value.destination) ||
      typeof value.departureAt !== "string" || !Number.isFinite(Date.parse(value.departureAt)) ||
      value.mode !== "walk" && value.mode !== "bus") throw new Error("Invalid ground route request");
  return { origin: value.origin, destination: value.destination, departureAt: value.departureAt, mode: value.mode };
}

export function parseGroundRouteBridgeResult(value: unknown, expectedCoverage: GroundRouteCoverage,
  expectedMode: GroundRouteRequest["mode"]): GroundRouteResult {
  if (!record(value) || !sameCoverage(value.coverage, expectedCoverage)) throw new Error("Invalid ground route response");
  if (value.status === "outside_coverage" || value.status === "unavailable") {
    if (!short(value.reason, 500)) throw new Error("Invalid ground route response");
    return { status: value.status, reason: value.reason, coverage: expectedCoverage };
  }
  if (value.status !== "available" && value.status !== "no_route" || !Array.isArray(value.routes) ||
      !instant(value.checkedAt) || value.routes.length > 4) throw new Error("Invalid ground route response");
  if (value.status === "no_route") {
    if (value.routes.length) throw new Error("Invalid ground route response");
    return { status: "no_route", routes: [], coverage: expectedCoverage, checkedAt: value.checkedAt };
  }
  const routes = value.routes.map(route);
  if (!routes.length || routes.some(item => !item) || routes.some(item => expectedMode === "walk"
    ? item!.legs.some(entry => entry.mode !== "walk") : !item!.legs.some(entry => entry.mode === "bus")))
    throw new Error("Invalid ground route response");
  return { status: "available", routes: routes as NonNullable<ReturnType<typeof route>>[], coverage: expectedCoverage, checkedAt: value.checkedAt };
}

function route(value: unknown) {
  if (!record(value) || !instant(value.departureAt) || !instant(value.arrivalAt) || Date.parse(value.arrivalAt) < Date.parse(value.departureAt) ||
      typeof value.durationMinutes !== "number" || !Number.isSafeInteger(value.durationMinutes) || value.durationMinutes < 0 || value.durationMinutes > 2_880 ||
      !Array.isArray(value.legs) || !value.legs.length || value.legs.length > 8) return;
  const legs = value.legs.map(leg);
  if (legs.some(item => !item)) return;
  const parsed = legs as RouteLeg[];
  if (parsed[0]!.departureAt !== value.departureAt || parsed.at(-1)!.arrivalAt !== value.arrivalAt ||
      parsed.some((item, index) => index > 0 && Date.parse(item.departureAt) < Date.parse(parsed[index - 1]!.arrivalAt)) ||
      Math.ceil((Date.parse(value.arrivalAt) - Date.parse(value.departureAt)) / 60_000) !== value.durationMinutes) return;
  return { departureAt: value.departureAt, arrivalAt: value.arrivalAt, durationMinutes: value.durationMinutes, legs: parsed };
}
function leg(value: unknown): RouteLeg | undefined {
  if (!record(value) || value.mode !== "walk" && value.mode !== "bus" || !short(value.from, 120) || !short(value.to, 120) ||
      !instant(value.departureAt) || !instant(value.arrivalAt) || Date.parse(value.arrivalAt) < Date.parse(value.departureAt) ||
      typeof value.distanceMeters !== "number" || !Number.isSafeInteger(value.distanceMeters) || value.distanceMeters < 0 ||
      value.routeName !== undefined && !short(value.routeName, 120) || !Array.isArray(value.geometry) || value.geometry.length < 2 || value.geometry.length > 2_000 ||
      !value.geometry.every(coordinate)) return;
  return { mode: value.mode, from: value.from, to: value.to, departureAt: value.departureAt, arrivalAt: value.arrivalAt,
    distanceMeters: value.distanceMeters, geometry: value.geometry as [number, number][], ...(value.routeName ? { routeName: value.routeName } : {}) };
}
function point(value: unknown): value is { name: string; latitude: number; longitude: number } {
  return record(value) && short(value.name, 120) && finite(value.latitude) && Math.abs(value.latitude) <= 90 && finite(value.longitude) && Math.abs(value.longitude) <= 180;
}
function coordinate(value: unknown): value is [number, number] { return Array.isArray(value) && value.length === 2 && finite(value[0]) && Math.abs(value[0]) <= 180 && finite(value[1]) && Math.abs(value[1]) <= 90; }
function sameCoverage(value: unknown, expected: GroundRouteCoverage): boolean {
  if (!record(value) || !record(value.bounds)) return false;
  return value.bounds.south === expected.bounds.south && value.bounds.west === expected.bounds.west &&
    value.bounds.north === expected.bounds.north && value.bounds.east === expected.bounds.east &&
    value.serviceStart === expected.serviceStart && value.serviceEnd === expected.serviceEnd && value.feedUrl === expected.feedUrl &&
    value.feedRetrievedAt === expected.feedRetrievedAt && value.graphBuiltAt === expected.graphBuiltAt && value.attribution === expected.attribution;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function instant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function short(value: unknown, max: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= max; }
