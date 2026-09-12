import { createTrip, type ItineraryItem, type Trip } from "./trip";
import { isSightseeingPlaceProvider, type TripPlan } from "./trip-plan";
import { createPlaceSnapshot, validatePlaceCoordinate, type PlaceSnapshot, type PlaceSnapshotRetention } from "./place-snapshot";
import type { ExternalSourceEvidence } from "./external-travel-information";

export interface TripMigrationWarning {
  itemId?: string;
  code: "rail-selection-unverified" | "stay-snapshot-deferred" | "schedule-deferred" |
    "transport-mode-deferred" | "activity-deferred" | "request-state-deferred" |
    "place-retention-unconfirmed" | "place-coordinate-invalid" | "place-fields-not-retained" | "place-invalid";
  ownerIssue: number;
}
export interface TripMigrationResult {
  trip: Trip;
  warnings: TripMigrationWarning[];
  /** No raw provider data is embedded in Trip. Adapter must retain the original record. */
  requiresLegacyRetention: true;
  deferredItemIds: string[];
  /** Converted value objects for deferred Activity mapping (#410), not another persistent Place store. */
  placeMappings: Array<{ itemId: string; place?: PlaceSnapshot }>;
}

/** Adapter-reviewed legacy provenance/retention, keyed by existing item ID. Absent means unknown. */
export interface LegacyTripMigrationOptions {
  placeRetentionByItemId?: Readonly<Record<string, {
    retention: PlaceSnapshotRetention;
    sources: readonly ExternalSourceEvidence[];
    capturedAt?: string;
  }>>;
}

/** Single, deterministic legacy -> V2 entry. Caller owns durable ID mapping and actual creation time. */
export function convertLegacyTripPlan(plan: TripPlan, identity: { tripId: string; createdAt: string }, options: LegacyTripMigrationOptions = {}): TripMigrationResult {
  if (plan.version !== 1 || !plan.id || !Array.isArray(plan.items) ||
      plan.items.some((item) => !item.id) || new Set(plan.items.map(({ id }) => id)).size !== plan.items.length) {
    throw new Error("Invalid or unsupported legacy TripPlan");
  }
  const warnings: TripMigrationWarning[] = [{ code: "request-state-deferred", ownerIssue: 387 }];
  const deferredItemIds: string[] = [];
  const items: ItineraryItem[] = [];
  const placeMappings: TripMigrationResult["placeMappings"] = [];
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
      const mapping: TripMigrationResult["placeMappings"][number] = { itemId: item.id };
      placeMappings.push(mapping);
      const original = item.place;
      const reviewed = options.placeRetentionByItemId?.[item.id];
      if (!isSightseeingPlaceProvider(original.provider)) {
        warnings.push({ itemId: item.id, code: "place-invalid", ownerIssue: 414 });
        continue;
      }
      let coordinate: PlaceSnapshot["coordinate"];
      if (original.coordinate !== undefined) {
        try {
          if (!Array.isArray(original.coordinate) || original.coordinate.length !== 2) throw new Error("Invalid legacy coordinate");
          const value = { longitude: original.coordinate[0], latitude: original.coordinate[1] };
          validatePlaceCoordinate(value);
          coordinate = value;
        } catch { warnings.push({ itemId: item.id, code: "place-coordinate-invalid", ownerIssue: 414 }); }
      }
      if (original.provider !== "manual" && (!reviewed || reviewed.retention.origin !== "provider" ||
          reviewed.retention.provider !== original.provider || reviewed.retention.storage !== "permitted")) {
        warnings.push({ itemId: item.id, code: "place-retention-unconfirmed", ownerIssue: 414 });
        continue; // Even the provider name/ID may be restricted; never relabel it manual.
      }
      if (reviewed?.retention.origin === "provider" &&
          ((original.placeId !== undefined && !reviewed.retention.allowedFields.includes("ref")) ||
           (coordinate !== undefined && !reviewed.retention.allowedFields.includes("coordinate")))) {
        warnings.push({ itemId: item.id, code: "place-fields-not-retained", ownerIssue: 414 });
      }
      try {
        mapping.place = createPlaceSnapshot({
          ref: { provider: original.provider, ...(original.placeId !== undefined ? { providerPlaceId: original.placeId } : {}) },
          name: original.name, ...(coordinate !== undefined ? { coordinate } : {}),
          ...(reviewed?.capturedAt !== undefined ? { capturedAt: reviewed.capturedAt } : {}),
          sources: reviewed?.sources ?? [],
        }, original.provider === "manual" ? { origin: "manual" } : reviewed!.retention);
      } catch { warnings.push({ itemId: item.id, code: "place-invalid", ownerIssue: 414 }); }
    } else throw new Error("Unknown legacy item type");
  }
  return { trip: createTrip(identity.tripId, plan.title, identity.createdAt, items),
    warnings, deferredItemIds, placeMappings, requiresLegacyRetention: true };
}
