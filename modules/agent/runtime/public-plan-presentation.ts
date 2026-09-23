export const publicPlanPresentationVersion = "public-plan-presentation-v1" as const;

export interface PublicPlanPresentation {
  readonly version: typeof publicPlanPresentationVersion;
  readonly presentationId: string;
  readonly candidateSetRef: { readonly kind: "unavailable"; readonly reason: "legacy-projection" | "not-retained" | "expired" } |
    { readonly kind: "candidate-set-ref"; readonly candidateSetId: string; readonly revision: number; readonly baseTripRevision?: number };
  readonly target?: { readonly tripId: string; readonly baseTripRevision: number };
  readonly candidateOrder: readonly string[];
  readonly candidates: readonly PublicPlanCandidate[];
  readonly evidenceRefs: readonly string[];
  readonly photoRefs: readonly string[];
  readonly coverage: { readonly status: "complete" | "partial"; readonly coveredDayRefs: readonly string[]; readonly omittedDayRefs: readonly string[]; readonly omittedScopes: readonly string[] };
  readonly statements: readonly { readonly kind: "fact" | "proposal" | "assumption"; readonly ref: string; readonly evidenceRefs: readonly string[] }[];
  readonly comparisonAssessmentRefs: readonly string[];
  readonly scenarioRefs: readonly string[];
  readonly researchOutcome: { readonly status: "complete" | "partial" | "failed"; readonly requestedMode: "standard" | "detailed"; readonly effectiveMode: "standard" | "detailed";
    readonly budget: { readonly modelCalls: number; readonly toolCalls: number; readonly wallClockMs: number; readonly estimatedCostMinor?: number; readonly currency?: string };
    readonly coveredScopes: readonly string[]; readonly remainingScopes: readonly string[]; readonly continuation?: string };
}

export interface PublicPlanCandidate {
  readonly variantId: string;
  readonly label: string;
  readonly dayOrder: readonly string[];
  readonly days: readonly { readonly dayRef: string; readonly label: string; readonly entries: readonly { readonly entryRef: string; readonly itemRef: string; readonly role: "start" | "continue" | "end" | "visit" | "possible" }[]; readonly status: "planned" | "free" | "not-retrieved" }[];
  readonly items: readonly { readonly itemRef: string; readonly sourceRef: string; readonly title: string; readonly kind: "transport" | "stay" | "activity" | "free-time"; readonly timing: "fixed" | "window" | "day" | "unscheduled"; readonly evidenceRefs: readonly string[]; readonly photoRefs: readonly string[] }[];
  readonly unknowns: readonly string[];
  readonly workload?: { readonly status: "known" | "partial" | "unknown"; readonly travelMinutes?: number };
  readonly cost?: { readonly status: "known" | "partial" | "unknown"; readonly currency?: string; readonly amountMinor?: number };
  readonly comparisonAssessmentRefs: readonly string[];
  readonly scenarioRefs: readonly string[];
}

