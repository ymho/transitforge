import { samePlaceIdentity, type PlaceSnapshot, type PlaceRef } from "./place-snapshot";
import { compareMoney } from "./money";
import { effectiveTripConstraints, type TripRequest, type TripRequirement } from "./trip-request";
import type { ZonedInstant } from "./itinerary-schedule";
import type { TravelCandidateAssessment, ConstraintStatus, CandidateReasonCode } from "./travel-candidate-assessment";

/** Local proof inputs, not another plan or a whole-Trip feasibility engine. */
export interface CandidateConstraintFacts {
  places?: { origin?: PlaceSnapshot; destinations: PlaceSnapshot[]; complete: boolean; evidenceIds: string[] };
  dates?: { startDate: string; endDate?: string; evidenceIds: string[] };
  endpoints?: { origin: PlaceSnapshot; destination: PlaceSnapshot; departure: ZonedInstant; arrival: ZonedInstant; evidenceIds: string[] };
  mobility: TravelCandidateAssessment["mobility"];
  price: TravelCandidateAssessment["price"];
}
type Check = { status: ConstraintStatus; reasonCodes: CandidateReasonCode[]; evidenceIds: string[] };
export function combineCandidateChecks(checks: ConstraintStatus[]): ConstraintStatus {
  return checks.includes("violated") ? "violated" : !checks.length || checks.includes("unknown") ? "unknown" : "satisfied";
}
const unknown = (code: CandidateReasonCode = "missing-facts"): Check => ({ status: "unknown", reasonCodes: [code], evidenceIds: [] });
const known = (matches: boolean, evidenceIds: string[]): Check => ({ status: matches ? "satisfied" : "violated",
  reasonCodes: [matches ? "verified-match" : "verified-mismatch"], evidenceIds });

export function assessCandidateConstraints(request: TripRequest, facts: CandidateConstraintFacts, itemId?: string):
  Pick<TravelCandidateAssessment, "hardConstraints" | "softPreferences" | "constraintStatus" | "relevance"> {
  const checks = effectiveTripConstraints(request, itemId).map((constraint) => {
    const result = constraint.assumptionId && request.assumptions.find((a) => a.id === constraint.assumptionId)?.status !== "confirmed"
      ? unknown("unconfirmed-assumption") : constraint.scope.type === "item" && itemId === undefined
        ? unknown("partial-coverage") : assessRequirement(constraint.requirement, facts);
    return { constraint, result };
  });
  const hardConstraints = checks.filter(({ constraint }) => constraint.strength === "hard")
    .map(({ constraint, result }) => ({ constraintId: constraint.id, ...result }));
  const softPreferences = checks.filter(({ constraint }) => constraint.strength === "soft")
    .map(({ constraint, result }) => ({ constraintId: constraint.id, ...result,
      status: result.status === "satisfied" ? "fit" as const : result.status === "violated" ? "conflict" as const : "unknown" as const }));
  const placeChecks = checks.filter(({ constraint }) => constraint.requirement.type === "destinations");
  const placeStatus = combineCandidateChecks(placeChecks.map(({ result }) => result.status));
  return { hardConstraints, softPreferences, constraintStatus: combineCandidateChecks(hardConstraints.map((c) => c.status)),
    relevance: { status: placeStatus === "satisfied" ? "fit" : placeStatus === "violated" ? "questionable" : "unknown",
      reasonCodes: placeChecks.length ? [...new Set(placeChecks.flatMap(({ result }) => result.reasonCodes))] : ["missing-facts"],
      evidenceIds: [...new Set(placeChecks.flatMap(({ result }) => result.evidenceIds))] } };
}

