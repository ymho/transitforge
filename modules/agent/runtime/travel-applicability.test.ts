import { describe, expect, it } from "vitest";
import { assessApplicability, normalizeProviderApplicability, parseExtractedApplicability, type TravelApplicabilityFact } from "./travel-applicability";

const base = { observationId: "obs-1", subjectRef: "place:provider:branch-a", applicabilityScope: "visit:2026-10-05",
  sourceRef: "https://example.test/place", retrievedAt: "2026-09-23T00:00:00Z", extractionKind: "provider_structured" as const };
const scope = { subjectRef: base.subjectRef, scopeRef: base.applicabilityScope, calendarDate: "2026-10-05", minuteOfDay: 23 * 60 + 30,
  timeZone: "Asia/Tokyo", locationResolved: true };

describe("travel applicability", () => {
  it("gives exception closure priority and handles overnight opening windows", () => {
    const fact: TravelApplicabilityFact = { ...base, kind: "opening_windows", timeZone: "Asia/Tokyo",
      windows: [{ weekdays: [1], opensMinute: 22 * 60, closesMinute: 2 * 60, lastAdmissionMinute: 60 }], closedDates: ["2026-10-12"] };
    expect(assessApplicability(fact, scope)).toMatchObject({ status: "match", reason: "within_opening_window" });
    expect(assessApplicability(fact, { ...scope, calendarDate: "2026-10-06", minuteOfDay: 30 })).toMatchObject({ status: "match", reason: "within_opening_window" });
    expect(assessApplicability(fact, { ...scope, calendarDate: "2026-10-12" })).toMatchObject({ status: "mismatch", reason: "exception_closed", feasibilityUse: "blocked" });
  });
  it("does not apply one branch, date, participant or season to another", () => {
    const visit: TravelApplicabilityFact = { ...base, kind: "visit_requirement", reservation: "required",
      participantRequirements: [{ field: "age", operator: "minimum", value: 18 }] };
    expect(assessApplicability(visit, { ...scope, subjectRef: "place:provider:branch-b" }).status).toBe("mismatch");
    expect(assessApplicability(visit, { ...scope, participantFacts: {} }).status).toBe("unknown");
    expect(assessApplicability(visit, { ...scope, participantFacts: { age: 12 } }).status).toBe("mismatch");
    const seasonal: TravelApplicabilityFact = { ...base, kind: "seasonal_relevance", months: [4] };
    expect(assessApplicability(seasonal, { ...scope, calendarDate: undefined })).toMatchObject({ status: "unknown", feasibilityUse: "recommendation_only" });
  });
  it("requires a model extraction to bind an exact source span", () => {
    const sourceText = "通常営業。ただし10月5日は休業します。";
    const start = sourceText.indexOf("10月5日");
    const fact = { ...base, kind: "visit_requirement", reservation: "unknown", sourceSpan: { text: "10月5日は休業", start, end: start + 8 } };
    expect(parseExtractedApplicability({ fact, sourceText }).extractionKind).toBe("model_extracted");
    expect(() => parseExtractedApplicability({ fact: { ...fact, sourceSpan: { ...fact.sourceSpan, text: "営業中" } }, sourceText })).toThrow("Unbound");
    expect(normalizeProviderApplicability({ ...base, kind: "access_requirement", originRef: "station:a", destinationRef: "place:b", mode: "walking", lowerBoundMinutes: 15 }).kind).toBe("access_requirement");
  });
});
