import { recheckIdentity, recheckPolicyVersion, type RecheckKind } from "@raiquora/trip/trip-recheck";
import { tripIdentifier } from "./trip-api.js";

/** No owner, Trip snapshot, provider payload or externally supplied target in the task. */
export interface TripRecheckTask {
  readonly id: string;
  readonly tripId: string;
  readonly sourceTripRevision: number;
  readonly kind: RecheckKind;
  readonly watchId?: string;
  readonly policyVersion: typeof recheckPolicyVersion;
  readonly dueAt: number;
}
export function validateRecheckTask(task: TripRecheckTask): void {
  if (!task || Object.keys(task).some((key) => !["id", "tripId", "sourceTripRevision", "kind", "watchId", "policyVersion", "dueAt"].includes(key))) throw new Error("invalid-recheck-task");
  tripIdentifier(task.tripId);
  if (!Number.isSafeInteger(task.sourceTripRevision) || task.sourceTripRevision < 0 || !Number.isSafeInteger(task.dueAt) || task.dueAt < 0 ||
      !["weather", "hazard", "rail-refresh", "readiness"].includes(task.kind) || task.policyVersion !== recheckPolicyVersion ||
      (task.kind === "readiness" ? task.watchId !== undefined : typeof task.watchId !== "string" || !task.watchId || task.watchId.length > 2000) ||
      task.id !== recheckIdentity(task.tripId, task.sourceTripRevision, task.kind, task.watchId)) throw new Error("invalid-recheck-task");
}
export type RecheckFailureCode = "target_unknown" | "schedule_unknown" | "horizon" | "timeout" | "rate_limited" | "unavailable" | "invalid_response" | "routing_lag";
export class RecheckFailure extends Error {
  constructor(readonly code: RecheckFailureCode) { super(code); }
}
