import type { GroundAccessMode, GroundAccessPoint } from "@raiquora/trip/ground-access";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { GroundAccessProvider } from "../ports/ground-access-provider.js";

export function createGroundAccessSearchOperation(provider: GroundAccessProvider): AgentOperation {
  return async (request) => {
    const action = request.action;
    const mode = groundMode(request.mode);
    const origin = point(request.origin);
    const destinations = Array.isArray(request.destinations) ? request.destinations.flatMap((item) => point(item) ? [point(item)!] : []).slice(0, 9) : [];
    if (!mode || !origin || !["route", "matrix", "isochrone"].includes(String(action))) return { statusCode: 400, body: { message: "駅から目的地までの移動条件が不正です" } };
    const result = action === "route" && destinations.length === 1
      ? await provider.route(origin, destinations[0]!, mode)
      : action === "matrix" && destinations.length > 0
        ? await provider.matrix(origin, destinations, mode)
        : action === "isochrone" && Number.isInteger(request.minutes)
          ? await provider.isochrone(origin, request.minutes as number, mode)
          : undefined;
    return result ? { body: { groundAccess: result } } : { statusCode: 400, body: { message: "駅から目的地までの移動条件が不正です" } };
  };
}

function groundMode(value: unknown): GroundAccessMode | undefined { return value === "walking" || value === "driving" || value === "cycling" ? value : undefined; }
function point(value: unknown): GroundAccessPoint | undefined {
  if (!isRecord(value) || typeof value.entityId !== "string" || typeof value.name !== "string" || !finite(value.latitude) || !finite(value.longitude) || value.latitude < -90 || value.latitude > 90 || value.longitude < -180 || value.longitude > 180) return undefined;
  return { entityId: value.entityId.slice(0, 160), name: value.name.slice(0, 120), latitude: value.latitude, longitude: value.longitude };
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
