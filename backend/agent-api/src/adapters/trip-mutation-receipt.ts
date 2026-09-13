import { createHash } from "node:crypto";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { boundedTrip, TripResourceError, type TripMutation } from "../contracts/trip-api.js";
import type { Trip } from "@raiquora/trip/trip";

/** Only wire content matters; property ordering and server commit time do not change retry identity. */
export function canonicalJson(value: unknown): string {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, sorted(x)])) : v;
  return JSON.stringify(sorted(value));
}
export function mutationDigest(m: TripMutation): string {
  return createHash("sha256").update(canonicalJson({ tripId: m.tripId, baseRevision: m.baseRevision, proposal: m.proposal })).digest("hex");
}
export function readReceipt(item: Record<string, AttributeValue>, owner: string, mutation: TripMutation): Trip {
  if (item.pk?.S !== owner || item.sk?.S !== `MUTATION#${mutation.mutationId}` || item.storageVersion?.N !== "1") throw new TripResourceError("unavailable");
  if (item.digest?.S !== mutationDigest(mutation)) throw new TripResourceError("mutation-reused");
  try {
    const trip = boundedTrip(JSON.parse(item.trip!.S!));
    if (trip.id !== mutation.tripId || trip.revision !== mutation.baseRevision + 1) throw new Error();
    return trip;
  } catch { throw new TripResourceError("unavailable"); }
}
