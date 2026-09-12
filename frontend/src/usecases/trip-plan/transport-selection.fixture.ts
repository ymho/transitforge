import type { NonRailTransportMode } from "@raiquora/trip/transport-detail";
import type { ResolvedTransportCandidate } from "./propose-trip-transport";

/** Synthetic normalized facts and test-only grants. No real service's storage permission implied. */
export function transportCandidateFixture(tripId: string, mode: NonRailTransportMode = "air"): ResolvedTransportCandidate {
  const source = { id: "transport-source", kind: "timetable" as const, provider: "fixture", sourceId: "service-a",
    retrievedAt: "2026-09-12T07:55:00Z", confidence: "provider-schedule" as const };
  const retention = { origin: "provider" as const, provider: "fixture", storage: "permitted" as const, allowedFields: ["name", "ref", "sources"] as const };
  return { candidateId: "transport-a", tripId, taskId: "task-a", validUntil: "2026-09-13T08:00:00Z", mode, title: "評価用の移動",
    provider: "fixture", providerItemId: "service-a", source,
    origin: { name: "羽田空港", ref: { provider: "fixture", providerPlaceId: "airport-a" }, sources: [source] },
    destination: { name: "新千歳空港", ref: { provider: "fixture", providerPlaceId: "airport-b" }, sources: [source] },
    schedule: { type: "fixed", startAt: { at: "2026-09-22T08:00:00+09:00", timeZone: "Asia/Tokyo" }, endAt: { at: "2026-09-22T09:30:00+09:00", timeZone: "Asia/Tokyo" } },
    originRetention: retention, destinationRetention: retention, retainIdentity: true, retainSource: true, retainTitle: true, retainSchedule: true };
}
