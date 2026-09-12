import { createTrip, type ItineraryItem, type Trip } from "./trip";
import { isSightseeingPlaceProvider, type TripPlan } from "./trip-plan";
import { createPlaceSnapshot, validatePlaceCoordinate, type PlaceSnapshot, type PlaceSnapshotRetention } from "./place-snapshot";
import type { ExternalSourceEvidence } from "./external-travel-information";
import { projectStaySchedule, validateItinerarySchedule, type ItinerarySchedule } from "./itinerary-schedule";
import { validateTripRequirement, nonemptyText, type TripRequirement } from "./trip-requirement";
import type { TripRequest, TripConstraint, PlanAssumption } from "./trip-request";
import { travelPreferenceLabels, type TravelPreference, type AdventureRisk } from "./travel-profile";

export interface TripMigrationWarning {
  itemId?: string;
  field?: string;
  code: "rail-selection-unverified" | "stay-snapshot-deferred" | "schedule-invalid" |
    "transport-mode-deferred" | "activity-deferred" | "request-state-deferred" |
    "place-retention-unconfirmed" | "place-coordinate-invalid" | "place-fields-not-retained" | "place-invalid" |
    "request-field-invalid" | "request-field-deferred";
  ownerIssue: number;
}
export interface TripMigrationResult {
  trip: Trip;
  warnings: TripMigrationWarning[];
  /** No raw provider data is embedded in Trip. Adapter must retain the original record. */
  requiresLegacyRetention: true;
  deferredItemIds: string[];
  /** Converted value objects for deferred Activity mapping (#410), not another persistent Place store. */
  placeMappings: Array<{ itemId: string; place?: PlaceSnapshot; schedule: ItinerarySchedule }>;
}

