import type { TravelApplicabilityFact } from "./travel-applicability";
import type { IntentTarget } from "@raiquora/trip/conversation-intent";

export type EvidenceCategory =
  | "timetable"
  | "train"
  | "station"
  | "journey"
  | "delay"
  | "congestion"
  | "external";

export type EvidenceKnowledgeKind =
  | "deterministic_fact"
  | "derived_value"
  | "model_interpretation"
  | "unverified_information";

export type EvidenceSourceType =
  | "timetable-index"
  | "timetable-graph"
  | "station-line-catalog"
  | "realtime-delay"
  | "estimated-delay"
  | "operating-day-summary"
  | "journey-comparison"
  | "external-source"
  | "trip-state"
  | "trip-impact"
  | "reservation-state"
  | "session-state"
  | "model";

export type EvidenceFreshness =
  | "current"
  | "scheduled"
  | "historical"
  | "unknown";

export interface EvidenceReference {
  sourceType: EvidenceSourceType;
  sourceRef: string;
  retrievedAt: string | null;
  freshness: EvidenceFreshness;
  summary: string;
}

export interface EvidenceTimeRange {
  from?: string;
  until?: string;
}

export interface EvidenceObservation {
  /** Unique observation, never a facility/product identity. */
  observationId: string;
  /** Stable provider-qualified identity used only to compare the same subject. */
  subjectKey: string;
  /** Normalized query/date/party/segment scope; contains no raw personal data. */
  scopeKey: string;
  predicate: string;
  validDuring?: EvidenceTimeRange;
  observedAt?: string;
  retrievedAt: string;
  sourceVersion?: string;
  applicability: "applicable" | "not_applicable" | "unknown";
  state?: "current" | "stale" | "withdrawn" | "conflicting";
  derivedFrom?: string[];
  retention: "reference_only" | "bounded_excerpt" | "prohibited";
}

export type EvidenceFactValue = string | number | boolean | null | string[];

/** Agent capability scope, not a Domain state or permission to suppress Tools. */
export type EvidenceCoverage = "trip.itinerary" | "trip.next-item" | "rail.schedule" |
  "rail.impact" | "rail.connection" | "weather.impact" | "hazard.impact" |
  "reservation.state" | "location.permission";

export interface Evidence {
  id: string;
  category: EvidenceCategory;
  knowledgeKind: EvidenceKnowledgeKind;
  subject: string;
  facts: Record<string, EvidenceFactValue>;
  references: EvidenceReference[];
  coverage?: EvidenceCoverage[];
  observation?: EvidenceObservation;
  applicabilityFacts?: TravelApplicabilityFact[];
  /** Application-authored semantic inputs used to obtain this observation.
   * The model cannot declare or relax this dependency. */
  intentDependency?: {
    intentRevision: number;
    fingerprint: string;
    targets: IntentTarget[];
  };
}

export type ClaimKind = "fact" | "inference" | "unknown";
export type ClaimGroundingStatus = "supported" | "unsupported" | "unknown";

export interface EvidenceClaim {
  id: string;
  statement: string;
  kind: ClaimKind;
  evidenceIds: string[];
  bindings?: ClaimBinding[];
}

export interface ClaimBinding {
  evidenceId: string;
  fieldPath: string;
  subjectRef: string;
  applicabilityScope?: string;
  transform: "identity" | "bounded_quote" | "deterministic_calculation" | "recommendation";
}

export interface AssessedEvidenceClaim extends EvidenceClaim {
  groundingStatus: ClaimGroundingStatus;
  missingEvidenceIds: string[];
}

export interface EvidenceValidationResult {
  valid: boolean;
  errors: Array<{
    code:
      | "duplicate_evidence_id"
      | "duplicate_claim_id"
      | "missing_evidence_reference"
      | "unsupported_fact_claim"
      | "invalid_unknown_claim"
      | "invalid_claim_binding"
      | "evidence_collision";
    targetId: string;
    message: string;
  }>;
  claims: AssessedEvidenceClaim[];
}

