import { describe, expect, it } from "vitest";
import { hazardInformation } from "./hazard-alert.fixture";
import { assessTravelCandidate } from "./assess-travel-candidate";
import { validateTravelCandidateAssessment } from "./validate-candidate-assessment";
import { assessmentAt, candidateAssessmentFixture, forecastFixture, assessedInformation, assessmentSource } from "./candidate-assessment.fixture";
import { railSelectionFixture } from "./selected-rail-journey.fixture";
import { resolvedPlace } from "./trip-places.fixture";
import type { TripRequirement } from "./trip-request";

function evaluate(f = candidateAssessmentFixture()) { return assessTravelCandidate(f.trip, f.candidate, f.facts, assessmentAt); }
function constraint(f: ReturnType<typeof candidateAssessmentFixture>, requirement: TripRequirement, strength: "hard" | "soft" = "hard") {
  f.trip = { ...f.trip, request: { ...f.trip.request, constraints: [...f.trip.request.constraints,
    { id: "extra", strength, source: "user", scope: { type: "trip" }, requirement }] } };
}
describe("candidate comparison is a pure Evidence-derived view, not adoption", () => {
  it.each(["unresolved", "mismatch"] as const)("target binding %s never becomes regional fit", (status) => {
    const f = candidateAssessmentFixture();
    f.facts.placeTargetBinding = { status, evidenceIds: f.facts.places!.evidence.map(e => e.id) };
    expect(evaluate(f).relevance.status).toBe(status === "mismatch" ? "questionable" : "unknown");
  });
  it("retains hard/soft/unknown independently and never mutates input", () => {
    const f = candidateAssessmentFixture(); constraint(f, { type: "pace", value: 0.2 }, "soft");
    const original = structuredClone(f), a = evaluate(f);
    expect(a.constraintStatus).toBe("satisfied"); expect(a.softPreferences[0]?.status).toBe("unknown");
    expect(a.relevance.status).toBe("fit"); expect(a.partial).toBe(true); expect(a.mobility.status).toBe("unknown");
    expect(evaluate(f)).toEqual(a); expect(f).toEqual(original); expect(f.trip.items).toEqual([]);
  });
  it.each(["same-name-other-id", "different-provider", "Vienna-Wien", "missing-identity"])("uses identity, never name/rank: %s (#366)", (kind) => {
    const f = candidateAssessmentFixture();
    let place = resolvedPlace(kind === "Vienna-Wien" ? "Wien" : "Vienna", "another-id", kind === "different-provider" ? "other-provider" : "fixture-places");
    if (kind === "missing-identity") place = { name: place.name, sources: place.sources };
    f.facts.places = assessedInformation({ destinations: [place], complete: true }, place.sources);
    const a = evaluate(f); expect(a.relevance.status).toBe(["missing-identity", "different-provider"].includes(kind) ? "unknown" : "questionable");
    expect(a.weather.status).toBe("unknown");
  });
  it("checks ordered multiple places without collapsing them into a destination string", () => {
    const f = candidateAssessmentFixture(), second = resolvedPlace("Salzburg");
    f.trip = { ...f.trip, request: { constraints: [{ ...f.trip.request.constraints[0]!, requirement: {
      type: "destinations", order: "fixed", places: [f.destination, second] } }], assumptions: [] } };
    expect(evaluate(f).constraintStatus).toBe("violated");
    f.facts.places = assessedInformation({ destinations: [f.destination, second], complete: true }, [...f.destination.sources, ...second.sources]);
    expect(evaluate(f).constraintStatus).toBe("satisfied");
    f.facts.places.data!.destinations.reverse(); expect(evaluate(f).constraintStatus).toBe("violated");
    f.facts.places.data!.complete = false; expect(evaluate(f).constraintStatus).toBe("unknown");
  });
  it("uses scheduled rail facts, not delayed aggregate minutes/status", () => {
    const f = candidateAssessmentFixture(), rail = railSelectionFixture();
    rail.candidate.journey.arrivalTimeMinutes = 990; rail.candidate.journey.transferCount = 99;
    f.candidate.journey = rail.candidate.journey; f.facts.rail = rail;
    constraint(f, { type: "mobility", maxTravelMinutes: 110, maxTransfers: 1, modes: ["rail"] });
    const a = evaluate(f); expect(a.mobility).toMatchObject({ status: "known", travelMinutes: 100, transfers: 1, modes: ["rail"] });
    expect(a.constraintStatus).toBe("satisfied"); expect(JSON.stringify(a)).not.toMatch(/delayMinutes|delayStatus|selectedAt|arrivalTimeMinutes/);
    rail.inputs[0]!.contentDigest = "changed"; expect(evaluate(f).mobility.status).toBe("unknown");
  });
  it("non-rail route duration does not invent zero transfers or a scheduled instant", () => {
    const f = candidateAssessmentFixture();
    f.facts.groundAccess = assessedInformation({ origin: { entityId: "a", name: "A", longitude: 1, latitude: 1 },
      destination: { entityId: "b", name: "B", longitude: 2, latitude: 2 }, mode: "walking", durationMinutes: 20, distanceMeters: 1000, geometry: [] }, [assessmentSource("walk", "ground-access")]);
    constraint(f, { type: "mobility", maxTransfers: 0 });
    expect(evaluate(f).mobility).toMatchObject({ status: "partial", travelMinutes: 20, modes: ["walk"] });
    expect(evaluate(f).mobility.transfers).toBeUndefined(); expect(evaluate(f).constraintStatus).toBe("unknown");
  });
  it.each([[10, "favorable"], [45, "mixed"], [80, "poor"]] as const)("weather %i → %s with cited forecast", (probability, expected) => {
    const f = candidateAssessmentFixture(); f.facts.weather!.result.data = forecastFixture(probability);
    expect(evaluate(f).weather.status).toBe(expected); expect(evaluate(f).weather.evidenceIds).toEqual(["weather-candidate-a"]);
  });
  it.each(["missing", "unavailable", "range-out", "stale", "unknown-freshness", "invalid"])("weather %s never means sunny", (kind) => {
    const f = candidateAssessmentFixture();
    if (kind === "missing") delete f.facts.weather;
    else if (kind === "unavailable") f.facts.weather!.result = { status: "unavailable", freshness: "unknown", evidence: [], failure: { code: "timeout", message: "timeout", retryable: true } };
    else if (kind === "range-out") f.facts.weather!.target.endDate = "2026-09-30";
    else if (kind === "stale") f.facts.weather!.result.evidence[0]!.validUntil = "2026-09-12T07:59:00Z";
    else if (kind === "unknown-freshness") delete f.facts.weather!.result.evidence[0]!.validUntil;
    else f.facts.weather!.result.data!.daily[0]!.maximumPrecipitationProbabilityPercent = NaN;
    const a = evaluate(f); expect(a.weather.status).toBe(kind === "unavailable" ? "unavailable" : "unknown");
    expect(a.relevance.status).toBe("fit"); expect(a.price.status).toBe("known"); expect(a.partial).toBe(true);
    if (kind === "stale") expect(a.freshness.find((v) => v.evidenceId === "weather-candidate-a")?.status).toBe("stale");
  });
  it("public hazard severity never becomes candidate rejection; unavailable/unknown/empty are not safe", () => {
    const f = candidateAssessmentFixture();
    const baseline = evaluate(f);
    const result = hazardInformation();
    result.evidence[0]!.validUntil = "2026-09-13T00:00:00Z";
    // Fixture assessment time is 08:00; maintain identity binding from resolved candidate.
    f.facts.hazard = { place: f.destination.ref!, result };
    for (const severity of ["information", "advisory", "warning", "emergency", "unknown"] as const) {
      result.data!.alerts[0]!.severity = severity;
      const assessment = evaluate(f);
      expect(assessment.hazard.status).toBe("present");
      expect(assessment.hardConstraints).toEqual(baseline.hardConstraints);
      expect(assessment.constraintStatus).toBe(baseline.constraintStatus);
    }
    for (const status of ["unknown", "unavailable"] as const) {
      f.facts.hazard.result = { status, freshness: "unknown", evidence: [] };
      expect(evaluate(f).hazard.status).toBe(status);
    }
    f.facts.hazard.result = { ...result, data: { area: "大阪府", alerts: [] } };
    expect(evaluate(f).hazard.status).toBe("unknown");
    f.facts.hazard.result = result;
    Object.assign(result.data!.alerts[0]!, { raw: "must not leak" });
    expect(evaluate(f).hazard.reasonCodes).toContain("invalid-facts");
  });
  it("empty/unacquired alerts are unknown; acquired warnings are present", () => {
    const f = candidateAssessmentFixture(); expect(evaluate(f).hazard.status).toBe("unknown");
    f.facts.hazard = { place: f.destination.ref!, result: assessedInformation({ area: "Synthetic", alerts: [] }, [assessmentSource("alert", "safety-alert")]) };
    expect(evaluate(f).hazard.status).toBe("unknown");
    f.facts.hazard.result.data!.alerts.push({ providerAlertId: "warning-a", category: "warning", severity: "warning", title: "Warning", summary: "Fixture", issuedAt: "2026-09-12T07:50:00Z", sourceUrl: "https://example.com/warning" });
    expect(evaluate(f).hazard.status).toBe("present"); expect(evaluate(f).caveats).toContainEqual({ category: "hazard", code: "hazard-present" });
  });
  it("retains original currency observations; mixed totals and unpriced never become a fake total", () => {
    const f = candidateAssessmentFixture(); constraint(f, { type: "budget", limit: { currency: "EUR", amountMinor: 10000 }, basis: "trip" });
    expect(evaluate(f).constraintStatus).toBe("violated");
    f.candidate.accommodations = [...f.candidate.accommodations, { ...f.candidate.accommodations[0]!, providerItemId: "hotel-b", price: { price: { currency: "JPY", amountMinor: 10000 }, observedAt: "2026-09-12T07:54:00Z" } }];
    f.facts.prices!.data!.items.push({ provider: "fixture", providerItemId: "hotel-b", observation: f.candidate.accommodations[1]!.price! });
    f.facts.prices!.evidence.push(assessmentSource("price-b", "accommodation", "fixture", "hotel-b"));
    f.candidate.experiences = [{ kind: "experience", provider: "fixture", providerItemId: "unpriced", name: "Unknown price", startDate: "2026-09-13" }];
    const a = evaluate(f); expect(a.price.subtotals).toEqual([{ currency: "EUR", amountMinor: 12000 }, { currency: "JPY", amountMinor: 10000 }]);
    expect(a.price.comparability).toBe("mixed-currency"); expect(a.price.unpricedItemCount).toBe(1); expect(a.constraintStatus).toBe("unknown");
    delete f.facts.prices; expect(evaluate(f).price.subtotals).toEqual([]);
  });
  it("rejects unknown assessment fields/enums/references, omits provider raw inputs", () => {
    const f = candidateAssessmentFixture(); Object.assign(f.facts.weather!.result.data!, { raw: { apiKey: "not-a-secret-fixture" } });
    const a = evaluate(f); expect(JSON.stringify(a)).not.toContain("raw");
    expect(() => validateTravelCandidateAssessment({ ...a, unknown: true } as never)).toThrow();
    expect(() => validateTravelCandidateAssessment({ ...a, relevance: { ...a.relevance, status: "good" } } as never)).toThrow();
    expect(() => validateTravelCandidateAssessment({ ...a, weather: { ...a.weather, evidenceIds: ["not-acquired"] } })).toThrow();
  });
  it("same-currency observed subtotals remain integer Money and forged sums are rejected", () => {
    const f = candidateAssessmentFixture();
    f.candidate.accommodations = [...f.candidate.accommodations, { ...f.candidate.accommodations[0]!, providerItemId: "b" }];
    f.facts.prices!.data!.items.push({ provider: "fixture", providerItemId: "b", observation: f.candidate.accommodations[1]!.price! });
    f.facts.prices!.evidence.push(assessmentSource("b", "accommodation", "fixture", "b"));
    const a = evaluate(f); expect(a.price.subtotals).toEqual([{ amountMinor: 24000, currency: "EUR" }]);
    expect(() => validateTravelCandidateAssessment({ ...a, price: { ...a.price, subtotals: [{ amountMinor: 1, currency: "EUR" }] } })).toThrow();
  });
  it("dates are verified candidate dates; missing end/zone is not invented", () => {
    const f = candidateAssessmentFixture();
    constraint(f, { type: "dates", start: { earliest: "2026-09-13", latest: "2026-09-13" } });
    expect(evaluate(f).constraintStatus).toBe("unknown");
    f.facts.dates = assessedInformation({ startDate: "2026-09-13" }, [assessmentSource("date", "event")]);
    expect(evaluate(f).constraintStatus).toBe("satisfied");
    f.facts.dates.data!.startDate = "2026-09-14"; expect(evaluate(f).constraintStatus).toBe("violated");
    f.facts.dates.data!.startDate = "2026-09-99"; expect(evaluate(f).constraintStatus).toBe("unknown");
  });
  it("does not call today's forecast favorable for a known later trip date", () => {
    const f = candidateAssessmentFixture(); constraint(f, { type: "dates", start: { earliest: "2026-10-20", latest: "2026-10-20" } });
    expect(evaluate(f).weather.status).toBe("unknown"); expect(evaluate(f).weather.reasonCodes).toContain("forecast-range-out");
  });
  it("keeps unconfirmed constraints unknown and honors existing user-over-profile precedence", () => {
    const f = candidateAssessmentFixture();
    f.trip = { ...f.trip, request: { constraints: [{ ...f.trip.request.constraints[0]!, source: "assumption", assumptionId: "a" }],
      assumptions: [{ id: "a", source: "model", status: "unconfirmed", text: "仮の地域", affects: [{ type: "constraint", constraintId: "region" }] }] } };
    expect(evaluate(f).constraintStatus).toBe("unknown");
    f.trip = { ...f.trip, request: { ...f.trip.request, assumptions: [{ ...f.trip.request.assumptions[0]!, status: "confirmed" }] } };
    expect(evaluate(f).constraintStatus).toBe("satisfied");
    const original = candidateAssessmentFixture();
    original.trip = { ...original.trip, request: { ...original.trip.request, constraints: [...original.trip.request.constraints,
      { ...original.trip.request.constraints[0]!, id: "profile-region", source: "profile", requirement: { type: "destinations", order: "flexible", places: [resolvedPlace("elsewhere")] } }] } };
    expect(evaluate(original).hardConstraints).toHaveLength(1);
  });
  it("provider party support applies only to exactly the acquired counts/ages, not availability", () => {
    const f = candidateAssessmentFixture(); f.trip = { ...f.trip, request: { ...f.trip.request, party: { source: "user", adults: 2, children: [{ age: 4 }] } } };
    f.facts.party = assessedInformation({ adults: 2, childAges: [4], supported: true }, [assessmentSource("party", "accommodation")]);
    expect(evaluate(f).party.status).toBe("satisfied");
    f.facts.party.data!.supported = false; expect(evaluate(f).party.status).toBe("violated");
    f.facts.party.data!.childAges = [null]; expect(evaluate(f).party.status).toBe("unknown");
    expect(JSON.stringify(evaluate(f))).not.toContain("availability");
  });
  it("malformed or inconsistent Evidence degrades only the affected category", () => {
    const f = candidateAssessmentFixture(); f.facts.weather!.result.evidence[0]!.kind = "place";
    expect(evaluate(f).weather.status).toBe("unknown"); expect(evaluate(f).price.status).toBe("known");
    f.facts.prices!.evidence[0]!.sourceId = "different-product";
    expect(evaluate(f).price.subtotals).toEqual([]);
    expect(evaluate(f).relevance.status).toBe("fit");
  });
  it("accepts existing provider request URLs without leaking their query into Context/Evidence", () => {
    const f = candidateAssessmentFixture();
    f.facts.weather!.result.evidence[0]!.sourceUrl = "https://api.open-meteo.com/v1/forecast?latitude=48.2&longitude=16.3&token=fixture-sensitive";
    const a = evaluate(f); expect(a.weather.status).toBe("favorable");
    expect(a.sources.find((s) => s.kind === "weather")?.sourceId).toBe("weather-candidate-a");
    expect(JSON.stringify(a)).not.toMatch(/fixture-sensitive|latitude=|token=/);
  });
});
