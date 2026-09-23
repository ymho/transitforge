import type { Money } from "./money";
import { checkTemporalConsistency, type TemporalCheckBudget, type TemporalConstraintEdge, type TemporalConstraintNetwork } from "./temporal-constraint-network";

export type ScenarioKind = "arrival-delay" | "rain" | "facility-closure" | "transport-unavailable" | "stay-duration-reduction";
export interface DisruptionScenario {
  readonly id: string;
  readonly version: 1;
  readonly kind: ScenarioKind;
  readonly basis: "hypothetical" | "observed";
  readonly basePlanRef: string;
  readonly affectedRefs: readonly string[];
  readonly changes: { readonly delayMinutes?: 15 | 30; readonly durationDeltaMinutes?: number; readonly unavailable?: true; readonly weather?: "rain" };
  readonly evidenceRefs: readonly string[];
  readonly label: string;
}
export interface ScenarioPlanView {
  readonly planRef: string;
  readonly factsVersion: string;
  readonly temporalNetwork: TemporalConstraintNetwork;
  readonly protectedReservationItemIds: readonly string[];
  readonly alternativeRefs: Readonly<Record<string, readonly string[]>>;
}
export interface RecoveryOption {
  readonly alternativeRef?: string;
  readonly researchRequired: boolean;
  readonly changedItemIds: readonly string[];
  readonly protectedReservationImpact: boolean;
  readonly additionalMinutes?: { readonly minimum: number; readonly maximum?: number };
  readonly additionalCost?: { readonly minimum: Money; readonly maximum?: Money };
}
export interface ScenarioAssessment {
  readonly scenarioRef: string;
  readonly scenarioBasis: "hypothetical" | "observed";
  readonly basePlanRef: string;
  readonly factsVersion: string;
  readonly status: "feasible" | "infeasible" | "unknown";
  readonly conflictRefs: readonly string[];
  readonly affectedItemIds: readonly string[];
  readonly unchangedItemIds: readonly string[];
  readonly lostItemIds: readonly string[];
  readonly recoveryOptions: readonly RecoveryOption[];
  readonly uncoveredFacts: readonly string[];
  readonly exhaustedBudget: boolean;
  readonly reservationChangeRequired: boolean;
}
export interface RobustnessAssessment {
  readonly planRef: string;
  readonly factsVersion: string;
  readonly overall: "all-tested-scenarios-feasible" | "normal-only" | "unknown-scenarios";
  readonly scenarios: readonly ScenarioAssessment[];
  readonly evaluatedScenarioCount: number;
  readonly omittedScenarioCount: number;
  /** Deliberately not a real-world probability. */
  readonly scenarioPassCount: number;
  readonly probability: undefined;
}

/** Returns a detached evaluation view; Trip, Reservation and verified facts remain untouched. */
export function applyScenarioOverlay(view: ScenarioPlanView, scenario: DisruptionScenario): ScenarioPlanView & { lostItemIds: readonly string[] } {
  validateScenario(view, scenario);
  const affected = new Set(scenario.affectedRefs);
  let edges = view.temporalNetwork.edges.map((edge): TemporalConstraintEdge => structuredClone(edge));
  const lostItemIds: string[] = [];
  if (scenario.kind === "arrival-delay") {
    const delay = scenario.changes.delayMinutes;
    if (!delay) throw new Error("Delay amount required");
    edges = edges.map((edge) => edge.kind === "calendar-bound" && edge.itemIds.some((id) => affected.has(id))
      ? { ...edge, ...(edge.minimumMinutes === undefined ? {} : { minimumMinutes: edge.minimumMinutes + delay }), ...(edge.maximumMinutes === undefined ? {} : { maximumMinutes: edge.maximumMinutes + delay }) } : edge);
  } else if (scenario.kind === "stay-duration-reduction") {
    const delta = scenario.changes.durationDeltaMinutes;
    if (!Number.isSafeInteger(delta) || delta! >= 0) throw new Error("Negative duration delta required");
    edges = edges.map((edge) => edge.kind === "duration" && edge.itemIds.some((id) => affected.has(id)) ? { ...edge,
      ...(edge.minimumMinutes === undefined ? {} : { minimumMinutes: Math.max(0, edge.minimumMinutes + delta!) }),
      ...(edge.maximumMinutes === undefined ? {} : { maximumMinutes: Math.max(0, edge.maximumMinutes + delta!) }) } : edge);
  } else if (scenario.kind === "facility-closure" || scenario.kind === "transport-unavailable") {
    lostItemIds.push(...affected);
    edges = [...edges, ...[...affected].map((id): TemporalConstraintEdge => ({ constraintId: `scenario:${scenario.id}:${id}`, from: `${id}:start`, to: `${id}:start`, minimumMinutes: 1,
      itemIds: [id], evidenceRefs: scenario.evidenceRefs, kind: scenario.kind === "transport-unavailable" ? "travel" : "opening-window" }))];
  }
  return { ...structuredClone(view), temporalNetwork: { ...structuredClone(view.temporalNetwork), edges }, lostItemIds };
}

