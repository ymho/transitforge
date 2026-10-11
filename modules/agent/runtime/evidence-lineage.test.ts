import { expect, it } from "vitest";
import { assessDerivedCurrentness, mergeEvidenceObservations, validateEvidenceAndClaims, type Evidence } from "./evidence-model";
import type { TravelApplicabilityFact } from "./travel-applicability";

function evidence(id: string, scope: string, value: string): Evidence { return { id, category: "external", knowledgeKind: "deterministic_fact",
  subject: "同名ホテル", facts: { availability: value }, references: [{ sourceType: "external-source", sourceRef: "provider:hotel-1", retrievedAt: "2026-09-23T00:00:00Z", freshness: "current", summary: "provider" }],
  observation: { observationId: id, subjectKey: "hotel:provider:1", scopeKey: scope, predicate: "availability", retrievedAt: "2026-09-23T00:00:00Z",
    applicability: "applicable", state: "current", retention: "reference_only" } }; }

it("keeps observations for different date/party scopes and treats exact retry as idempotent", () => {
  const first = evidence("obs-a", "2026-10-01:2-adults", "available");
  const second = evidence("obs-b", "2026-10-02:1-adult", "unknown");
  const merged = mergeEvidenceObservations([first], [second, structuredClone(first)], 10);
  expect(merged.evidence.map((item) => item.id)).toEqual(["obs-a", "obs-b"]); expect(merged.collisions).toEqual([]);
  expect(first.observation?.state).toBe("current");
  expect(mergeEvidenceObservations([first], [second], 1).omittedCount).toBe(1);
});
it("reports ID collision and preserves contradictory observations instead of first-wins", () => {
  const first = evidence("same", "scope", "available");
  expect(mergeEvidenceObservations([first], [evidence("same", "scope", "unknown")]).collisions).toHaveLength(1);
  const merged = mergeEvidenceObservations([evidence("a", "scope", "available")], [evidence("b", "scope", "unavailable")]);
  expect(merged.evidence.map((item) => item.observation?.state)).toEqual(["conflicting", "conflicting"]);
});
it("does not report a conflict when only retrieval metadata changed", () => {
  const first = evidence("a", "scope", "available");
  const later = evidence("b", "scope", "available");
  later.references[0] = { ...later.references[0]!, retrievedAt: "2026-09-24T00:00:00Z" };
  later.observation = { ...later.observation!, retrievedAt: "2026-09-24T00:00:00Z" };
  const merged = mergeEvidenceObservations([first], [later]);
  expect(merged.conflictingObservationIds).toEqual([]);
  expect(merged.evidence.map((item) => item.observation?.state)).toEqual(["current", "current"]);
});
it("does not call an unrelated reference semantically supported and invalidates derived currentness", () => {
  const source = evidence("weather-kyoto", "kyoto:2026-10-01", "sunny");
  expect(validateEvidenceAndClaims([source], [{ id: "claim", statement: "大阪は晴れ", kind: "fact", evidenceIds: [source.id] }]).claims[0]?.groundingStatus).toBe("unsupported");
  expect(validateEvidenceAndClaims([source], [{ id: "claim", statement: "京都は晴れ", kind: "fact", evidenceIds: [source.id],
    bindings: [{ evidenceId: source.id, fieldPath: "facts.availability", subjectRef: "hotel:provider:1", applicabilityScope: "kyoto:2026-10-01", transform: "identity" }] }]).claims[0]?.groundingStatus).toBe("supported");
  source.observation = { ...source.observation!, state: "withdrawn" };
  expect(assessDerivedCurrentness({ assessmentId: "assessment", sourceObservationIds: [source.id], inputRevision: "1", inputHash: "hash", calculationVersion: "v1", currentness: "current" }, [source]).currentness).toBe("needs_recheck");
});

it("compares applicability content separately from acquisition provenance", () => {
  const first = evidence("a", "scope", "available"), later = evidence("b", "scope", "available");
  const fact: TravelApplicabilityFact = { kind: "visit_requirement", observationId: "a", subjectRef: "hotel:provider:1",
    applicabilityScope: "scope", validDuring: { from: "2026-10-01", until: "2026-10-02" }, reservation: "required",
    sourceRef: "provider:a", sourceSpan: { text: "予約必須", start: 0, end: 4 },
    retrievedAt: "2026-09-23T00:00:00Z", extractionKind: "provider_structured" };
  first.applicabilityFacts = [fact];
  later.applicabilityFacts = [{ ...fact, observationId: "b", sourceRef: "provider:b",
    sourceSpan: { text: "事前予約が必要", start: 10, end: 17 }, retrievedAt: "2026-09-24T00:00:00Z", extractionKind: "human_verified" }];
  const merged = mergeEvidenceObservations([first], [later]);
  expect(merged.conflictingObservationIds).toEqual([]);
  expect(merged.evidence[1]!.applicabilityFacts).toEqual(later.applicabilityFacts);
  expect(mergeEvidenceObservations([first], [{ ...later, id: first.id }]).collisions).toHaveLength(1);
});

it.each(["reservation", "validity", "scope"] as const)("keeps applicability %s differences conflicting", change => {
  const first = evidence("a", "scope", "available"), later = evidence("b", "scope", "available");
  const fact: TravelApplicabilityFact = { kind: "visit_requirement", observationId: "a", subjectRef: "hotel:provider:1",
    applicabilityScope: "scope", validDuring: { from: "2026-10-01" }, reservation: "required",
    sourceRef: "provider:a", retrievedAt: "2026-09-23T00:00:00Z", extractionKind: "provider_structured" };
  first.applicabilityFacts = [fact];
  later.applicabilityFacts = [{ ...fact, observationId: "b", ...(change === "reservation" ? { reservation: "not_required" } :
    change === "validity" ? { validDuring: { from: "2026-10-02" } } : { applicabilityScope: "other" }) }];
  expect(mergeEvidenceObservations([first], [later]).conflictingObservationIds).toEqual(["a", "b"]);
});
