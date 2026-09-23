import { describe, expect, it } from "vitest";
import { assessPlanRobustness, evaluateScenario, type DisruptionScenario, type ScenarioPlanView } from "./plan-robustness";
import type { TemporalConstraintNetwork } from "./temporal-constraint-network";

const network: TemporalConstraintNetwork = { version: 1, planRef: "plan@1", variables: ["origin", "train:start", "train:end", "visit:start", "visit:end"], missingFactRefs: [], evaluatedScope: ["train", "visit"], edges: [
  { constraintId: "train", from: "origin", to: "train:end", minimumMinutes: 100, maximumMinutes: 100, itemIds: ["train"], evidenceRefs: [], kind: "calendar-bound" },
  { constraintId: "visit-start", from: "origin", to: "visit:start", minimumMinutes: 130, maximumMinutes: 130, itemIds: ["visit"], evidenceRefs: [], kind: "calendar-bound" },
  { constraintId: "connect", from: "train:end", to: "visit:start", minimumMinutes: 10, itemIds: ["train", "visit"], evidenceRefs: ["route"], kind: "travel" },
] };
const view: ScenarioPlanView = { planRef: "plan@1", factsVersion: "facts-v1", temporalNetwork: network, protectedReservationItemIds: ["visit"], alternativeRefs: { visit: ["indoor-1"] } };
const delay = (minutes: 15 | 30): DisruptionScenario => ({ id: `delay-${minutes}`, version: 1, kind: "arrival-delay", basis: "hypothetical", basePlanRef: "plan@1", affectedRefs: ["train"], changes: { delayMinutes: minutes }, evidenceRefs: [], label: `+${minutes}` });

describe("plan robustness", () => {
  it("distinguishes +15 and +30 minute assumptions without mutating the base", () => {
    const before = structuredClone(view); const a = evaluateScenario(view, delay(15), { maximumRelaxations: 1000 }); const b = evaluateScenario(view, delay(30), { maximumRelaxations: 1000 });
    expect(a.status).toBe("feasible"); expect(b.status).toBe("infeasible"); expect(view).toEqual(before); expect(a.scenarioBasis).toBe("hypothetical");
  });
  it("reports lost, unchanged, research and reservation impact for closure", () => {
    const result = evaluateScenario(view, { id: "closed", version: 1, kind: "facility-closure", basis: "observed", basePlanRef: "plan@1", affectedRefs: ["visit"], changes: { unavailable: true }, evidenceRefs: ["official-closure"], label: "休業" }, { maximumRelaxations: 1000 });
    expect(result).toMatchObject({ status: "infeasible", lostItemIds: ["visit"], unchangedItemIds: ["train"], reservationChangeRequired: true });
    expect(result.recoveryOptions[0]).toMatchObject({ alternativeRef: "indoor-1", researchRequired: false });
  });
  it("never converts scenario pass count into probability and exposes budget omission", () => {
    const result = assessPlanRobustness(view, [delay(15), delay(30)], { maximumRelaxations: 1000, maximumScenarios: 1 });
    expect(result).toMatchObject({ overall: "unknown-scenarios", evaluatedScenarioCount: 1, omittedScenarioCount: 1, probability: undefined });
  });
});