export function validateEvidenceAndClaims(
  evidence: Evidence[],
  claims: EvidenceClaim[],
): EvidenceValidationResult {
  const errors: EvidenceValidationResult["errors"] = [];
  const referenceValidation = validateEvidenceReferences(evidence);
  errors.push(...referenceValidation.errors);
  const evidenceIds = new Set<string>();
  for (const item of evidence) {
    evidenceIds.add(item.id);
  }

  const claimIds = new Set<string>();
  const assessedClaims = claims.map((claim): AssessedEvidenceClaim => {
    if (claimIds.has(claim.id)) {
      errors.push({
        code: "duplicate_claim_id",
        targetId: claim.id,
        message: `Claim ID「${claim.id}」が重複しています`,
      });
    }
    claimIds.add(claim.id);
    const missingEvidenceIds = claim.evidenceIds.filter((id) => !evidenceIds.has(id));
    let groundingStatus: ClaimGroundingStatus;
    if (claim.kind === "unknown") {
      groundingStatus = "unknown";
      if (claim.evidenceIds.length > 0) {
        errors.push({
          code: "invalid_unknown_claim",
          targetId: claim.id,
          message: "unknown ClaimはEvidenceを事実根拠として参照できません",
        });
      }
    } else if (claim.evidenceIds.length === 0 || missingEvidenceIds.length > 0) {
      groundingStatus = "unsupported";
      if (claim.kind === "fact") {
        errors.push({
          code: "unsupported_fact_claim",
          targetId: claim.id,
          message: `事実Claim「${claim.id}」を支持するEvidenceがありません`,
        });
      }
    } else {
      const binding = validateClaimBinding(claim, evidence);
      groundingStatus = binding.valid ? "supported" : "unsupported";
      if (!binding.valid && claim.kind === "fact") errors.push({
        code: "invalid_claim_binding",
        targetId: claim.id,
        message: binding.reason ?? `事実Claim「${claim.id}」の意味をEvidenceへ結び付けられません`,
      });
    }
    return { ...claim, groundingStatus, missingEvidenceIds };
  });

  return { valid: errors.length === 0, errors, claims: assessedClaims };
}

export function validateEvidenceReferences(evidence: readonly Evidence[]): Pick<EvidenceValidationResult, "valid" | "errors"> {
  const errors: EvidenceValidationResult["errors"] = [];
  const ids = new Map<string, Evidence>();
  for (const item of evidence) {
    const existing = ids.get(item.id);
    if (existing) errors.push({
      code: canonicalEvidence(existing) === canonicalEvidence(item) ? "duplicate_evidence_id" : "evidence_collision",
      targetId: item.id,
      message: canonicalEvidence(existing) === canonicalEvidence(item)
        ? `Evidence ID「${item.id}」が重複しています`
        : `Evidence ID「${item.id}」が異なる観測へ衝突しています`,
    });
    else ids.set(item.id, item);
    if (item.references.length === 0) errors.push({
      code: "missing_evidence_reference", targetId: item.id,
      message: `Evidence「${item.id}」に情報源がありません`,
    });
  }
  return { valid: errors.length === 0, errors };
}

export function validateClaimBinding(
  claim: EvidenceClaim,
  evidence: readonly Evidence[],
): { valid: boolean; reason?: string } {
  if (claim.kind === "unknown") return { valid: claim.evidenceIds.length === 0 };
  if (!claim.bindings?.length) {
    return { valid: false, reason: "Evidence参照は存在しますが、Claimの対象・field・適用範囲が結び付いていません" };
  }
  for (const binding of claim.bindings) {
    const item = evidence.find((candidate) => candidate.id === binding.evidenceId);
    if (!item || !claim.evidenceIds.includes(binding.evidenceId)) return { valid: false, reason: "Claim bindingが参照Evidenceと一致しません" };
    const subjectRef = item.observation?.subjectKey ?? item.subject;
    if (subjectRef !== binding.subjectRef) return { valid: false, reason: "Claimの対象がEvidenceの対象と一致しません" };
    if (item.observation?.applicability === "not_applicable" || item.observation?.state === "stale" ||
        item.observation?.state === "withdrawn" || item.observation?.state === "conflicting") {
      return { valid: false, reason: "対象範囲外、失効、撤回または競合中のEvidenceです" };
    }
    if (!boundField(item, binding.fieldPath)) return { valid: false, reason: `Evidenceにbinding先「${binding.fieldPath}」がありません` };
    if (binding.applicabilityScope && item.observation?.scopeKey !== binding.applicabilityScope) {
      return { valid: false, reason: "Claimの適用範囲が観測範囲と一致しません" };
    }
  }
  return { valid: true };
}

