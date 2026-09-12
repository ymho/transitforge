import { isJourneyRankingPreference, isTransferPace, type JourneySearchPreferences } from "@raiquora/journey/journey-search-preferences";
import type { JourneySearchRequest } from "@raiquora/journey/journey-search-service";
import { validatePlaceSnapshot, type PlaceSnapshot } from "./place-snapshot";
import { validateTimeZone, validateZonedInstant, type LocalDate, type ZonedInstant } from "./itinerary-schedule";
import { exactKeys, validDate } from "./snapshot-validation";
import { travelPreferenceLabels, type TravelPreference, type TripContext } from "./travel-profile";
import type { MovementMode } from "./trip-plan";

export interface DateRange { readonly earliest: LocalDate; readonly latest: LocalDate; }
export const railRequirementFields = ["excludedServiceTypes", "excludedTrainNames", "excludedTrainNumbers", "excludedServiceUids",
  "requiredServiceTypes", "requiredTrainNames", "requiredTrainNumbers", "allowedServiceTypes"] as const;
export type MobilityRequirement = { readonly type: "mobility"; readonly maxTravelMinutes?: number;
  readonly modes?: readonly MovementMode[]; readonly excludedModes?: readonly MovementMode[]; readonly requiredModes?: readonly MovementMode[];
  readonly carAvailable?: boolean } & Readonly<Partial<JourneySearchPreferences>> &
  Readonly<Pick<JourneySearchRequest, typeof railRequirementFields[number]>>;

/** Requested conditions, never adopted itinerary or an unrestricted JSON DSL. Money/party remain #412/#411. */
export type TripRequirement =
  | { readonly type: "origin"; readonly place: PlaceSnapshot }
  | { readonly type: "destinations"; readonly places: readonly PlaceSnapshot[]; readonly order: "fixed" | "flexible" }
  | { readonly type: "dates"; readonly start: DateRange; readonly end?: DateRange; readonly timeZone?: string }
  | { readonly type: "duration"; readonly unit: "nights" | "days"; readonly minimum: number; readonly maximum: number }
  | { readonly type: "depart_after" | "arrive_by"; readonly at: ZonedInstant; readonly place: PlaceSnapshot }
  | MobilityRequirement
  | { readonly type: "experience"; readonly intent: "prefer" | "must" | "avoid"; readonly text: string; readonly preference?: TravelPreference; readonly weight?: number }
  | { readonly type: "pace"; readonly value: number }
  | { readonly type: "relative_distance"; readonly direction: NonNullable<TripContext["relativeDistancePreference"]>; readonly comparedCandidateIds: readonly string[] }
  | { readonly type: "adventure"; readonly intensity: NonNullable<TripContext["adventureIntensity"]>; readonly avoidedRisks: NonNullable<TripContext["avoidedRisks"]> };

