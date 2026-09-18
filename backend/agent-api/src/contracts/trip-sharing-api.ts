import { TripResourceError, tripIdentifier } from "./trip-api.js";
import type { SharedTripRole } from "@raiquora/trip/trip-sharing";
export const sharingVersion = "trip-sharing-v1";
export type SharingCommand =
  | { version: typeof sharingVersion; operation: "create-grant"; tripId: string; role: SharedTripRole; expiresAt?: string }
  | { version: typeof sharingVersion; operation: "redeem"; tripId: string; grantId: string; secret: string }
  | { version: typeof sharingVersion; operation: "revoke-grant"; tripId: string; grantId: string; baseVersion: number }
  | { version: typeof sharingVersion; operation: "manage"; tripId: string; after?: string }
  | { version: typeof sharingVersion; operation: "participant"; tripId: string; participantId: string; role: SharedTripRole; active: boolean; baseVersion: number }
  | { version: typeof sharingVersion; operation: "accessible"; afterTripId?: string }
  | { version: typeof sharingVersion; operation: "reservation-facts"; tripId: string };
export function parseSharingCommand(value: unknown): SharingCommand {
  const fail = () => { throw new TripResourceError("invalid-input"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const v = value as Record<string, unknown>;
  if (v.version !== sharingVersion) return fail();
  const fields: Record<string, string[]> = {
    "create-grant": ["tripId", "role", "expiresAt"], redeem: ["tripId", "grantId", "secret"],
    "revoke-grant": ["tripId", "grantId", "baseVersion"], manage: ["tripId", "after"],
    participant: ["tripId", "participantId", "role", "active", "baseVersion"], accessible: ["afterTripId"], "reservation-facts": ["tripId"],
  };
  const keys = typeof v.operation === "string" && Object.hasOwn(fields, v.operation) ? fields[v.operation] : undefined;
  if (!keys || Object.keys(v).some((k) => !["version", "operation", ...keys].includes(k))) return fail();
  if (v.operation !== "accessible") tripIdentifier(v.tripId);
  for (const key of ["grantId", "participantId", "afterTripId"]) if (keys.includes(key) && (v[key] !== undefined || key !== "afterTripId")) tripIdentifier(v[key]);
  if (keys.includes("role") && v.role !== "viewer" && v.role !== "editor") return fail();
  if (keys.includes("baseVersion") && (!Number.isSafeInteger(v.baseVersion) || Number(v.baseVersion) < 0 || Number(v.baseVersion) >= Number.MAX_SAFE_INTEGER - 1)) return fail();
  if (keys.includes("active") && typeof v.active !== "boolean") return fail();
  if (v.operation === "redeem" && (typeof v.secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(v.secret))) throw new TripResourceError("not-found");
  if (v.expiresAt !== undefined && (typeof v.expiresAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.expiresAt) || !Number.isFinite(Date.parse(v.expiresAt)))) return fail();
  if (typeof v.expiresAt === "string" && new Date(v.expiresAt).toISOString() !== v.expiresAt) return fail();
  if (v.after !== undefined && (typeof v.after !== "string" || !/^(GRANT|PARTICIPANT)#[0-9a-f-]{36}$/i.test(v.after))) return fail();
  return structuredClone(value) as SharingCommand;
}
