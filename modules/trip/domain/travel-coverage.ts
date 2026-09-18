import { normalizeStationName } from "@raiquora/train/station-name";
import type { StationLineCatalogStation } from "@raiquora/train/station";
import { verifyRailCandidateSchedule, type RailTimetableInput, type VerifiedRailCandidate } from "./selected-rail-journey";
import type { ExternalTravelInformation } from "./external-travel-information";
import { validateExternalSourceEvidence } from "./external-travel-information";
import type { GroundAccessRoute } from "./ground-access";
import { validatePlaceSnapshot, type PlaceSnapshot } from "./place-snapshot";
import { exactKeys, validInstant } from "./snapshot-validation";
import type { CandidateAssessmentFacts } from "./travel-candidate-assessment";

export const travelCoveragePolicyVersion = "loaded-timetable-access-v1";
export const travelCoverageReasons = ["verified-route", "verified-access", "missing-candidate", "missing-catalog",
  "missing-timetable", "representative-timetable", "changed-input", "ambiguous-station", "station-not-covered",
  "invalid-input", "stale-input", "access-unconfirmed"] as const;
export type TravelCoverageStatus = "supported" | "outside-coverage" | "unresolved" | "data-unavailable";
export interface TravelCoverage {
  readonly policyVersion: typeof travelCoveragePolicyVersion;
  readonly status: TravelCoverageStatus;
  readonly reason: typeof travelCoverageReasons[number];
  readonly inputVersions: readonly { sourceId: string; contentDigest: string }[];
}

/** Persistence/Tool consumers validate the projection, never treat its shape as proof. */
export function validateTravelCoverage(value: TravelCoverage): void {
  exactKeys(value, ["policyVersion", "status", "reason", "inputVersions"]);
  if (value.policyVersion !== travelCoveragePolicyVersion ||
      !["supported", "outside-coverage", "unresolved", "data-unavailable"].includes(value.status) ||
      !travelCoverageReasons.includes(value.reason) || !Array.isArray(value.inputVersions) || value.inputVersions.length > 16) {
    throw new Error("Invalid travel coverage");
  }
  for (const input of value.inputVersions) {
    exactKeys(input, ["sourceId", "contentDigest"]);
    if ([input.sourceId, input.contentDigest].some((v) => typeof v !== "string" || !v.trim())) throw new Error("Invalid travel coverage input");
  }
}

/** One assessment entry for Home/Agent; no acquisition and no ranking decision. */
export function assessTravelCoverage(facts: CandidateAssessmentFacts, now: string): TravelCoverage {
  const rail = assessRailCoverage(facts.rail?.candidate, facts.rail?.inputs ?? [], now);
  if (!facts.places?.data?.destinations.length || rail.status !== "supported") return rail;
  if (facts.places.status !== "available" || facts.places.freshness === "stale" || !facts.places.data.complete) {
    return { ...rail, status: "unresolved", reason: "access-unconfirmed" };
  }
  const route = facts.groundAccess?.data;
  if (!route) return { ...rail, status: "unresolved", reason: "access-unconfirmed" };
  const stations = facts.rail!.inputs.flatMap((input) => input.index.station_line_catalog?.lines.flatMap((line) => line.stations) ?? []);
  for (const place of facts.places.data.destinations) {
    const bound = stations.find((station) => [route.origin, route.destination].some((point) =>
      normalizeStationName(point.name) === normalizeStationName(station.name) &&
      point.longitude === station.coordinate[0] && point.latitude === station.coordinate[1]));
    if (!bound) return { ...rail, status: "unresolved", reason: "access-unconfirmed" };
    const access = assessPlaceCoverage(place, bound, facts.rail!.candidate, facts.rail!.inputs, facts.groundAccess, now);
    if (access.status !== "supported") return access;
  }
  return { ...rail, reason: "verified-access" };
}

/** Read projection only. Inputs come from the current trusted catalog loader, not model claims.
 * West-Japan is a product focus, not an independently maintained geographic whitelist.
 */