export function nonemptyText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
export function validateDateRange(range: DateRange): void {
  exactKeys(range, ["earliest", "latest"]);
  if (!validDate(range.earliest) || !validDate(range.latest) || range.earliest > range.latest) throw new Error("Invalid request date range");
}
export function validateTripRequirement(value: TripRequirement): void {
  if (!value || typeof value !== "object") throw new Error("Invalid requirement");
  switch (value.type) {
    case "origin": exactKeys(value, ["type", "place"]); validatePlaceSnapshot(value.place); return;
    case "destinations":
      exactKeys(value, ["type", "places", "order"]);
      if (!["fixed", "flexible"].includes(value.order) || !Array.isArray(value.places) || !value.places.length) throw new Error("Invalid destination wish");
      value.places.forEach(validatePlaceSnapshot); return;
    case "dates":
      exactKeys(value, ["type", "start", "end", "timeZone"]); validateDateRange(value.start);
      if (value.end !== undefined) {
        validateDateRange(value.end);
        if (value.end.latest < value.start.earliest) throw new Error("End range precedes start range");
      }
      if (value.timeZone !== undefined) validateTimeZone(value.timeZone); return;
    case "duration":
      exactKeys(value, ["type", "unit", "minimum", "maximum"]);
      if (!["days", "nights"].includes(value.unit) || !Number.isSafeInteger(value.minimum) || !Number.isSafeInteger(value.maximum) ||
          value.minimum < (value.unit === "days" ? 1 : 0) || value.maximum < value.minimum) throw new Error("Invalid duration range"); return;
    case "depart_after": case "arrive_by":
      exactKeys(value, ["type", "at", "place"]); validateZonedInstant(value.at); validatePlaceSnapshot(value.place);
      if (value.place.timeZone !== undefined && value.place.timeZone !== value.at.timeZone) throw new Error("Place/instant zone mismatch"); return;
    case "mobility": {
      exactKeys(value, ["type", "maxTravelMinutes", "maxTransfers", "modes", "excludedModes", "requiredModes", "carAvailable", "transferPace", "rankingPreference", ...railRequirementFields]);
      if (!Object.entries(value).some(([key, field]) => key !== "type" && field !== undefined)) throw new Error("Empty mobility requirement");
      for (const n of [value.maxTravelMinutes, value.maxTransfers]) if (n !== undefined && (!Number.isSafeInteger(n) || n < 0)) throw new Error("Invalid mobility limit");
      if (value.maxTransfers !== undefined && value.maxTransfers > 3) throw new Error("Unsupported journey transfer limit");
      if (value.transferPace !== undefined && !isTransferPace(value.transferPace)) throw new Error("Invalid transfer pace");
      if (value.rankingPreference !== undefined && !isJourneyRankingPreference(value.rankingPreference)) throw new Error("Invalid ranking preference");
      if (value.carAvailable !== undefined && typeof value.carAvailable !== "boolean") throw new Error("Invalid car availability");
      for (const field of railRequirementFields) if (value[field] !== undefined) stringList(value[field]!);
      for (const modes of [value.modes, value.excludedModes, value.requiredModes]) if (modes !== undefined) {
        stringList(modes);
        if (modes.some((mode) => !["rail", "rental-car", "car", "bus", "walk", "other"].includes(mode))) throw new Error("Invalid transport mode");
      }
      if (value.requiredModes?.some((mode) => value.excludedModes?.includes(mode) || (value.modes !== undefined && !value.modes.includes(mode)))) throw new Error("Conflicting transport modes");
      return;
    }
    case "experience":
      exactKeys(value, ["type", "intent", "text", "preference", "weight"]);
      if (!["prefer", "must", "avoid"].includes(value.intent) || !nonemptyText(value.text) ||
          (value.preference !== undefined && !Object.hasOwn(travelPreferenceLabels, value.preference)) ||
          (value.weight !== undefined && !unitValue(value.weight))) throw new Error("Invalid experience requirement"); return;
    case "pace": exactKeys(value, ["type", "value"]); if (!unitValue(value.value)) throw new Error("Invalid pace"); return;
    case "relative_distance":
      exactKeys(value, ["type", "direction", "comparedCandidateIds"]);
      if (!["nearer", "farther"].includes(value.direction)) throw new Error("Invalid relative distance");
      stringList(value.comparedCandidateIds); return;
    case "adventure":
      exactKeys(value, ["type", "intensity", "avoidedRisks"]);
      if (![0, 1, 2, 3].includes(value.intensity) || !Array.isArray(value.avoidedRisks) || value.avoidedRisks.some((risk) =>
        !["illegal", "uncontrolled-violence", "unverified-border", "night-isolation", "transport-stranding", "weather-exposure"].includes(risk))) throw new Error("Invalid adventure requirement"); return;
    default: throw new Error("Unknown or deferred requirement (Money belongs to #412)");
  }
}
function stringList(value: readonly string[]): void {
  if (!Array.isArray(value) || !value.length || !value.every(nonemptyText) || new Set(value).size !== value.length) throw new Error("Invalid requirement list");
}
function unitValue(value: number): boolean { return Number.isFinite(value) && value >= 0 && value <= 1; }
