import { parsePublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";
import { parsePublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";

/** Synthetic display fixture, never a real timetable or account document. */
export function consultationDesignFixture() {
  const publicJourneyPresentation = parsePublicJourneyPresentation({ version: "public-journey-presentation-v1", presentationId: "synthetic-journey",
    serviceDate: "2026-09-13", originStation: "A", destinationStation: "C", evidenceRefs: ["synthetic-evidence"],
    journeys: [1, 2, 3].map(index => ({ id: `journey-${index}`, departureTime: "09:00", arrivalTime: "10:40", durationMinutes: 100, transferCount: 1,
      legs: [{ originStation: "A", destinationStation: "B", departureTime: "09:00", arrivalTime: "10:00", serviceUid: `synthetic-${index}-a`, trainNumber: "7A", serviceType: "新幹線", trainName: "テスト列車", serviceDestination: "B", transferWaitMinutes: 10 },
        { originStation: "B", destinationStation: "C", departureTime: "10:10", arrivalTime: "10:40", serviceUid: `synthetic-${index}-b`, trainNumber: "1M", serviceType: "特急", trainName: "テスト特急", serviceDestination: "C" }] })) });
  const candidates = publicJourneyPresentation.journeys.map((journey, index) => ({ variantId: `option-${index + 1}`, label: `経路${index + 1}: A→C`, dayOrder: [`day-${index}`],
    days: [{ dayRef: `day-${index}`, label: "2026-09-13", status: "planned", entries: [{ entryRef: `entry-${index}`, itemRef: "selection-item", role: "visit" }] }],
    items: [{ itemRef: "selection-item", sourceRef: journey.id, title: `経路${index + 1}: A→C`, kind: "transport", timing: "fixed", evidenceRefs: [], photoRefs: [] }],
    unknowns: [], comparisonAssessmentRefs: [], scenarioRefs: [] }));
  const publicPlanPresentation = parsePublicPlanPresentation({ version: "public-plan-presentation-v1", presentationId: "synthetic-plan",
    target: { tripId: "11111111-1111-4111-8111-111111111111", baseTripRevision: 0 }, candidateSetRef: { kind: "candidate-set-ref", candidateSetId: "synthetic-set", revision: 0, baseTripRevision: 0 },
    candidateOrder: candidates.map(candidate => candidate.variantId), candidates, evidenceRefs: [], photoRefs: [],
    coverage: { status: "complete", coveredDayRefs: candidates.flatMap(candidate => candidate.dayOrder), omittedDayRefs: [], omittedScopes: [] }, statements: [], comparisonAssessmentRefs: [], scenarioRefs: [],
    researchOutcome: { status: "complete", requestedMode: "standard", effectiveMode: "standard", budget: { modelCalls: 0, toolCalls: 0, wallClockMs: 0 }, coveredScopes: ["synthetic"], remainingScopes: [] } });
  return { text: "**経路1（推奨） **\n\n新幹線と特急を乗り継ぐ候補です。\n\n| 項目 | 内容 |\n| --- | --- |\n| 乗換 | 1回 |", publicJourneyPresentation, publicPlanPresentation };
}