export function parsePublicPlanPresentation(value: unknown): PublicPlanPresentation {
  if (encodedBytes(value) > 180_000) throw new Error("Public plan presentation exceeds persistence budget");
  if (!record(value) || !only(value, ["version", "presentationId", "candidateSetRef", "target", "candidateOrder", "candidates", "evidenceRefs", "photoRefs", "coverage", "statements", "comparisonAssessmentRefs", "scenarioRefs", "researchOutcome"]) ||
      value.version !== publicPlanPresentationVersion || !reference(value.presentationId) || !validCandidateSetRef(value.candidateSetRef) ||
      !references(value.candidateOrder, 20) || !Array.isArray(value.candidates) || !value.candidates.length || value.candidates.length > 20 ||
      !references(value.evidenceRefs, 200) || !references(value.photoRefs, 100) || !references(value.comparisonAssessmentRefs, 100) || !references(value.scenarioRefs, 100)) throw new Error("Invalid public plan presentation");
  if (value.target !== undefined && (!record(value.target) || !only(value.target, ["tripId", "baseTripRevision"]) || !reference(value.target.tripId) || !integer(value.target.baseTripRevision))) throw new Error("Invalid presentation target");
  if (record(value.target) && record(value.candidateSetRef) && value.candidateSetRef.kind === "candidate-set-ref" &&
      value.candidateSetRef.baseTripRevision !== undefined && value.candidateSetRef.baseTripRevision !== value.target.baseTripRevision) throw new Error("Candidate set and presentation target revisions differ");
  const candidates = value.candidates.map(parseCandidate);
  const variantIds = candidates.map(({ variantId }) => variantId);
  if (!sameOrder(value.candidateOrder as string[], variantIds)) throw new Error("Candidate order does not match candidates");
  const coverage = parseCoverage(value.coverage);
  if (!record(value.researchOutcome) || !only(value.researchOutcome, ["status", "requestedMode", "effectiveMode", "budget", "coveredScopes", "remainingScopes", "continuation"]) ||
      !["complete", "partial", "failed"].includes(String(value.researchOutcome.status)) || !references(value.researchOutcome.coveredScopes, 100) ||
      !references(value.researchOutcome.remainingScopes, 100) || !["standard", "detailed"].includes(String(value.researchOutcome.requestedMode)) ||
      !["standard", "detailed"].includes(String(value.researchOutcome.effectiveMode)) || !validBudget(value.researchOutcome.budget) ||
      value.researchOutcome.continuation !== undefined && !reference(value.researchOutcome.continuation)) throw new Error("Invalid research outcome");
  if (value.researchOutcome.requestedMode === "standard" && value.researchOutcome.effectiveMode === "detailed") throw new Error("Research mode exceeds the request");
  if (!Array.isArray(value.statements) || value.statements.length > 300) throw new Error("Invalid presentation statements");
  const statements = value.statements.map((statement) => {
    if (!record(statement) || !only(statement, ["kind", "ref", "evidenceRefs"]) || !["fact", "proposal", "assumption"].includes(String(statement.kind)) ||
        !reference(statement.ref) || !references(statement.evidenceRefs, 20)) throw new Error("Invalid presentation statement");
    return { kind: statement.kind as "fact" | "proposal" | "assumption", ref: statement.ref as string, evidenceRefs: [...statement.evidenceRefs as string[]] };
  });
  const knownEvidence = new Set(value.evidenceRefs as string[]), knownPhotos = new Set(value.photoRefs as string[]);
  if (statements.some((statement) => statement.evidenceRefs.some((ref) => !knownEvidence.has(ref))) || candidates.some((candidate) => candidate.items.some((item) =>
    item.evidenceRefs.some((ref) => !knownEvidence.has(ref)) || item.photoRefs.some((ref) => !knownPhotos.has(ref))))) throw new Error("Presentation contains an unbound reference");
  if (coverage.status === "complete" && (coverage.omittedDayRefs.length || coverage.omittedScopes.length || value.researchOutcome.status !== "complete")) throw new Error("Complete presentation has omitted scope");
  const allDays = new Set(candidates.flatMap(({ days }) => days.map(({ dayRef }) => dayRef)));
  if ([...coverage.coveredDayRefs, ...coverage.omittedDayRefs].some((ref) => !allDays.has(ref)) || [...allDays].some((ref) => !coverage.coveredDayRefs.includes(ref) && !coverage.omittedDayRefs.includes(ref))) throw new Error("Coverage does not match candidate days");
  const comparisonRefs = new Set(value.comparisonAssessmentRefs as string[]), scenarioRefs = new Set(value.scenarioRefs as string[]);
  if (candidates.some((candidate) => candidate.comparisonAssessmentRefs.some((ref) => !comparisonRefs.has(ref)) || candidate.scenarioRefs.some((ref) => !scenarioRefs.has(ref)))) throw new Error("Candidate assessment reference is not published");
  return structuredClone({ ...value, candidates, coverage, statements }) as unknown as PublicPlanPresentation;
}

