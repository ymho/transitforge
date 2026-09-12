import { createTrip, type ItineraryItem, type Trip } from "./trip";
import type { TripPlan } from "./trip-plan";

export interface TripMigrationWarning {
  itemId?: string;
  code: "rail-selection-unverified" | "stay-snapshot-deferred" | "schedule-deferred" |
    "transport-mode-deferred" | "activity-deferred" | "request-state-deferred";
  ownerIssue: number;
}
export interface TripMigrationResult {
  trip: Trip;
  warnings: TripMigrationWarning[];
  /** No raw provider data is embedded in Trip. Adapter must retain the original record. */
  requiresLegacyRetention: true;
  deferredItemIds: string[];
}

/** Single, deterministic legacy -> V2 entry. Caller owns durable ID mapping and actual creation time. */
export function convertLegacyTripPlan(plan: TripPlan, identity: { tripId: string; createdAt: string }): TripMigrationResult {
  if (plan.version !== 1 || !plan.id || !Array.isArray(plan.items) ||
      plan.items.some((item) => !item.id) || new Set(plan.items.map(({ id }) => id)).size !== plan.items.length) {
    throw new Error("Invalid or unsupported legacy TripPlan");
  }
  const warnings: TripMigrationWarning[] = [{ code: "request-state-deferred", ownerIssue: 387 }];
  const deferredItemIds: string[] = [];
  const items: ItineraryItem[] = [];
  for (const item of plan.items) {
    warnings.push({ itemId: item.id, code: "schedule-deferred", ownerIssue: 386 });
    if (item.type === "movement") {
      const rail = item.mode === "rail";
      items.push({ id: item.id, title: rail ? `${item.route.originStation} → ${item.route.destinationStation}`
        : `${item.origin} → ${item.destination}`, type: "transport",
        detail: rail ? { mode: "rail", status: "unresolved" } : { status: "unresolved" } });
      warnings.push({ itemId: item.id, code: rail ? "rail-selection-unverified" : "transport-mode-deferred", ownerIssue: rail ? 385 : 413 });
    } else if (item.type === "stay") {
      items.push({ id: item.id, title: item.destination, type: "stay", selection: { status: "unselected" } });
      // Even an explicit legacy accommodation has no trustworthy captured/selection provenance yet.
      warnings.push({ itemId: item.id, code: "stay-snapshot-deferred", ownerIssue: 400 });
    } else if (item.type === "sightseeing") {
      deferredItemIds.push(item.id);
      warnings.push({ itemId: item.id, code: "activity-deferred", ownerIssue: 410 });
    } else throw new Error("Unknown legacy item type");
  }
  return { trip: createTrip(identity.tripId, plan.title, identity.createdAt, items),
    warnings, deferredItemIds, requiresLegacyRetention: true };
}
