import type { Trip } from "@raiquora/trip/trip";
import type { GroundRouteProvider, RoutePoint } from "../../ports/ground-route-provider.js";
import type { ServerAgentToolBinding } from "./server-tools.js";
import { placeAtTripItemEdge } from "./trip-gap-search-location.js";
import { stableContractHash } from "@raiquora/agent/output-contract";

/** Read-only Trip-bound OTP routing. Candidate coordinates are untrusted search inputs, never saved locations. */
export function tripGapGroundRouteTool(trip: Trip, provider: GroundRouteProvider,
  onEvidence?: (evidenceId: string, output: Record<string, unknown>) => void): ServerAgentToolBinding {
  return { descriptor: { name: "search_trip_gap_ground_routes", effect: "read",
    description: "Tripの指定予定から次の予定または未採用の候補地点までの徒歩/バス経路を検索する。候補の座標は入力ヒントでありTripへの採用・営業検証はしない。日時は時差付きで明示する。",
    prerequisite: ["trusted_trip_scope"], requiredCapabilities: ["trip.read"],
    inputSchema: { type: "object", additionalProperties: false, required: ["anchorItemId", "departureAt", "mode"], properties: {
      anchorItemId: { type: "string", minLength: 1, maxLength: 200 }, expectedRevision: { type: "integer", minimum: 0 },
      departureAt: { type: "string", minLength: 20, maxLength: 35 }, mode: { type: "string", enum: ["walk", "bus"] },
      destination: { type: "object", additionalProperties: false, required: ["name", "latitude", "longitude"], properties: {
        name: { type: "string", minLength: 1, maxLength: 120 }, latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
      } },
      checkNext: { type: "boolean" }, candidateStayMinutes: { type: "integer", minimum: 0, maximum: 360 },
      nextMode: { type: "string", enum: ["walk", "bus"] },
    } },
  }, operation: async (input, context) => {
    if (input.expectedRevision !== undefined && input.expectedRevision !== trip.revision) return fail(409, "stale_revision", "Tripが更新されました。再検索してください");
    const index = trip.items.findIndex(item => item.id === input.anchorItemId);
    if (index < 0) return fail(404, "not_found", "このTripに指定の予定はありません");
    const anchor = trip.items[index]!;
    const originPlace = placeAtTripItemEdge(anchor, "after");
    if (!originPlace?.coordinate) return fail(412, "precondition_missing", "出発地点の保存済み座標がありません");
    const next = trip.items[index + 1];
    const nextPlace = next && placeAtTripItemEdge(next, "before");
    const requested = input.destination as RoutePoint | undefined;
    if (input.checkNext && (!requested || !nextPlace?.coordinate || typeof input.candidateStayMinutes !== "number"))
      return fail(412, "precondition_missing", "候補から次の予定も調べるには候補座標・次の予定の座標・仮の滞在時間が必要です");
    const destination = requested ?? (nextPlace?.coordinate ? { name: nextPlace.name, ...nextPlace.coordinate } : undefined);
    if (!destination) return fail(412, "precondition_missing", "次の予定の座標がないため、候補地点の座標を指定してください");
    const departureAt = String(input.departureAt);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/u.test(departureAt) || !Number.isFinite(Date.parse(departureAt)) ||
      input.mode === "bus" && !departureAt.endsWith("+09:00"))
      return fail(400, "invalid_input", "時差付きの有効な出発日時を指定してください");
    const origin = { name: originPlace.name, ...originPlace.coordinate };
    const result = await provider.search({ origin, destination, departureAt, mode: input.mode as "walk" | "bus" }, context.signal);
    const anchorEnd = anchor.schedule.type === "fixed" ? anchor.schedule.endAt?.at : undefined;
    const nextTimeLimit = next?.schedule.type === "fixed" ? next.schedule.startAt.at :
      next?.schedule.type === "window" ? next.schedule.latestEnd.at : undefined;
    const nextDeadline = requested ? undefined : nextTimeLimit;
    const routes = result.status === "available" ? result.routes.map(route => ({ ...route,
      scheduleAssessment: anchorEnd && Date.parse(route.departureAt) < Date.parse(anchorEnd) ? "departs_before_anchor_end" :
        nextDeadline && Date.parse(route.arrivalAt) > Date.parse(nextDeadline) ? "arrives_after_next_deadline" :
        anchorEnd && nextDeadline ? "fits_known_bounds" : "insufficient_schedule" })) : undefined;
    const continuation = input.checkNext && result.status === "available" && nextPlace?.coordinate
      ? await Promise.all(result.routes.slice(0, 2).map(async (route, index) => {
        const fromCandidate = new Date(Date.parse(route.arrivalAt) + (input.candidateStayMinutes as number) * 60_000).toISOString();
        const afterStay = await provider.search({ origin: destination, destination: { name: nextPlace.name, ...nextPlace.coordinate! },
          departureAt: japanOffset(fromCandidate), mode: (input.nextMode ?? input.mode) as "walk" | "bus" }, context.signal);
        return { firstRouteIndex: index, requestedCandidateStayMinutes: input.candidateStayMinutes as number,
          result: afterStay.status === "available" ? { ...afterStay, routes: afterStay.routes.slice(0, 1) } : afterStay,
          scheduleAssessments: afterStay.status === "available" ? afterStay.routes.slice(0, 1).map(nextRoute =>
            nextTimeLimit ? Date.parse(nextRoute.arrivalAt) <= Date.parse(nextTimeLimit) ? "fits_next_deadline" : "arrives_after_next_deadline" : "next_time_unknown") : [] };
      })) : undefined;
    return { body: { groundRoutes: result, searchContext: { tripId: trip.id, sourceRevision: trip.revision,
      anchorItemId: anchor.id, ...(next ? { nextItemId: next.id } : {}),
      originSource: originPlace.sources.length ? "retained-provider-snapshot" : "unverified-manual-snapshot",
      destinationSource: requested ? "unverified-candidate-coordinate" : nextPlace?.sources.length ? "retained-provider-snapshot" : "unverified-manual-snapshot",
      ...(routes ? { routeScheduleAssessments: routes.map(route => route.scheduleAssessment),
        ...(anchorEnd ? { anchorEnd } : {}), ...(nextDeadline ? { nextDeadline } : {}) } : {}),
      ...(continuation ? { continuation, candidateStayBasis: "unverified-planning-assumption" } : {}),
      tripScheduleVerified: !!anchorEnd && !!nextDeadline && !!routes?.length, openingHoursVerified: false, adopted: false } } };
  }, evidence: (output, context) => {
    if (!record(output) || !record(output.searchContext) || !record(output.groundRoutes)) return [];
    const scope = output.searchContext, result = output.groundRoutes;
    if (typeof scope.tripId !== "string" || !Number.isSafeInteger(scope.sourceRevision) || typeof scope.anchorItemId !== "string" ||
      !record(result.coverage)) return [];
    const coverage = result.coverage;
    const hash = stableContractHash({ anchorItemId: scope.anchorItemId, queryFingerprint: context.queryFingerprint }).slice(0, 16);
    const routes = Array.isArray(result.routes) ? result.routes : [];
    const facts = { status: result.status as string, anchorItemId: scope.anchorItemId as string,
      ...(typeof scope.nextItemId === "string" ? { nextItemId: scope.nextItemId } : {}),
      ...(result.status === "available" ? { routeSummaries: routes.filter(record).slice(0, 3).map(route =>
        `${String(route.departureAt)} → ${String(route.arrivalAt)} (${String(route.durationMinutes)}分); ${Array.isArray(route.legs) ? route.legs.filter(record).map(leg => `${leg.mode === "bus" ? "バス" : "徒歩"} ${String(leg.from)} → ${String(leg.to)} ${String(leg.departureAt)}–${String(leg.arrivalAt)}${typeof leg.routeName === "string" ? ` ${leg.routeName}` : ""}`).join(" / ") : ""}`.slice(0, 500)) } : {}),
      serviceStart: coverage.serviceStart as string, serviceEnd: coverage.serviceEnd as string,
      ...(Array.isArray(scope.routeScheduleAssessments) ? { routeScheduleAssessments: scope.routeScheduleAssessments.filter((item): item is string => typeof item === "string") } : {}),
      ...(Array.isArray(scope.continuation) ? { nextLegAssessments: scope.continuation.filter(record).map(item =>
        `候補の滞在${String(item.requestedCandidateStayMinutes)}分（仮定）後、次の予定まで: ${record(item.result) ? String(item.result.status) : "unknown"} / ${Array.isArray(item.scheduleAssessments) ? item.scheduleAssessments.join(",") : ""}`) } : {}),
      tripScheduleVerified: scope.tripScheduleVerified === true, openingHoursVerified: false, adopted: false };
    const id = `trip-ground-route:${context.executionId}:${scope.sourceRevision}:${hash}`;
    if (result.status === "available") onEvidence?.(id, output);
    return [{ id, category: "external", knowledgeKind: "deterministic_fact",
      subject: `trip:${scope.tripId}`, facts, references: [{ sourceType: "external-source", sourceRef: typeof coverage.feedUrl === "string" ? coverage.feedUrl : "otp-graph",
        retrievedAt: typeof result.checkedAt === "string" ? result.checkedAt : context.retrievedAt,
        freshness: "unknown", summary: `OTP経路とGTFS/OSMグラフ。GTFS取得: ${String(coverage.feedRetrievedAt)}、グラフ作成: ${String(coverage.graphBuiltAt)}。時刻は予定で、現在の運行・現地営業は未確認` }], coverage: ["trip.itinerary"] }];
  } };
}
function fail(statusCode: number, code: string, message: string) { return { statusCode, body: { code, message } }; }
function japanOffset(value: string): string { return new Date(Date.parse(value) + 9 * 60 * 60_000).toISOString().slice(0, 19) + "+09:00"; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