/** Runtime-owned measurements replace any model projection before the public boundary. */
export function withMeasuredResearchOutcome(value: PublicPlanPresentation, measurement: { modelCalls: number; toolCalls: number; wallClockMs: number; requestedMode: "standard" | "detailed"; effectiveMode: "standard" | "detailed" }): PublicPlanPresentation {
  if (![measurement.modelCalls, measurement.toolCalls, measurement.wallClockMs].every(integer)) throw new Error("Invalid research measurement");
  return parsePublicPlanPresentation({ ...value, researchOutcome: { ...value.researchOutcome,
    requestedMode: measurement.requestedMode, effectiveMode: measurement.effectiveMode,
    budget: { modelCalls: measurement.modelCalls, toolCalls: measurement.toolCalls, wallClockMs: measurement.wallClockMs } } });
}
export function bindPublicPlanTarget(value: PublicPlanPresentation, target: { tripId: string; baseTripRevision: number }): PublicPlanPresentation {
  const candidateSetRef = value.candidateSetRef.kind === "candidate-set-ref"
    ? { ...value.candidateSetRef, baseTripRevision: target.baseTripRevision }
    : value.candidateSetRef;
  return parsePublicPlanPresentation({ ...value, target, candidateSetRef });
}

function parseCandidate(value: unknown): PublicPlanCandidate {
  if (!record(value) || !only(value, ["variantId", "label", "dayOrder", "days", "items", "unknowns", "workload", "cost", "comparisonAssessmentRefs", "scenarioRefs"]) ||
      !reference(value.variantId) || typeof value.label !== "string" || !value.label.trim() || value.label.length > 200 || !references(value.dayOrder, 90) ||
      !Array.isArray(value.days) || value.days.length > 90 || !Array.isArray(value.items) || value.items.length > 500 || !references(value.unknowns, 100) ||
      !references(value.comparisonAssessmentRefs, 100) || !references(value.scenarioRefs, 100)) throw new Error("Invalid public plan candidate");
  const items = value.items.map((item) => {
    if (!record(item) || !only(item, ["itemRef", "sourceRef", "title", "kind", "timing", "evidenceRefs", "photoRefs"]) || !reference(item.itemRef) || !reference(item.sourceRef) ||
        typeof item.title !== "string" || !item.title.trim() || item.title.length > 300 || !["transport", "stay", "activity", "free-time"].includes(String(item.kind)) ||
        !["fixed", "window", "day", "unscheduled"].includes(String(item.timing)) || !references(item.evidenceRefs, 20) || !references(item.photoRefs, 20)) throw new Error("Invalid presentation item");
    return structuredClone(item) as PublicPlanCandidate["items"][number];
  });
  const itemRefs = new Set(items.map(({ itemRef }) => itemRef));
  if (itemRefs.size !== items.length) throw new Error("Duplicate presentation item");
  const days = value.days.map((day) => {
    if (!record(day) || !only(day, ["dayRef", "label", "entries", "status"]) || !reference(day.dayRef) || typeof day.label !== "string" ||
        !day.label.trim() || !Array.isArray(day.entries) || day.entries.length > 100 || !["planned", "free", "not-retrieved"].includes(String(day.status))) throw new Error("Invalid presentation day");
    const entries = day.entries.map((entry) => {
      if (!record(entry) || !only(entry, ["entryRef", "itemRef", "role"]) || !reference(entry.entryRef) || !reference(entry.itemRef) || !itemRefs.has(entry.itemRef as string) ||
          !["start", "continue", "end", "visit", "possible"].includes(String(entry.role))) throw new Error("Invalid presentation entry");
      return structuredClone(entry) as PublicPlanCandidate["days"][number]["entries"][number];
    });
    if (new Set(entries.map(({ entryRef }) => entryRef)).size !== entries.length || day.status !== "planned" && entries.length) throw new Error("Invalid presentation day entries");
    return structuredClone({ ...day, entries }) as unknown as PublicPlanCandidate["days"][number];
  });
  const displayedItems = new Set(days.flatMap(({ entries }) => entries.map(({ itemRef }) => itemRef)));
  if (!sameOrder(value.dayOrder as string[], days.map(({ dayRef }) => dayRef)) || displayedItems.size !== items.length || items.some(({ itemRef }) => !displayedItems.has(itemRef))) throw new Error("Presentation day order or item coverage is invalid");
  if (value.workload !== undefined && (!record(value.workload) || !only(value.workload, ["status", "travelMinutes"]) || !["known", "partial", "unknown"].includes(String(value.workload.status)) ||
      value.workload.travelMinutes !== undefined && !integer(value.workload.travelMinutes))) throw new Error("Invalid presentation workload");
  if (record(value.workload) && (value.workload.status === "known") !== (value.workload.travelMinutes !== undefined) || record(value.workload) && value.workload.status === "unknown" && value.workload.travelMinutes !== undefined) throw new Error("Inconsistent presentation workload");
  if (value.cost !== undefined && (!record(value.cost) || !only(value.cost, ["status", "currency", "amountMinor"]) || !["known", "partial", "unknown"].includes(String(value.cost.status)) ||
      value.cost.currency !== undefined && (typeof value.cost.currency !== "string" || !/^[A-Z]{3}$/u.test(value.cost.currency)) || value.cost.amountMinor !== undefined && !integer(value.cost.amountMinor))) throw new Error("Invalid presentation cost");
  if (record(value.cost) && value.cost.status === "known" && (value.cost.currency === undefined || value.cost.amountMinor === undefined) || record(value.cost) && value.cost.status === "unknown" && (value.cost.currency !== undefined || value.cost.amountMinor !== undefined)) throw new Error("Inconsistent presentation cost");
  return structuredClone({ ...value, days, items }) as unknown as PublicPlanCandidate;
}

