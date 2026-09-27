import { ageInterval, schoolStages, parsePartyCohorts, type CohortAttributes, type SchoolStage } from "./party-cohorts";

/** Only an Application-verified provider/product rule may enter this boundary.
 * The agent's guessed policy or cohort attributes never construct a verified rule. */
export interface VerifiedCohortRule {
  provider: string;
  product: string;
  evidenceId: string;
  validFrom: string;
  validUntil: string;
  requirements: readonly (
    | { kind: "age_range"; minimum: number; maximum: number }
    | { kind: "school_stage"; allowed: readonly SchoolStage[] }
    | { kind: "exact_age_required" }
  )[];
}
export type CohortEligibility = { status: "qualified" | "not_qualified"; evidenceId: string } |
  { status: "unconfirmed"; missing: ("exactAge" | "schoolStage" | "verified_rule")[] };

export function assessCohortEligibility(cohort: CohortAttributes, rule: VerifiedCohortRule | undefined,
  product: { provider: string; product: string }, now: string): CohortEligibility {
  parsePartyCohorts([{ ...cohort, membership: "baseline", scope: { kind: "whole_trip" } }]);
  const time = Date.parse(now), from = Date.parse(rule?.validFrom ?? ""), until = Date.parse(rule?.validUntil ?? "");
  if (!rule || !rule.evidenceId.trim() || rule.provider !== product.provider || rule.product !== product.product ||
      !Number.isFinite(time) || !Number.isFinite(from) || !Number.isFinite(until) || time < from || time >= until ||
      !rule.requirements.length) return { status: "unconfirmed", missing: ["verified_rule"] };
  const missing = new Set<"exactAge" | "schoolStage">();
  for (const condition of rule.requirements) {
    if (condition.kind === "exact_age_required") { if (cohort.exactAge === undefined) missing.add("exactAge"); continue; }
    if (condition.kind === "school_stage") {
      if (!condition.allowed.length || condition.allowed.some(stage => !schoolStages.includes(stage))) return { status: "unconfirmed", missing: ["verified_rule"] };
      if (cohort.schoolStage === undefined) missing.add("schoolStage");
      else if (!condition.allowed.includes(cohort.schoolStage)) return { status: "not_qualified", evidenceId: rule.evidenceId };
      continue;
    }
    if (condition.kind !== "age_range" || !Number.isSafeInteger(condition.minimum) || !Number.isSafeInteger(condition.maximum) ||
        condition.minimum < 0 || condition.maximum > 120 || condition.minimum > condition.maximum)
      return { status: "unconfirmed", missing: ["verified_rule"] };
    const interval = cohort.exactAge !== undefined ? [cohort.exactAge, cohort.exactAge] as const
      : cohort.ageDecade !== undefined ? ageInterval(cohort.ageDecade) : undefined;
    if (!interval) { missing.add("exactAge"); continue; }
    if (interval[1] < condition.minimum || interval[0] > condition.maximum) return { status: "not_qualified", evidenceId: rule.evidenceId };
    if (interval[0] < condition.minimum || interval[1] > condition.maximum) missing.add("exactAge");
  }
  return missing.size ? { status: "unconfirmed", missing: [...missing] } : { status: "qualified", evidenceId: rule.evidenceId };
}
