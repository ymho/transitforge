import { addMoney, copyPriceObservation, validatePriceObservation, type Money } from "./money";
import type { TravelCandidate } from "./travel-candidate";
import type { CandidateAssessmentFacts, CandidatePriceAssessment } from "./travel-candidate-assessment";
import type { CandidateFactReader } from "./candidate-assessment-input";

export function assessCandidatePrice(candidate: TravelCandidate, facts: CandidateAssessmentFacts, reader: CandidateFactReader): CandidatePriceAssessment {
  const offerings = [...candidate.accommodations, ...candidate.experiences];
  const result: CandidatePriceAssessment = { status: "unknown", observations: [], subtotals: [], comparability: "unknown",
    coverage: "partial", unpricedItemCount: offerings.length, reasonCodes: ["missing-facts"], evidenceIds: [] };
  const read = reader.read("price", facts.prices, ["accommodation", "event"], (data) => {
    if (!["complete", "partial"].includes(data.coverage) || data.basis !== undefined && !["trip", "per-person"].includes(data.basis) ||
        !Array.isArray(data.items)) throw new Error("Invalid cost scope");
    const keys = new Set<string>();
    for (const item of data.items) {
      validatePriceObservation(item.observation);
      const matches = offerings.filter((offering) => offering.provider === item.provider && offering.providerItemId === item.providerItemId);
      const key = JSON.stringify([item.provider, item.providerItemId]);
      if (keys.has(key) || matches.length !== 1 || !matches[0]!.price ||
          JSON.stringify(copyPriceObservation(matches[0]!.price)) !== JSON.stringify(copyPriceObservation(item.observation)) ||
          !facts.prices!.evidence.some((source) => source.provider === item.provider && source.sourceId === item.providerItemId &&
            Date.parse(item.observation.observedAt) <= Date.parse(source.retrievedAt))) throw new Error("Price/source/candidate mismatch");
      keys.add(key);
    }
  }, true);
  result.evidenceIds = read.evidenceIds;
  if (!read.data) { result.reasonCodes = [read.reason ?? "missing-facts"]; return result; }
  const observations = read.data.items.map((item) => copyPriceObservation(item.observation));
  const totals = new Map<string, Money>();
  try {
    for (const observation of observations) {
      const previous = totals.get(observation.price.currency);
      totals.set(observation.price.currency, previous ? addMoney(previous, observation.price) : { ...observation.price });
    }
  } catch { result.reasonCodes = ["invalid-facts"]; return result; }
  result.observations = observations;
  result.subtotals = [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  result.unpricedItemCount = offerings.length - observations.length;
  result.comparability = totals.size > 1 ? "mixed-currency" : totals.size === 1 ? "same-currency" : "unknown";
  // Existing price observation does not include rail fare. Never use it to certify a complete rail trip price.
  result.coverage = !candidate.journey && !result.unpricedItemCount && observations.length && read.data.coverage === "complete" ? "complete" : "partial";
  if (read.data.basis) result.basis = read.data.basis;
  result.status = observations.length ? result.coverage === "complete" ? "known" : "partial" : "unknown";
  result.reasonCodes = [...(totals.size > 1 ? ["mixed-currency" as const] : []),
    ...(result.unpricedItemCount ? ["unpriced-items" as const] : []), ...(result.coverage === "partial" ? ["partial-coverage" as const] : [])];
  return result;
}