export interface EvidenceMergeResult {
  evidence: Evidence[];
  added: Evidence[];
  collisions: Array<{ id: string; existing: Evidence; incoming: Evidence }>;
  conflictingObservationIds: string[];
  omittedCount: number;
}

export function mergeEvidenceObservations(
  existing: readonly Evidence[], incoming: readonly Evidence[], maximum = Number.POSITIVE_INFINITY,
): EvidenceMergeResult {
  const evidence = existing.map(copyEvidence);
  const added: Evidence[] = [], collisions: EvidenceMergeResult["collisions"] = [];
  const conflicts = new Set<string>();
  let omittedCount = 0;
  for (const item of incoming) {
    const copied = copyEvidence(item);
    const sameId = evidence.find((candidate) => candidate.id === copied.id);
    if (sameId) {
      if (canonicalEvidence(sameId) !== canonicalEvidence(copied)) collisions.push({ id: copied.id, existing: sameId, incoming: copied });
      continue;
    }
    if (evidence.length >= maximum) { omittedCount += 1; continue; }
    const contradictory = evidence.filter((candidate) => observationsConflict(candidate, copied));
    if (contradictory.length) {
      copied.observation = copied.observation ? { ...copied.observation, state: "conflicting" } : undefined;
      for (const candidate of contradictory) {
        candidate.observation = candidate.observation ? { ...candidate.observation, state: "conflicting" } : undefined;
        conflicts.add(candidate.observation?.observationId ?? candidate.id);
      }
      conflicts.add(copied.observation?.observationId ?? copied.id);
    }
    evidence.push(copied); added.push(copied);
  }
  return { evidence, added, collisions, conflictingObservationIds: [...conflicts], omittedCount };
}

export interface DerivedAssessmentLineage {
  assessmentId: string;
  sourceObservationIds: string[];
  inputRevision: string;
  inputHash: string;
  calculationVersion: string;
  currentness: "current" | "needs_recheck";
}

export function assessDerivedCurrentness(
  assessment: DerivedAssessmentLineage, observations: readonly Evidence[],
): DerivedAssessmentLineage {
  const byObservation = new Map(observations.flatMap((item) => item.observation ? [[item.observation.observationId, item]] as const : []));
  const invalid = assessment.sourceObservationIds.some((id) => {
    const item = byObservation.get(id);
    return !item || ["stale", "withdrawn", "conflicting"].includes(item.observation?.state ?? "current");
  });
  return { ...assessment, currentness: invalid ? "needs_recheck" : "current" };
}

function observationsConflict(left: Evidence, right: Evidence): boolean {
  const a = left.observation, b = right.observation;
  return Boolean(a && b && a.subjectKey === b.subjectKey && a.scopeKey === b.scopeKey && a.predicate === b.predicate &&
    canonicalEvidence({ facts: left.facts, applicabilityFacts: left.applicabilityFacts }) !==
      canonicalEvidence({ facts: right.facts, applicabilityFacts: right.applicabilityFacts }));
}

function boundField(item: Evidence, path: string): boolean {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return false;
  let current: unknown = path.startsWith("observation.") ? item.observation : item.facts;
  if (path.startsWith("observation.")) parts.shift();
  else if (path.startsWith("facts.")) parts.shift();
  for (const part of parts) {
    if (typeof current !== "object" || current === null || Array.isArray(current) || !(part in current)) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return current !== undefined;
}

function canonicalEvidence(value: unknown): string { return JSON.stringify(sortObject(value)); }
function copyEvidence(value: Evidence): Evidence {
  return { ...value, facts: { ...value.facts }, references: value.references.map((reference) => ({ ...reference })),
    ...(value.coverage ? { coverage: [...value.coverage] } : {}),
    ...(value.observation ? { observation: { ...value.observation,
      ...(value.observation.validDuring ? { validDuring: { ...value.observation.validDuring } } : {}),
      ...(value.observation.derivedFrom ? { derivedFrom: [...value.observation.derivedFrom] } : {}) } } : {}),
    ...(value.applicabilityFacts ? { applicabilityFacts: value.applicabilityFacts.map((fact) => structuredClone(fact)) } : {}) };
}
function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, sortObject(item)]));
}

export function evidenceReference(
  input: EvidenceReference,
): EvidenceReference {
  return { ...input };
}
