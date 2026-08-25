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

export type EvidenceFactValue = string | number | boolean | null | string[];

export interface Evidence {
  id: string;
  category: EvidenceCategory;
  knowledgeKind: EvidenceKnowledgeKind;
  subject: string;
  facts: Record<string, EvidenceFactValue>;
  references: EvidenceReference[];
}

export type ClaimKind = "fact" | "inference" | "unknown";
export type ClaimGroundingStatus = "supported" | "unsupported" | "unknown";

export interface EvidenceClaim {
  id: string;
  statement: string;
  kind: ClaimKind;
  evidenceIds: string[];
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
      | "invalid_unknown_claim";
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
  const evidenceIds = new Set<string>();
  for (const item of evidence) {
    if (evidenceIds.has(item.id)) {
      errors.push({
        code: "duplicate_evidence_id",
        targetId: item.id,
        message: `Evidence ID「${item.id}」が重複しています`,
      });
    }
    evidenceIds.add(item.id);
    if (item.references.length === 0) {
      errors.push({
        code: "missing_evidence_reference",
        targetId: item.id,
        message: `Evidence「${item.id}」に情報源がありません`,
      });
    }
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
      groundingStatus = "supported";
    }
    return { ...claim, groundingStatus, missingEvidenceIds };
  });

  return { valid: errors.length === 0, errors, claims: assessedClaims };
}

export function evidenceReference(
  input: EvidenceReference,
): EvidenceReference {
  return { ...input };
}