function assessRequirement(requirement: TripRequirement, f: CandidateConstraintFacts): Check {
  switch (requirement.type) {
    case "origin": {
      if (!requirement.place.ref || requirement.place.ref.provider === "manual" || !f.places?.origin?.ref) return unknown("identity-unresolved");
      if (!comparableIdentity(requirement.place.ref, f.places.origin.ref)) return unknown("identity-unresolved");
      return known(samePlaceIdentity(requirement.place.ref, f.places.origin.ref), f.places.evidenceIds);
    }
    case "destinations": {
      if (!f.places || !requirement.places.every((p) => p.ref && p.ref.provider !== "manual") ||
          !f.places.destinations.every((p) => p.ref && p.ref.provider !== "manual")) return unknown("identity-unresolved");
      let position = -1;
      const matches = requirement.places.every((requested) => {
        const found = f.places!.destinations.findIndex((p, i) =>
          (requirement.order !== "fixed" || i > position) && samePlaceIdentity(requested.ref, p.ref));
        position = found; return found >= 0;
      });
      if (!matches && !f.places.complete) return unknown("partial-coverage");
      if (!matches && requirement.places.some((requested) => !f.places!.destinations.some((p) => samePlaceIdentity(requested.ref, p.ref)) &&
        f.places!.destinations.some((p) => !comparableIdentity(requested.ref, p.ref)))) return unknown("identity-unresolved");
      const result = known(matches, f.places.evidenceIds);
      if (!matches) result.reasonCodes = ["identity-mismatch"];
      return result;
    }
    case "dates": {
      if (!f.dates || requirement.timeZone) return unknown(); // No calendar-zone inference from location/date strings.
      const checks = [f.dates.startDate >= requirement.start.earliest && f.dates.startDate <= requirement.start.latest];
      if (requirement.end) {
        if (!f.dates.endDate) return checks[0] ? unknown() : known(false, f.dates.evidenceIds);
        checks.push(f.dates.endDate >= requirement.end.earliest && f.dates.endDate <= requirement.end.latest);
      }
      return known(checks.every(Boolean), f.dates.evidenceIds);
    }
    case "duration": {
      if (!f.dates?.endDate) return unknown();
      const days = (Date.parse(f.dates.endDate) - Date.parse(f.dates.startDate)) / 86_400_000 + (requirement.unit === "days" ? 1 : 0);
      return known(days >= requirement.minimum && days <= requirement.maximum, f.dates.evidenceIds);
    }
    case "depart_after": case "arrive_by": {
      if (!f.endpoints || !samePlaceIdentity(requirement.place.ref,
        requirement.type === "depart_after" ? f.endpoints.origin.ref : f.endpoints.destination.ref)) return unknown("identity-unresolved");
      return known(requirement.type === "depart_after" ? Date.parse(f.endpoints.departure.at) >= Date.parse(requirement.at.at) :
        Date.parse(f.endpoints.arrival.at) <= Date.parse(requirement.at.at), f.endpoints.evidenceIds);
    }
    case "mobility": {
      const m = f.mobility;
      const checks = Object.entries(requirement).filter(([key]) => key !== "type").map(([key, value]): ConstraintStatus => {
        if (key === "maxTravelMinutes") return m.travelMinutes === undefined ? "unknown" : m.travelMinutes <= Number(value) ? "satisfied" : "violated";
        if (key === "maxTransfers") return m.transfers === undefined ? "unknown" : m.transfers <= Number(value) ? "satisfied" : "violated";
        if (["modes", "excludedModes", "requiredModes"].includes(key)) {
          if (!m.modes?.length) return "unknown";
          const values = value as string[];
          const match = key === "modes" ? m.modes.every((mode) => values.includes(mode)) :
            key === "excludedModes" ? m.modes.every((mode) => !values.includes(mode)) : values.every((mode) => m.modes!.includes(mode as typeof m.modes[number]));
          return match ? "satisfied" : "violated";
        }
        return "unknown"; // Rail-specific service rules, car availability etc. require further facts.
      });
      const status = combineCandidateChecks(checks);
      return status === "unknown" ? unknown("unsupported-requirement") : known(status === "satisfied", m.evidenceIds);
    }
    case "budget": {
      const price = f.price;
      if (price.coverage !== "complete" || price.basis !== requirement.basis || price.status !== "known" ||
          price.subtotals.length !== 1 || price.subtotals[0]!.currency !== requirement.limit.currency) return unknown("budget-basis-unknown");
      return known(compareMoney(price.subtotals[0]!, requirement.limit) <= 0, price.evidenceIds);
    }
    default: return unknown("subjective-preference");
  }
}

/** Non-equality across authorities is not proof of different geography; #377 owns identity resolution. */
function comparableIdentity(left: PlaceRef | undefined, right: PlaceRef | undefined): boolean {
  return !!left && !!right && left.provider !== "manual" && left.provider === right.provider &&
    (!!left.providerPlaceId && !!right.providerPlaceId || !!left.canonicalKey && !!right.canonicalKey);
}
