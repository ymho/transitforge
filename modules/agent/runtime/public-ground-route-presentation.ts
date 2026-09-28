/** Public, read-only route preview. Geometry belongs to an OTP observation, not to a saved Trip item. */
export const publicGroundRouteVersion = "public-ground-route-v1" as const;
export interface PublicGroundRoutePresentation {
  version: typeof publicGroundRouteVersion;
  evidenceId: string;
  checkedAt: string;
  feedRetrievedAt: string;
  sourceUrl: string;
  attribution: string;
  originName: string;
  destinationName: string;
  routes: Array<{ departureAt: string; arrivalAt: string; durationMinutes: number;
    via?: { name: string; stayMinutes: number; afterLegIndex: number; nextDeadlineAssessment: string };
    legs: Array<{ mode: "walk" | "bus"; originName: string; destinationName: string; departureAt: string; arrivalAt: string;
      routeName?: string; geometry: [number, number][] }> }>;
}
export function parsePublicGroundRoutePresentation(value: unknown): PublicGroundRoutePresentation {
  if (!record(value) || !exact(value, ["version", "evidenceId", "checkedAt", "feedRetrievedAt", "sourceUrl", "attribution", "originName", "destinationName", "routes"]) ||
    value.version !== publicGroundRouteVersion || !short(value.evidenceId, 500) || !date(value.checkedAt) ||
    !date(value.feedRetrievedAt) || !short(value.sourceUrl, 500) || !/^https:\/\//u.test(value.sourceUrl) ||
    !short(value.attribution, 200) || !short(value.originName, 160) || !short(value.destinationName, 160) ||
    !Array.isArray(value.routes) || !value.routes.length || value.routes.length > 3 || !value.routes.every(route =>
      record(route) && exact(route, ["departureAt", "arrivalAt", "durationMinutes", "legs", "via"]) && date(route.departureAt) && date(route.arrivalAt) &&
      typeof route.durationMinutes === "number" && Number.isSafeInteger(route.durationMinutes) && route.durationMinutes >= 0 && route.durationMinutes <= 2_880 &&
      (route.via === undefined || record(route.via) && exact(route.via, ["name", "stayMinutes", "afterLegIndex", "nextDeadlineAssessment"]) &&
        short(route.via.name, 160) && typeof route.via.stayMinutes === "number" && Number.isSafeInteger(route.via.stayMinutes) &&
        route.via.stayMinutes >= 0 && route.via.stayMinutes <= 360 && typeof route.via.afterLegIndex === "number" &&
        Number.isSafeInteger(route.via.afterLegIndex) && route.via.afterLegIndex >= 1 && route.via.afterLegIndex <= 8 &&
        short(route.via.nextDeadlineAssessment, 80)) &&
      Array.isArray(route.legs) && route.legs.length >= 1 && route.legs.length <= 16 && route.legs.every(leg =>
        record(leg) && exact(leg, ["mode", "originName", "destinationName", "departureAt", "arrivalAt", "routeName", "geometry"]) &&
        (leg.mode === "walk" || leg.mode === "bus") && short(leg.originName, 160) && short(leg.destinationName, 160) &&
        date(leg.departureAt) && date(leg.arrivalAt) && (leg.routeName === undefined || short(leg.routeName, 160)) &&
        Array.isArray(leg.geometry) && leg.geometry.length >= 2 && leg.geometry.length <= 300 && leg.geometry.every(coordinate =>
          Array.isArray(coordinate) && coordinate.length === 2 && typeof coordinate[0] === "number" && typeof coordinate[1] === "number" &&
          Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]) && Math.abs(coordinate[0]) <= 180 && Math.abs(coordinate[1]) <= 90)))
    ) throw new Error("Invalid public ground route presentation");
  return structuredClone(value) as unknown as PublicGroundRoutePresentation;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
function short(value: unknown, limit: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= limit; }
function date(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && value.length <= 35; }
