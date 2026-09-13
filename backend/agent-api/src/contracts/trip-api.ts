import { validateTrip, type Trip } from "@raiquora/trip/trip";

export const tripApiVersion = "trip-api-v1";
export const tripApiLimits = { bodyBytes: 256 * 1024, items: 100, constraints: 100, assumptions: 100, stringLength: 4096, arrayLength: 1000, depth: 32 } as const;
export type TripErrorCode = "unauthenticated" | "not-found" | "already-exists" | "invalid-input" | "payload-too-large" | "unavailable";
/** Constant categories only: never propagate SDK/Domain messages containing private data. */
export class TripResourceError extends Error {
  constructor(readonly code: TripErrorCode) { super(code); }
}
export function tripIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) throw new TripResourceError("invalid-input");
}
export function conversationIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new TripResourceError("invalid-input");
}
export function boundedTrip(value: unknown): Trip {
  checkBounds(value);
  try {
    const trip = value as Trip;
    if (!Array.isArray(trip?.items) || !Array.isArray(trip.request?.constraints) || !Array.isArray(trip.request?.assumptions)) throw new Error();
    if (trip.items.length > tripApiLimits.items || trip.request.constraints.length > tripApiLimits.constraints || trip.request.assumptions.length > tripApiLimits.assumptions) throw new TripResourceError("payload-too-large");
    validateTrip(trip);
    if (Buffer.byteLength(JSON.stringify(trip), "utf8") > tripApiLimits.bodyBytes) throw new TripResourceError("payload-too-large");
    return structuredClone(trip);
  } catch (error) {
    if (error instanceof TripResourceError) throw error;
    throw new TripResourceError("invalid-input");
  }
}
function checkBounds(value: unknown, depth = 0): void {
  if (depth > tripApiLimits.depth || typeof value === "string" && value.length > tripApiLimits.stringLength || Array.isArray(value) && value.length > tripApiLimits.arrayLength) throw new TripResourceError("payload-too-large");
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) checkBounds(child, depth + 1);
  } else if (typeof value === "number" && !Number.isFinite(value)) throw new TripResourceError("invalid-input");
}
export type TripApiCommand =
  | { version: typeof tripApiVersion; operation: "create" | "replace"; trip: Trip }
  | { version: typeof tripApiVersion; operation: "get" | "archive"; tripId: string }
  | { version: typeof tripApiVersion; operation: "list"; afterTripId?: string; limit?: number }
  | { version: typeof tripApiVersion; operation: "attach"; conversationId: string; tripId: string }
  | { version: typeof tripApiVersion; operation: "detach" | "reference"; conversationId: string };

export function parseTripCommand(value: unknown): TripApiCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TripResourceError("invalid-input");
  const v = value as Record<string, unknown>;
  if (v.version !== tripApiVersion) throw new TripResourceError("invalid-input");
  let keys: string[];
  switch (v.operation) {
    case "create": case "replace": keys = ["trip"]; boundedTrip(v.trip); break;
    case "get": case "archive": keys = ["tripId"]; tripIdentifier(v.tripId); break;
    case "list":
      keys = ["limit", "afterTripId"];
      if (v.limit !== undefined && (!Number.isInteger(v.limit) || (v.limit as number) < 1 || (v.limit as number) > 50)) throw new TripResourceError("invalid-input");
      if (v.afterTripId !== undefined) tripIdentifier(v.afterTripId);
      break;
    case "attach": keys = ["conversationId", "tripId"]; conversationIdentifier(v.conversationId); tripIdentifier(v.tripId); break;
    case "detach": case "reference": keys = ["conversationId"]; conversationIdentifier(v.conversationId); break;
    default: throw new TripResourceError("invalid-input");
  }
  if (Object.keys(v).some((key) => !["version", "operation", ...keys].includes(key))) throw new TripResourceError("invalid-input");
  return structuredClone(value) as TripApiCommand;
}
