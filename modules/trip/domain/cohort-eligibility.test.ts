import { describe, expect, it } from "vitest";
import { assessCohortEligibility, type VerifiedCohortRule } from "./cohort-eligibility";
const now = "2026-09-27T10:00:00Z", subject = { provider: "synthetic-provider", product: "synthetic-product" };
const rule = (requirements: VerifiedCohortRule["requirements"]): VerifiedCohortRule => ({ ...subject, evidenceId: "verified-test-observation",
  validFrom: "2026-09-27T00:00:00Z", validUntil: "2026-09-28T00:00:00Z", requirements });

describe("provider/product specific cohort qualification", () => {
  it("never generalizes elementary school, university or a decade into a qualification", () => {
    for (const cohort of [{ count: 1, schoolStage: "elementary" as const }, { count: 1, schoolStage: "university" as const },
      { count: 1, ageDecade: "seventies" as const }])
      expect(assessCohortEligibility(cohort, undefined, subject, now)).toEqual({ status: "unconfirmed", missing: ["verified_rule"] });
  });
  it("matches different confirmed products independently rather than converting school stage to child fare", () => {
    const elementary = { count: 1, schoolStage: "elementary" as const };
    expect(assessCohortEligibility(elementary, rule([{ kind: "school_stage", allowed: ["elementary"] }]), subject, now).status).toBe("qualified");
    expect(assessCohortEligibility(elementary, rule([{ kind: "age_range", minimum: 0, maximum: 9 }]), subject, now))
      .toEqual({ status: "unconfirmed", missing: ["exactAge"] });
    expect(assessCohortEligibility({ ...elementary, exactAge: 11 }, rule([{ kind: "age_range", minimum: 0, maximum: 9 }]), subject, now).status).toBe("not_qualified");
  });
  it("does not request exact age when the known decade fully meets the verified age rule", () => {
    const senior = rule([{ kind: "age_range", minimum: 65, maximum: 120 }]);
    expect(assessCohortEligibility({ count: 2, ageDecade: "seventies" }, senior, subject, now).status).toBe("qualified");
    expect(assessCohortEligibility({ count: 2, ageDecade: "sixties" }, senior, subject, now)).toEqual({ status: "unconfirmed", missing: ["exactAge"] });
    expect(assessCohortEligibility({ count: 1, ageDecade: "twenties" }, senior, subject, now).status).toBe("not_qualified");
  });
  it("only asks for the missing attribute; university and twenties are not interchangeable", () => {
    const student = rule([{ kind: "school_stage", allowed: ["university"] }, { kind: "age_range", minimum: 18, maximum: 29 }]);
    expect(assessCohortEligibility({ count: 1, schoolStage: "university", ageDecade: "twenties" }, student, subject, now).status).toBe("qualified");
    expect(assessCohortEligibility({ count: 1, ageDecade: "twenties" }, student, subject, now)).toEqual({ status: "unconfirmed", missing: ["schoolStage"] });
    expect(assessCohortEligibility({ count: 1, schoolStage: "university", ageDecade: "twenties" }, rule([{ kind: "exact_age_required" }]), subject, now))
      .toEqual({ status: "unconfirmed", missing: ["exactAge"] });
  });
  it("does not apply stale, future, malformed, wrong-provider or wrong-product rules", () => {
    const base = rule([{ kind: "age_range", minimum: 65, maximum: 120 }]);
    for (const other of [{ ...base, provider: "other" }, { ...base, product: "other" }, { ...base, evidenceId: "" },
      { ...base, validUntil: now }, { ...base, validFrom: "2026-09-28T00:00:00Z" }, { ...base, requirements: [] },
      rule([{ kind: "age_range", minimum: 100, maximum: 65 }])])
      expect(assessCohortEligibility({ count: 1, ageDecade: "seventies" }, other, subject, now))
        .toEqual({ status: "unconfirmed", missing: ["verified_rule"] });
  });
});