export function assessRailCoverage(candidate: VerifiedRailCandidate | undefined,
  inputs: readonly RailTimetableInput[], now: string): TravelCoverage {
  const versions = inputs.slice(0, 16).map(({ sourceId, contentDigest }) => ({ sourceId, contentDigest }));
  const result = (status: TravelCoverageStatus, reason: TravelCoverage["reason"]): TravelCoverage =>
    ({ policyVersion: travelCoveragePolicyVersion, status, reason, inputVersions: versions });
  if (!candidate) return result("unresolved", "missing-candidate");
  if (!inputs.length) return result("data-unavailable", "missing-timetable");
  if (!validInstant(now) || !validInstant(candidate.verifiedAt) || Date.parse(candidate.verifiedAt) > Date.parse(now) ||
      inputs.length > 16 || candidate.legReferences.length > 32) return result("data-unavailable", "invalid-input");
  for (const ref of candidate.legReferences) {
    const input = inputs.find((i) => i.sourceId === ref.sourceId);
    if (!input) return result("data-unavailable", "missing-timetable");
    if (input.contentDigest !== ref.contentDigest) return result("unresolved", "changed-input");
    if (!input.index.service_date) return result("unresolved", "representative-timetable");
    if (input.index.service_date !== ref.serviceDate) return result("unresolved", "changed-input");
    const catalog = input.index.station_line_catalog;
    if (!catalog || catalog.schema_version !== "station-line-catalog-v1" || !catalog.source) return result("data-unavailable", "missing-catalog");
    if (input.evidence.validUntil && (!validInstant(input.evidence.validUntil) || Date.parse(input.evidence.validUntil) < Date.parse(now))) return result("data-unavailable", "stale-input");
  }
  try {
    const scheduled = verifyRailCandidateSchedule(candidate, inputs);
    for (const [index, leg] of scheduled.legs.entries()) {
      const input = inputs.find((i) => i.sourceId === candidate.legReferences[index]!.sourceId)!;
      for (const place of [leg.origin, leg.destination]) {
        const matches = input.index.station_line_catalog!.lines.flatMap((line) => line.stations)
          .filter((station) => normalizeStationName(station.name) === normalizeStationName(place.name));
        if (!matches.length) return result("outside-coverage", "station-not-covered");
        if (matches.some((station) => !validCoordinate(station.coordinate))) return result("data-unavailable", "invalid-input");
        // Repeated catalog rows for the same physical station are not different identities.
        if (new Set(matches.map((station) => JSON.stringify(station.coordinate))).size !== 1) return result("unresolved", "ambiguous-station");
      }
    }
    return result("supported", "verified-route");
  } catch { return result("unresolved", "invalid-input"); }
}

/** A provider route must bind the resolved place to an actual served catalog station.
 * Nearness, a matching name, or a model-provided statement is never an access proof.
 */
export function assessPlaceCoverage(place: PlaceSnapshot, station: StationLineCatalogStation,
  rail: VerifiedRailCandidate | undefined, inputs: readonly RailTimetableInput[],
  access: ExternalTravelInformation<GroundAccessRoute> | undefined, now: string): TravelCoverage {
  const coverage = assessRailCoverage(rail, inputs, now);
  const unresolved = (reason: TravelCoverage["reason"] = "access-unconfirmed"): TravelCoverage =>
    ({ ...coverage, status: "unresolved", reason });
  if (coverage.status !== "supported") return coverage;
  try {
    validatePlaceSnapshot(place);
    if (!place.ref?.providerPlaceId || place.ref.provider === "manual" || !place.sources.length || !place.coordinate ||
        !validCoordinate(station.coordinate)) return unresolved();
    const verified = verifyRailCandidateSchedule(rail!, inputs);
    if (!verified.legs.some((leg) => [leg.origin, leg.destination].some((point) =>
      normalizeStationName(point.name) === normalizeStationName(station.name)))) return unresolved();
    if (!inputs.some((input) => input.index.station_line_catalog?.lines.some((line) => line.stations.some((s) =>
      normalizeStationName(s.name) === normalizeStationName(station.name) &&
      s.coordinate[0] === station.coordinate[0] && s.coordinate[1] === station.coordinate[1])))) return unresolved();
    if (!access || access.status !== "available" || access.freshness !== "fresh" || !access.data || !access.evidence.length) return unresolved();
    for (const source of access.evidence) {
      validateExternalSourceEvidence(source);
      if (source.kind !== "ground-access" || source.confidence === "unknown" || !source.validUntil ||
          Date.parse(source.retrievedAt) > Date.parse(now) || Date.parse(source.validUntil) < Date.parse(now)) return unresolved();
    }
    const route = access.data;
    if (!Number.isFinite(route.durationMinutes) || route.durationMinutes < 0 ||
        !Number.isFinite(route.distanceMeters) || route.distanceMeters < 0) return unresolved();
    const isStation = (point: GroundAccessRoute["origin"]) => normalizeStationName(point.name) === normalizeStationName(station.name) &&
      point.longitude === station.coordinate[0] && point.latitude === station.coordinate[1];
    const isPlace = (point: GroundAccessRoute["origin"]) => point.entityId === place.ref!.providerPlaceId &&
      point.longitude === place.coordinate!.longitude && point.latitude === place.coordinate!.latitude;
    if (!(isStation(route.origin) && isPlace(route.destination) || isStation(route.destination) && isPlace(route.origin))) return unresolved();
    return { ...coverage, reason: "verified-access" };
  } catch { return unresolved("invalid-input"); }
}

function validCoordinate(value: readonly number[]): boolean {
  return value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]!) <= 180 && Math.abs(value[1]!) <= 90;
}