/** Adapter-reviewed legacy provenance/retention, keyed by existing item ID. Absent means unknown. */
export interface LegacyTripMigrationOptions {
  /** Raw legacy input, not normalized/clamped by the old reader and not a second V2 request store. */
  tripContext?: unknown;
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
  const warnings: TripMigrationWarning[] = [];
  const deferredItemIds: string[] = [];
  const items: ItineraryItem[] = [];
  const placeMappings: TripMigrationResult["placeMappings"] = [];
  for (const item of plan.items) {
    let schedule: ItinerarySchedule = { type: "unscheduled" };
    try {
      if (item.type === "stay") schedule = projectStaySchedule(item.checkInDate, item.checkOutDate);
      else {
        // departureDate is a civil date; serviceDate is not (04:00 boundary). No selected rail proof exists here.
        const date = item.type === "movement" && item.mode === "rail" ? item.route.departureDate : item.date;
        if (date !== undefined) schedule = { type: "day", date };
      }
      validateItinerarySchedule(schedule);
    } catch {
      schedule = { type: "unscheduled" };
      warnings.push({ itemId: item.id, code: "schedule-invalid", ownerIssue: 386 });
    }
    if (item.type === "movement") {
      const rail = item.mode === "rail";
      items.push({ id: item.id, title: rail ? `${item.route.originStation} → ${item.route.destinationStation}`
        : `${item.origin} → ${item.destination}`, type: "transport", schedule,
        detail: rail ? { mode: "rail", status: "unresolved" } : { status: "unresolved" } });
      warnings.push({ itemId: item.id, code: rail ? "rail-selection-unverified" : "transport-mode-deferred", ownerIssue: rail ? 385 : 413 });
    } else if (item.type === "stay") {
      items.push({ id: item.id, title: item.destination, type: "stay", schedule, selection: { status: "unselected" } });
      // Even an explicit legacy accommodation has no trustworthy captured/selection provenance yet.
      warnings.push({ itemId: item.id, code: "stay-snapshot-deferred", ownerIssue: 400 });
    } else if (item.type === "sightseeing") {
      deferredItemIds.push(item.id);
      warnings.push({ itemId: item.id, code: "activity-deferred", ownerIssue: 410 });
      const mapping: TripMigrationResult["placeMappings"][number] = { itemId: item.id, schedule };
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
  const request = mapLegacyRequest(plan, options.tripContext, warnings);
  return { trip: createTrip(identity.tripId, plan.title, identity.createdAt, items, request),
    warnings, deferredItemIds, placeMappings, requiresLegacyRetention: true };
}

/** Field mapping within the single converter. Legacy carries neither reliable authorship nor strength. */
function mapLegacyRequest(plan: TripPlan, raw: unknown, warnings: TripMigrationWarning[]): TripRequest {
  const constraints: TripConstraint[] = [];
  const assumptions: PlanAssumption[] = [];
  const warning = (field: string, ownerIssue = 387, invalid = false): void => {
    warnings.push({ code: invalid ? "request-field-invalid" : "request-field-deferred", field, ownerIssue });
  };
  const note = (field: string, text: string): void => {
    assumptions.push({ id: `legacy-assumption:${field}`, text, status: "unconfirmed", source: "legacy", affects: [] });
  };
  const add = (field: string, requirement: TripRequirement): void => {
    try { validateTripRequirement(requirement); }
    catch { warning(field, 387, true); return; }
    const id = `legacy-constraint:${field}`;
    const assumptionId = `legacy-assumption:${field}`;
    constraints.push({ id, scope: { type: "trip" }, source: "legacy", strength: "soft", assumptionId, requirement });
    assumptions.push({ id: assumptionId, text: `以前の旅行条件（${field}）。値は保持していますが、出所と必須度は未確認です。`,
      status: "unconfirmed", source: "legacy", affects: [{ type: "constraint", constraintId: id }] });
  };
  if (plan.conditions !== undefined) {
    if (!isRecord(plan.conditions)) warning("conditions", 387, true);
    else {
      if (Array.isArray(plan.conditions.considerations)) plan.conditions.considerations.forEach((text, index) => {
        if (nonemptyText(text)) note(`conditions.considerations.${index}`, text);
        else warning(`conditions.considerations.${index}`, 387, true);
      });
      else warning("conditions.considerations", 387, true);
      for (const field of Object.keys(plan.conditions)) if (field !== "considerations") warning(`conditions.${field}`, field === "adults" || field === "children" ? 411 : 387);
    }
  }
  if (raw === undefined) return { constraints, assumptions };
  if (!isRecord(raw)) { warning("tripContext", 387, true); return { constraints, assumptions }; }
  if (raw.startDate !== undefined) {
    const start = { earliest: raw.startDate as string, latest: raw.startDate as string };
    const requirement: TripRequirement = { type: "dates", start };
    if (raw.endDate !== undefined) {
      const combined: TripRequirement = { ...requirement, end: { earliest: raw.endDate as string, latest: raw.endDate as string } };
      try { validateTripRequirement(combined); add("dates", combined); }
      catch { add("startDate", requirement); warning("endDate", 387, true); }
    } else add("startDate", requirement);
  } else if (raw.endDate !== undefined) warning("endDate");
  for (const [field, value] of Object.entries(raw).sort(([a], [b]) => a.localeCompare(b))) {
    if (value === undefined) continue;
    switch (field) {
      case "destinationWish":
        // A requested name, not a verified provider entity or an adopted destination.
        if (nonemptyText(value)) add(field, { type: "destinations", places: [{ name: value, sources: [] }], order: "flexible" });
        else warning(field, 387, true);
        break;
      case "startDate": case "endDate": break; // Combined above, independent of object key order.
      case "stayNights": add(field, { type: "duration", unit: "nights", minimum: value as number, maximum: value as number }); break;
      case "pace": add(field, { type: "pace", value: value as number }); break;
      case "maximumTravelMinutes":
        if (value !== null) add(field, { type: "mobility", maxTravelMinutes: value as number }); // null explicitly means no known limit.
        break;
      case "carAvailable": add(field, { type: "mobility", carAvailable: value as boolean }); break;
      case "interests":
        if (!isRecord(value)) { warning(field, 387, true); break; }
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).forEach(([preference, weight]) => {
          if (!Object.hasOwn(travelPreferenceLabels, preference) || typeof weight !== "number") { warning(`${field}.${preference}`, 387, true); return; }
          add(`${field}.${preference}`, { type: "experience", intent: "prefer", preference: preference as TravelPreference,
            text: travelPreferenceLabels[preference as TravelPreference], weight: weight as number });
        });
        break;
      case "avoidances":
        if (!Array.isArray(value)) { warning(field, 387, true); break; }
        value.forEach((text, index) => add(`${field}.${index}`, { type: "experience", intent: "avoid", text })); break;
      case "adventureIntensity":
        add(field, { type: "adventure", intensity: value as 0 | 1 | 2 | 3,
          avoidedRisks: (raw.avoidedRisks === undefined ? [] : raw.avoidedRisks) as AdventureRisk[] }); break;
      case "avoidedRisks": if (raw.adventureIntensity === undefined) warning(field); break;
      case "planningStage": warning(field, 383); break;
      case "companions": warning(field, 411); break;
      case "outboundDepartureTimeMinutes": case "returnArrivalTimeMinutes":
        warning(field); // No reliable place identity + zone + civil date. Never fabricate a ZonedInstant.
        if (Number.isSafeInteger(value) && (value as number) >= 0) note(field, `以前の時刻条件 ${field}: ${value}分。日付・場所・タイムゾーンは未確認です。`);
        else warning(field, 387, true);
        break;
      case "relativeDistancePreference":
        warning(field); // Compared candidate IDs are absent from legacy data.
        if (value === "nearer" || value === "farther") note(field, `以前の距離の希望: ${value === "nearer" ? "近め" : "遠め"}。比較対象は未確認です。`);
        else warning(field, 387, true);
        break;
      default: warning(field); // Retain original outside Trip; do not silently interpret unknown fields.
    }
  }
  return { constraints: constraints.sort((a, b) => a.id.localeCompare(b.id)), assumptions: assumptions.sort((a, b) => a.id.localeCompare(b.id)) };
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
