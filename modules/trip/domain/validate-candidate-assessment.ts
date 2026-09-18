import { exactKeys, validDate, validInstant } from "./snapshot-validation";
import { validatePlaceRef } from "./place-snapshot";
import { validateExternalSourceEvidence } from "./external-travel-information";
import { addMoney, validateMoney, validatePriceObservation, type Money } from "./money";
import { transportModes } from "./transport-detail";
import { candidateReasonCodes, type TravelCandidateAssessment } from "./travel-candidate-assessment";
import { combineCandidateChecks } from "./candidate-constraint-assessment";
import { validateTravelCoverage } from "./travel-coverage";

/** Structural validation is not Evidence verification; only the Application assessor establishes facts. */
export function validateTravelCandidateAssessment(a: TravelCandidateAssessment): void {
  exactKeys(a, ["candidateId", "assessedAt", "constraintStatus", "hardConstraints", "softPreferences", "relevance", "mobility",
    "weather", "hazard", "price", "party", "freshness", "sources", "partial", "caveats", "serviceCoverage"]);
  if (a.serviceCoverage) validateTravelCoverage(a.serviceCoverage);
  text(a.candidateId); if (!validInstant(a.assessedAt) || typeof a.partial !== "boolean") fail();
  const ids = new Set<string>();
  for (const source of a.sources) { validateExternalSourceEvidence(source); if (ids.has(source.id)) fail(); ids.add(source.id); }
  const referenced = (value: { evidenceIds: string[] }) => {
    if (!Array.isArray(value.evidenceIds) || value.evidenceIds.some((id) => !ids.has(id)) || new Set(value.evidenceIds).size !== value.evidenceIds.length) fail();
  };
  const reasons = (value: { reasonCodes: string[] }) => {
    if (!Array.isArray(value.reasonCodes) || value.reasonCodes.some((reason) => !(candidateReasonCodes as readonly string[]).includes(reason))) fail();
  };
  const check = (value: { status: string; reasonCodes: string[]; evidenceIds: string[] }, statuses: string[], extra: string[] = []) => {
    exactKeys(value, ["status", "reasonCodes", "evidenceIds", ...extra]);
    if (!statuses.includes(value.status)) fail(); reasons(value); referenced(value);
    if (["satisfied", "violated", "fit", "conflict", "questionable", "favorable", "mixed", "poor", "present"].includes(value.status) && !value.evidenceIds.length) fail();
  };
  for (const c of a.hardConstraints) { check(c, ["satisfied", "violated", "unknown"], ["constraintId"]); text(c.constraintId); }
  for (const c of a.softPreferences) { check(c, ["fit", "conflict", "unknown"], ["constraintId"]); text(c.constraintId); }
  const constraints = [...a.hardConstraints, ...a.softPreferences].map((c) => c.constraintId);
  if (new Set(constraints).size !== constraints.length || a.constraintStatus !== combineCandidateChecks(a.hardConstraints.map((c) => c.status))) fail();
  check(a.relevance, ["fit", "questionable", "unknown"]);
  exactKeys(a.mobility, ["status", "travelMinutes", "transfers", "modes", "evidenceIds"]);
  if (!["known", "partial", "unknown"].includes(a.mobility.status)) fail(); referenced(a.mobility);
  for (const value of [a.mobility.travelMinutes, a.mobility.transfers]) if (value !== undefined && (!Number.isFinite(value) || value < 0)) fail();
  if (a.mobility.transfers !== undefined && !Number.isSafeInteger(a.mobility.transfers)) fail();
  if (a.mobility.modes && (!a.mobility.modes.length || a.mobility.modes.some((mode) => !transportModes.includes(mode)))) fail();
  if (a.mobility.status === "known" && (a.mobility.travelMinutes === undefined || a.mobility.transfers === undefined || !a.mobility.modes?.length)) fail();
  if (a.mobility.status !== "unknown" && !a.mobility.evidenceIds.length || a.mobility.status === "unknown" &&
      [a.mobility.travelMinutes, a.mobility.transfers, a.mobility.modes].some((value) => value !== undefined)) fail();
  check(a.weather, ["favorable", "mixed", "poor", "unknown", "unavailable"], ["target"]);
  if (a.weather.target) {
    exactKeys(a.weather.target, ["place", "startDate", "endDate"]); validatePlaceRef(a.weather.target.place);
    if (!validDate(a.weather.target.startDate) || !validDate(a.weather.target.endDate) || a.weather.target.endDate < a.weather.target.startDate) fail();
  } else if (["favorable", "mixed", "poor"].includes(a.weather.status)) fail();
  check(a.hazard, ["present", "unknown", "unavailable"]);
  check(a.party, ["satisfied", "violated", "unknown"]);
  exactKeys(a.price, ["status", "observations", "subtotals", "comparability", "coverage", "basis", "unpricedItemCount", "reasonCodes", "evidenceIds"]);
  if (!["known", "partial", "unknown"].includes(a.price.status) || !["complete", "partial"].includes(a.price.coverage) ||
      !["same-currency", "mixed-currency", "unknown"].includes(a.price.comparability) ||
      a.price.basis !== undefined && !["trip", "per-person"].includes(a.price.basis) ||
      !Number.isSafeInteger(a.price.unpricedItemCount) || a.price.unpricedItemCount < 0) fail();
  referenced(a.price); reasons(a.price);
  a.price.observations.forEach(validatePriceObservation); a.price.subtotals.forEach(validateMoney);
  const totals = new Map<string, Money>();
  for (const observation of a.price.observations) {
    const previous = totals.get(observation.price.currency);
    totals.set(observation.price.currency, previous ? addMoney(previous, observation.price) : observation.price);
  }
  const expectedTotals = [...totals.values()].sort((left, right) => left.currency.localeCompare(right.currency));
  if (a.price.subtotals.length !== expectedTotals.length || a.price.subtotals.some((money, i) => money.currency !== expectedTotals[i]!.currency || money.amountMinor !== expectedTotals[i]!.amountMinor) ||
      a.price.comparability !== (totals.size > 1 ? "mixed-currency" : totals.size === 1 ? "same-currency" : "unknown") ||
      a.price.coverage === "complete" && (a.price.unpricedItemCount !== 0 || !a.price.observations.length)) fail();
  if (a.price.observations.length && !a.price.evidenceIds.length || a.price.status === "known" && (a.price.coverage !== "complete" || !a.price.observations.length)) fail();
  const freshnessIds = new Set<string>();
  for (const f of a.freshness) {
    exactKeys(f, ["evidenceId", "status", "retrievedAt", "observedAt", "validUntil"]);
    const source = a.sources.find((s) => s.id === f.evidenceId);
    if (!source || freshnessIds.has(f.evidenceId) || !["fresh", "stale", "unknown", "unavailable"].includes(f.status) ||
        f.retrievedAt !== source.retrievedAt || f.observedAt !== source.observedAt || f.validUntil !== source.validUntil) fail();
    freshnessIds.add(f.evidenceId);
  }
  if (freshnessIds.size !== ids.size) fail();
  for (const c of a.caveats) {
    exactKeys(c, ["category", "code"]);
    if (!["constraints", "places", "mobility", "weather", "hazard", "price", "party"].includes(c.category) || !candidateReasonCodes.includes(c.code)) fail();
  }
}
function fail(): never { throw new Error("Invalid candidate assessment"); }
function text(value: string): void { if (typeof value !== "string" || !value.trim()) fail(); }