export function evaluateScenario(view: ScenarioPlanView, scenario: DisruptionScenario, budget: TemporalCheckBudget): ScenarioAssessment {
  const overlay = applyScenarioOverlay(view, scenario);
  const temporal = checkTemporalConsistency(overlay.temporalNetwork, budget);
  const affected = [...scenario.affectedRefs].sort();
  const allItems = new Set(view.temporalNetwork.evaluatedScope);
  const recoveryOptions = affected.flatMap((itemId): RecoveryOption[] => {
    const alternatives = view.alternativeRefs[itemId] ?? [];
    return alternatives.length ? alternatives.map((alternativeRef) => ({ alternativeRef, researchRequired: false, changedItemIds: [itemId],
      protectedReservationImpact: view.protectedReservationItemIds.includes(itemId) })) : [{ researchRequired: true, changedItemIds: [itemId], protectedReservationImpact: view.protectedReservationItemIds.includes(itemId) }];
  });
  return { scenarioRef: scenario.id, scenarioBasis: scenario.basis, basePlanRef: view.planRef, factsVersion: view.factsVersion,
    status: scenario.kind === "rain" && !affected.every((id) => (view.alternativeRefs[id]?.length ?? 0) > 0) ? "unknown" : temporal.status,
    conflictRefs: temporal.conflictEdges.map(({ constraintId }) => constraintId), affectedItemIds: affected,
    unchangedItemIds: [...allItems].filter((id) => !affected.includes(id)).sort(), lostItemIds: overlay.lostItemIds,
    recoveryOptions, uncoveredFacts: [...new Set([...temporal.missingFactRefs, ...recoveryOptions.filter(({ researchRequired }) => researchRequired).map(({ changedItemIds }) => `alternative:${changedItemIds[0]}`)])],
    exhaustedBudget: temporal.exhaustedBudget, reservationChangeRequired: affected.some((id) => view.protectedReservationItemIds.includes(id)) };
}

export function assessPlanRobustness(view: ScenarioPlanView, scenarios: readonly DisruptionScenario[], budget: TemporalCheckBudget & { maximumScenarios: number }): RobustnessAssessment {
  if (!Number.isSafeInteger(budget.maximumScenarios) || budget.maximumScenarios <= 0) throw new Error("Invalid scenario budget");
  const selected = [...scenarios].sort((a, b) => a.id.localeCompare(b.id)).slice(0, budget.maximumScenarios);
  const assessments = selected.map((scenario) => evaluateScenario(view, scenario, budget));
  return { planRef: view.planRef, factsVersion: view.factsVersion,
    overall: assessments.some(({ status }) => status === "unknown") || selected.length < scenarios.length ? "unknown-scenarios" : assessments.every(({ status }) => status === "feasible") ? "all-tested-scenarios-feasible" : "normal-only",
    scenarios: assessments, evaluatedScenarioCount: selected.length, omittedScenarioCount: Math.max(0, scenarios.length - selected.length),
    scenarioPassCount: assessments.filter(({ status }) => status === "feasible").length, probability: undefined };
}

function validateScenario(view: ScenarioPlanView, scenario: DisruptionScenario): void {
  if (scenario.version !== 1 || scenario.basePlanRef !== view.planRef || !scenario.id || !scenario.label || !scenario.affectedRefs.length ||
      new Set(scenario.affectedRefs).size !== scenario.affectedRefs.length || scenario.affectedRefs.some((id) => !view.temporalNetwork.evaluatedScope.includes(id)) ||
      scenario.basis === "observed" && !scenario.evidenceRefs.length) throw new Error("Invalid or stale scenario");
}
