import type { ExternalSourceEvidence } from "./external-travel-information";

export type TravelRecheckKind = "weather" | "rail-operation" | "flight" | "place-hours";
export interface TravelRecheckRequest { id: string; tripPlanId: string; kind: TravelRecheckKind; entityId: string; scheduledAt: string; timeZone: string; createdAt: string; expiresAt: string }
export interface TravelRecheckSnapshot { checkedAt: string; status: "available" | "unavailable" | "unknown"; fingerprint?: string; evidence: ExternalSourceEvidence[] }
export interface TravelRecheckDifference { severity: "none" | "minor" | "major"; previousStatus?: TravelRecheckSnapshot["status"]; currentStatus: TravelRecheckSnapshot["status"]; changed: boolean }

export function recheckDedupeKey(request: Pick<TravelRecheckRequest, "tripPlanId" | "kind" | "entityId">): string { return `${request.tripPlanId}:${request.kind}:${request.entityId}`; }
export function travelRecheckDifference(previous: TravelRecheckSnapshot | undefined, current: TravelRecheckSnapshot): TravelRecheckDifference {
  if (!previous) return { severity: current.status === "available" ? "minor" : "major", currentStatus: current.status, changed: true };
  const changed = previous.status !== current.status || previous.fingerprint !== current.fingerprint;
  return { severity: !changed ? "none" : current.status !== "available" || previous.status !== "available" ? "major" : "minor", previousStatus: previous.status, currentStatus: current.status, changed };
}