function parseCoverage(value: unknown): PublicPlanPresentation["coverage"] {
  if (!record(value) || !only(value, ["status", "coveredDayRefs", "omittedDayRefs", "omittedScopes"]) || !["complete", "partial"].includes(String(value.status)) ||
      !references(value.coveredDayRefs, 1800) || !references(value.omittedDayRefs, 1800) || !references(value.omittedScopes, 100) ||
      (value.coveredDayRefs as string[]).some((ref) => (value.omittedDayRefs as string[]).includes(ref))) throw new Error("Invalid presentation coverage");
  return structuredClone(value) as PublicPlanPresentation["coverage"];
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function only(value: Record<string, unknown>, keys: readonly string[]): boolean { const allowed = new Set(keys); return Object.keys(value).every((key) => allowed.has(key)); }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function reference(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(value); }
function references(value: unknown, maximum: number): value is string[] { return Array.isArray(value) && value.length <= maximum && value.every(reference) && new Set(value).size === value.length; }
function sameOrder(expected: readonly string[], actual: readonly string[]): boolean { return expected.length === actual.length && expected.every((value, index) => value === actual[index]) && new Set(expected).size === expected.length; }
function validBudget(value: unknown): boolean { return record(value) && only(value, ["modelCalls", "toolCalls", "wallClockMs", "estimatedCostMinor", "currency"]) &&
  integer(value.modelCalls) && integer(value.toolCalls) && integer(value.wallClockMs) && (value.estimatedCostMinor === undefined || integer(value.estimatedCostMinor)) &&
  (value.currency === undefined || typeof value.currency === "string" && /^[A-Z]{3}$/u.test(value.currency)) && (value.estimatedCostMinor === undefined) === (value.currency === undefined); }
function validCandidateSetRef(value: unknown): boolean {
  if (!record(value) || value.kind === "unavailable" && (!only(value, ["kind", "reason"]) || !["legacy-projection", "not-retained", "expired"].includes(String(value.reason)))) return false;
  return value.kind === "unavailable" || value.kind === "candidate-set-ref" && only(value, ["kind", "candidateSetId", "revision", "baseTripRevision"]) && reference(value.candidateSetId) && integer(value.revision) &&
    (value.baseTripRevision === undefined || integer(value.baseTripRevision));
}
function encodedBytes(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.POSITIVE_INFINITY; } }
