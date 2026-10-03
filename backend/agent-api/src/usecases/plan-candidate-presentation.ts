import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";
import { createTrip, type ItineraryItem } from "@raiquora/trip/trip";
import type { ItineraryCandidateSet } from "@raiquora/trip/itinerary-candidates";
import { parsePublicPlanPresentation, type PublicPlanCandidate, type PublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";

/** Deterministic read model of the canonical proposal. This never adopts a Trip
 * or manufactures selected places, transport, evidence or research measurements. */
export function projectCandidatePresentation(set: ItineraryCandidateSet, unknowns: readonly string[]): PublicPlanPresentation {
  const candidates: PublicPlanCandidate[] = set.variants.map(variant => {
    const byId = new Map(variant.items.map(item => [item.componentId, item]));
    if (new Set(variant.timeline.itemOrder).size !== variant.items.length) throw new Error("Duplicate item order");
    const ordered = variant.timeline.itemOrder.map(id => byId.get(id)!);
    if (ordered.some(item => item.evidenceRefs.length || item.sourceCandidateRef || item.sourcePlaceRef) ||
        variant.assessmentRefs.length || variant.discoveryRefs?.length) throw new Error("Unverified candidate references");
    const items: ItineraryItem[] = ordered.map(item => ({ id: item.componentId, title: item.title, schedule: item.schedule,
      ...(item.logicalDayId ? { logicalDayId: item.logicalDayId } : {}),
      ...(item.kind === "transport" ? { type: "transport" as const, detail: { status: "unresolved" as const } } :
        item.kind === "stay" ? { type: "stay" as const, selection: { status: "unselected" as const } } :
          { type: "activity" as const, category: "other" as const }) }));
    // Reuse the Domain's calendar, cross-day and unscheduled projection rules.
    // The ephemeral value exists only for projection and is never persisted.
    const timeline = variant.timeline.dayOrder.length ? { version: 1 as const,
      logicalDays: variant.timeline.dayOrder.map((id, index) => ({ id, label: `${index + 1}日目` })), calendarBindings: [] } : undefined;
    const daily = projectDailyItinerary(createTrip(set.id, variant.label, set.issuedAt, items,
      undefined, "inspiration", undefined, timeline), { limit: 90 });
    if (!daily.coverage.complete) throw new Error("Candidate display exceeds day limit");
    const days: PublicPlanCandidate["days"][number][] = daily.days.map(day => ({ dayRef: day.dayKey, label: day.label,
      // An empty day is unplanned, not a user-confirmed free day.
      status: day.entries.length ? "planned" : "not-retrieved",
      entries: day.entries.map(entry => ({ entryRef: entry.entryKey, itemRef: entry.sourceItemId,
        role: entry.role === "possible-window" ? "possible" : entry.role })) }));
    if (daily.unscheduled.length) days.push({ dayRef: "unscheduled", label: "日程未定", status: "planned",
      entries: daily.unscheduled.map(entry => ({ entryRef: entry.entryKey, itemRef: entry.sourceItemId, role: "possible" })) });
    return { variantId: variant.id, label: variant.label, dayOrder: days.map(day => day.dayRef), days,
      items: ordered.map(item => ({ itemRef: item.componentId, sourceRef: item.componentId, title: item.title, kind: item.kind,
        timing: item.schedule.type === "relative" ? "day" : item.schedule.type, evidenceRefs: [], photoRefs: [] })),
      unknowns: [...unknowns], cost: { status: "unknown" }, workload: { status: "unknown" },
      comparisonAssessmentRefs: [], scenarioRefs: [] };
  });
  const covered = new Set(candidates.flatMap(candidate => candidate.days.filter(day => day.status === "planned").map(day => day.dayRef)));
  const omitted = [...new Set(candidates.flatMap(candidate => candidate.dayOrder))].filter(day => !covered.has(day));
  const complete = set.coverage.complete && !set.coverage.omittedScopes.length && !omitted.length && !unknowns.length;
  return parsePublicPlanPresentation({ version: "public-plan-presentation-v1", presentationId: set.id,
    candidateSetRef: { kind: "candidate-set-ref", candidateSetId: set.id, revision: set.revision },
    candidateOrder: candidates.map(candidate => candidate.variantId), candidates, evidenceRefs: [], photoRefs: [],
    coverage: { status: complete ? "complete" : "partial", coveredDayRefs: [...covered], omittedDayRefs: omitted,
      omittedScopes: [...set.coverage.omittedScopes] },
    statements: [...new Set(candidates.flatMap(candidate => candidate.items.map(item => item.sourceRef)))].map(ref =>
      ({ kind: "proposal", ref, evidenceRefs: [] })), comparisonAssessmentRefs: [], scenarioRefs: [],
    researchOutcome: { status: complete ? "complete" : "partial", requestedMode: "standard", effectiveMode: "standard",
      budget: { modelCalls: 0, toolCalls: 0, wallClockMs: 0 }, coveredScopes: [...set.coverage.coveredScopes], remainingScopes: [...set.coverage.omittedScopes] } });
}
