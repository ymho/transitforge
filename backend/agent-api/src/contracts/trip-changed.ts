import { createHash } from "node:crypto";
import { TripResourceError, tripIdentifier } from "./trip-api.js";
import { requireTripPrincipal } from "./trip-principal.js";

/** Internal routing only. Constructed from the authenticated storage key, never an HTTP body. */
export interface TripChanged {
  eventId: string;
  ownerSubject: string;
  tripId: string;
  revision: number;
  changedAt: string;
  kind: "created" | "mutated" | "archived";
}
export function tripChangedId(tripId: string, revision: number, kind: TripChanged["kind"]): string {
  return createHash("sha256").update(JSON.stringify([tripId, revision, kind])).digest("hex");
}
export function validateTripChanged(value: unknown): asserts value is TripChanged {
  const v = value as TripChanged;
  if (!v || typeof v !== "object" || Array.isArray(v) ||
      Object.keys(v).sort().join() !== "changedAt,eventId,kind,ownerSubject,revision,tripId") throw new TripResourceError("invalid-input");
  requireTripPrincipal({ subject: v.ownerSubject }); tripIdentifier(v.tripId);
  if (!Number.isSafeInteger(v.revision) || v.revision < 0 || !["created", "mutated", "archived"].includes(v.kind) ||
      typeof v.changedAt !== "string" || !Number.isFinite(Date.parse(v.changedAt)) || new Date(v.changedAt).toISOString() !== v.changedAt ||
      v.eventId !== tripChangedId(v.tripId, v.revision, v.kind)) throw new TripResourceError("invalid-input");
}
