import { validateTrip, type Trip } from "./trip";
import type { TravelCandidate } from "./travel-candidate";
import { validatePlaceSnapshot } from "./place-snapshot";
import { validDate, validInstant } from "./snapshot-validation";
import { verifyRailCandidateSchedule } from "./selected-rail-journey";
import { CandidateFactReader } from "./candidate-assessment-input";
import { assessCandidateConstraints, type CandidateConstraintFacts } from "./candidate-constraint-assessment";
import { assessCandidateEnvironment } from "./candidate-environment-assessment";
import { assessCandidatePrice } from "./candidate-price-assessment";
import type { CandidateAssessmentFacts, TravelCandidateAssessment } from "./travel-candidate-assessment";
import { validateTravelCandidateAssessment } from "./validate-candidate-assessment";
import { effectiveTripConstraints } from "./trip-request";
import { assessTravelCoverage } from "./travel-coverage";

/** Pure, read-only. No Tool execution, model inference, candidate pruning, proposal or persistence. */
export function assessTravelCandidate(trip: Trip, candidate: TravelCandidate, facts: CandidateAssessmentFacts,
  now: string, itemId?: string): TravelCandidateAssessment {
  validateTrip(trip);
  if (!candidate.id?.trim() || candidate.id !== facts.candidateId || itemId !== undefined && !trip.items.some((item) => item.id === itemId)) {
    throw new Error("Assessment candidate/scope mismatch");
  }
  const reader = new CandidateFactReader(now);
  const places = reader.read("places", facts.places, ["place", "timetable", "accommodation", "event"], (data) => {
    if (!Array.isArray(data.destinations) || typeof data.complete !== "boolean") throw new Error("Invalid place coverage");
    for (const place of [...data.destinations, ...(data.origin ? [data.origin] : [])]) {
      validatePlaceSnapshot(place);
      if (place.ref?.provider === "manual" || !place.sources.length || !place.sources.every((source) =>
        facts.places!.evidence.some((e) => e.id === source.id && e.provider === source.provider && e.sourceId === source.sourceId && e.retrievedAt === source.retrievedAt))) {
        throw new Error("Place evidence mismatch");
      }
    }
  });
  const dates = reader.read("constraints", facts.dates, ["timetable", "accommodation", "event"], (data) => {
    if (!validDate(data.startDate) || data.endDate !== undefined && (!validDate(data.endDate) || data.endDate < data.startDate)) throw new Error("Invalid candidate dates");
  });
  const proof: CandidateConstraintFacts = { mobility: { status: "unknown", evidenceIds: [] },
    price: assessCandidatePrice(candidate, facts, reader),
    ...(places.data ? { places: { ...places.data, evidenceIds: places.evidenceIds } } : {}),
    ...(dates.data ? { dates: { ...dates.data, evidenceIds: dates.evidenceIds } } : {}) };
  if (facts.rail) {
    try {
      if (facts.rail.candidate.candidateId !== candidate.id || !candidate.journey ||
          JSON.stringify(candidate.journey) !== JSON.stringify(facts.rail.candidate.journey) ||
          !validInstant(facts.rail.candidate.verifiedAt) || Date.parse(facts.rail.candidate.verifiedAt) > Date.parse(now)) throw new Error("Rail candidate mismatch");
      const scheduled = verifyRailCandidateSchedule(facts.rail.candidate, facts.rail.inputs);
      const sources = [...new Map(scheduled.provenance.sources.map((source) => [source.id, source])).values()];
      const read = reader.read("mobility", { status: "available", freshness: "unknown", data: scheduled, evidence: sources }, ["timetable"], () => {});
      if (!read.data) throw new Error("Rail evidence mismatch");
      const first = scheduled.legs[0]!, last = scheduled.legs.at(-1)!;
      proof.mobility = { status: "known", travelMinutes: (Date.parse(last.scheduledArrival.at) - Date.parse(first.scheduledDeparture.at)) / 60_000,
        transfers: scheduled.transfers.length, modes: ["rail"], evidenceIds: read.evidenceIds };
      proof.endpoints = { origin: first.origin, destination: last.destination, departure: first.scheduledDeparture,
        arrival: last.scheduledArrival, evidenceIds: read.evidenceIds };
    } catch { reader.caveats.push({ category: "mobility", code: "invalid-facts" }); }
  } else if (facts.groundAccess) {
    const read = reader.read("mobility", facts.groundAccess, ["ground-access"], (route) => {
      if (!["walking", "driving", "cycling"].includes(route.mode) || !Number.isFinite(route.durationMinutes) || route.durationMinutes < 0 ||
          !route.origin?.entityId || !route.destination?.entityId) throw new Error("Invalid ground route");
    }, true);
    if (read.data) proof.mobility = { status: "partial", travelMinutes: read.data.durationMinutes,
      modes: [read.data.mode === "walking" ? "walk" : read.data.mode === "driving" ? "car" : "bicycle"], evidenceIds: read.evidenceIds };
    // Duration from the provider is known; transfers and absolute schedule are not inferred.
  }
  const party: TravelCandidateAssessment["party"] = { status: "unknown", reasonCodes: ["missing-facts"], evidenceIds: [] };
  const p = reader.read("party", facts.party, ["accommodation", "event", "restaurant"], (data) => {
    if (!Number.isSafeInteger(data.adults) || data.adults < 0 || !Array.isArray(data.childAges) ||
        data.childAges.some((age) => age !== null && (!Number.isSafeInteger(age) || age < 0)) || typeof data.supported !== "boolean") throw new Error("Invalid provider party input");
  }, true);
  party.evidenceIds = p.evidenceIds;
  const requested = trip.request.party;
  if (p.data && requested && (!requested.assumptionId || trip.request.assumptions.find((a) => a.id === requested.assumptionId)?.status === "confirmed")) {
    const ages = requested.children.map((c) => c.age ?? null);
    if (p.data.adults === requested.adults && JSON.stringify([...ages].sort()) === JSON.stringify([...p.data.childAges].sort()) && !ages.includes(null)) {
      party.status = p.data.supported ? "satisfied" : "violated";
      party.reasonCodes = [p.data.supported ? "verified-match" : "verified-mismatch"];
    }
  }
  const evaluated = assessCandidateConstraints(trip.request, proof, itemId);
  if (facts.placeTargetBinding && facts.placeTargetBinding.status !== "resolved") {
    evaluated.relevance = placeTargetRelevance(facts.placeTargetBinding.status,
      facts.placeTargetBinding.evidenceIds.filter((id) => reader.sources.has(id)));
  }
  const expectedDates = dates.data ? [dates.data] : effectiveTripConstraints(trip.request, itemId).flatMap((c) => {
    if (c.scope.type === "item" && itemId === undefined || c.assumptionId && trip.request.assumptions.find((a) => a.id === c.assumptionId)?.status !== "confirmed") return [];
    return c.requirement.type === "dates" ? [{ startDate: c.requirement.start.earliest,
      endDate: c.requirement.end?.latest ?? c.requirement.start.latest }] : [];
  });
  const environment = assessCandidateEnvironment(facts, places.data?.destinations ?? [], reader, expectedDates);
  const result: TravelCandidateAssessment = { candidateId: candidate.id, assessedAt: now, ...evaluated,
    serviceCoverage: assessTravelCoverage(facts, now),
    mobility: proof.mobility, ...environment, price: proof.price, party,
    freshness: [...reader.freshness.values()], sources: [...reader.sources.values()], caveats: reader.caveats, partial: false };
  for (const constraint of result.hardConstraints) if (constraint.status !== "satisfied") {
    result.caveats.push({ category: "constraints", code: constraint.status === "violated" ? "verified-mismatch" : "missing-facts" });
  }
  for (const [category, reasons] of [["places", result.relevance.reasonCodes], ["weather", result.weather.reasonCodes],
    ["hazard", result.hazard.reasonCodes], ["price", result.price.reasonCodes]] as const) {
    for (const code of reasons) if (code !== "verified-match") result.caveats.push({ category, code });
  }
  if (result.mobility.status !== "known") result.caveats.push({ category: "mobility", code: "partial-coverage" });
  if (requested && party.status !== "satisfied") result.caveats.push({ category: "party", code: party.status === "violated" ? "verified-mismatch" : "missing-facts" });
  result.partial = result.hardConstraints.some((c) => c.status === "unknown") || result.relevance.status === "unknown" ||
    result.mobility.status !== "known" || ["unknown", "unavailable"].includes(result.weather.status) ||
    result.hazard.status !== "present" || result.price.coverage !== "complete" || !!requested && party.status === "unknown";
  result.caveats = result.caveats.filter((c, i, all) => all.findIndex((other) => other.category === c.category && other.code === c.code) === i);
  validateTravelCandidateAssessment(result);
  return result;
}

/** Existing Assessment relevance projection for discovery before a persisted Trip exists.
 * A stable candidate entity alone does not prove requested-target or regional relevance. */
export function placeTargetRelevance(status: "resolved" | "unresolved" | "mismatch", evidenceIds: string[]): TravelCandidateAssessment["relevance"] {
  return { status: !evidenceIds.length || status === "unresolved" ? "unknown" : status === "resolved" ? "fit" : "questionable",
    reasonCodes: [status === "resolved" && evidenceIds.length ? "verified-match" : status === "mismatch" ? "identity-mismatch" : "identity-unresolved"],
    evidenceIds: [...new Set(evidenceIds)].slice(0, 8) };
}
