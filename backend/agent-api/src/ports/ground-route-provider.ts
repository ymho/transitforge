/** External graph search contract. Transport mode and scope are explicit. */
export interface GroundRouteCoverage {
  bounds: { south: number; west: number; north: number; east: number };
  serviceStart: string; serviceEnd: string; feedUrl: string; feedRetrievedAt: string;
  graphBuiltAt: string; attribution: string;
  /** Per-feed geography and dates; the aggregate envelope is only a summary. */
  feeds?: { feedId: string; bounds: GroundRouteCoverage["bounds"]; serviceStart: string; serviceEnd: string; feedUrl: string; attribution: string }[];
}
export interface RoutePoint { name: string; latitude: number; longitude: number }
export interface GroundRouteRequest { origin: RoutePoint; destination: RoutePoint; departureAt: string; mode: "walk" | "bus" }
export interface RouteLeg { mode: "walk" | "bus"; from: string; to: string; departureAt: string; arrivalAt: string;
  distanceMeters: number; geometry: [number, number][]; routeName?: string }
export interface GroundRoute { departureAt: string; arrivalAt: string; durationMinutes: number; legs: RouteLeg[] }
export type GroundRouteResult =
  | { status: "available"; routes: GroundRoute[]; coverage: GroundRouteCoverage; checkedAt: string }
  | { status: "no_route"; routes: []; coverage: GroundRouteCoverage; checkedAt: string }
  | { status: "outside_coverage"; reason: string; coverage: GroundRouteCoverage }
  | { status: "unavailable"; reason: string; coverage: GroundRouteCoverage };
export interface GroundRouteProvider { search(request: GroundRouteRequest, signal?: AbortSignal): Promise<GroundRouteResult> }
