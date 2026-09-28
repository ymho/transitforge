import { parsePublicGroundRoutePresentation, publicGroundRouteVersion, type PublicGroundRoutePresentation } from "@raiquora/agent/public-ground-route-presentation";

/** Publish only a route referenced by the admitted answer; never forward raw OTP or unreferenced search results. */
export function projectGroundRoutePresentation(evidenceId: string, output: Record<string, unknown>): PublicGroundRoutePresentation | undefined {
  const result = output.groundRoutes, context = output.searchContext;
  if (!record(result) || result.status !== "available" || !Array.isArray(result.routes) || !record(result.coverage) || !record(context)) return;
  const coverage = result.coverage;
  if (typeof coverage.feedUrl !== "string" || !coverage.feedUrl.startsWith("https://") || typeof coverage.feedRetrievedAt !== "string" ||
    typeof coverage.attribution !== "string" || typeof result.checkedAt !== "string") return;
  const first = result.routes[0];
  if (!record(first) || !Array.isArray(first.legs) || !first.legs.length) return;
  const continuation = Array.isArray(context.continuation) && record(context.continuation[0]) ? context.continuation[0] : undefined;
  const nextResult = continuation && record(continuation.result) && continuation.result.status === "available" && Array.isArray(continuation.result.routes)
    ? continuation.result.routes[0] : undefined;
  const nextRoute = record(nextResult) && Array.isArray(nextResult.legs) && nextResult.legs.length ? nextResult : undefined;
  const firstLegs = first.legs as unknown[], secondLegs = nextRoute?.legs as unknown[] | undefined;
  const origin = firstLegs[0], destination = secondLegs ? secondLegs[secondLegs.length - 1] : firstLegs[firstLegs.length - 1];
  if (!record(origin) || !record(destination)) return;
  try {
    return parsePublicGroundRoutePresentation({ version: publicGroundRouteVersion, evidenceId, checkedAt: result.checkedAt,
      feedRetrievedAt: coverage.feedRetrievedAt, sourceUrl: coverage.feedUrl, attribution: coverage.attribution,
      originName: origin.from, destinationName: destination.to,
      routes: result.routes.slice(0, 1).filter(record).map(route => ({ departureAt: route.departureAt,
        arrivalAt: nextRoute ? nextRoute.arrivalAt : route.arrivalAt,
        durationMinutes: nextRoute ? Math.ceil((Date.parse(String(nextRoute.arrivalAt)) - Date.parse(String(route.departureAt))) / 60_000) : route.durationMinutes,
        ...(nextRoute ? { via: { name: String((firstLegs.at(-1) as Record<string, unknown>).to),
          stayMinutes: continuation!.requestedCandidateStayMinutes,
          afterLegIndex: firstLegs.length,
          nextDeadlineAssessment: Array.isArray(continuation!.scheduleAssessments) ? continuation!.scheduleAssessments[0] : "next_time_unknown" } } : {}),
        legs: [...(Array.isArray(route.legs) ? route.legs : []), ...(secondLegs ?? [])].filter(record).map(leg => ({
          mode: leg.mode, originName: leg.from, destinationName: leg.to, departureAt: leg.departureAt, arrivalAt: leg.arrivalAt,
          ...(typeof leg.routeName === "string" ? { routeName: leg.routeName } : {}),
          geometry: Array.isArray(leg.geometry) ? decimate(leg.geometry) : [],
        })) })) });
  } catch { return; }
}
function decimate(geometry: unknown[]): unknown[] {
  if (geometry.length <= 300) return geometry;
  const step = (geometry.length - 1) / 299;
  return Array.from({ length: 300 }, (_, index) => geometry[Math.round(index * step)]);
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
