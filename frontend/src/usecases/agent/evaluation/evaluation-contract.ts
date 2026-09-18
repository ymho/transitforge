import type { AgentRuntimeFeature, AgentRuntimeStatus } from "@raiquora/agent/runtime-contract";
import type { TravelProgressReport, TravelProgressScenario } from "./travel-progress-evaluation";

export const agentEvaluationDatasetSchemaVersion = "agent-eval-dataset-v3";
export const agentEvaluationObservationSchemaVersion = "agent-eval-observations-v2";

export const agentEvaluationCategories = [
  "ambiguous-request",
  "cancellation",
  "delay",
  "constraint",
  "information-gap",
  "multi-tool",
] as const;

export type AgentEvaluationCategory = typeof agentEvaluationCategories[number];

export interface AgentEvaluationDataset {
  schemaVersion: typeof agentEvaluationDatasetSchemaVersion;
  cases: AgentEvaluationCase[];
  travelProgressScenarios?: TravelProgressScenario[];
}

export interface AgentEvaluationCase {
  id: string;
  name: string;
  feature: AgentRuntimeFeature;
  userRequest: string;
  journeyScenarioId?: string;
  tags: string[];
  expected: AgentEvaluationExpectation;
}

export interface AgentEvaluationExpectation {
  toolSequence: string[];
  /** Optional, explicitly approved complete sequences; never a wildcard or prefix. */
  alternativeToolSequences?: string[][];
  constraints: Record<string, string | number | boolean | string[]>;
  status: AgentRuntimeStatus;
  minimumGroundedClaimRate: number;
  maximumUnsupportedClaimRate: number;
  decision?: {
    requiredHardConstraintKeys: string[];
    forbiddenUnresolvedFacts: string[];
  };
}

export interface AgentEvaluationObservationSet {
  schemaVersion: typeof agentEvaluationObservationSchemaVersion;
  observations: AgentEvaluationObservation[];
}

export interface AgentEvaluationObservation {
  caseId: string;
  toolSequence: string[];
  normalizedConstraints: Record<string, unknown>;
  status: AgentRuntimeStatus;
  claimStatuses: Array<"supported" | "unsupported" | "unknown">;
  decisionHardConstraintKeys?: string[];
  decisionUnresolvedFacts?: string[];
}

export interface AgentEvaluationCaseResult {
  id: string;
  name: string;
  passed: boolean;
  metrics: {
    toolSelectionAccuracy: number;
    constraintSatisfaction: number;
    groundedClaimRate: number | null;
    unsupportedClaimRate: number | null;
    taskCompletion: number;
  };
  failures: string[];
}

export interface AgentEvaluationReport {
  schemaVersion: "agent-eval-report-v4";
  datasetSchemaVersion: AgentEvaluationDataset["schemaVersion"];
  caseCount: number;
  passedCaseCount: number;
  metrics: {
    toolSelectionAccuracy: number;
    constraintSatisfaction: number;
    groundedClaimRate: number | null;
    unsupportedClaimRate: number | null;
    taskCompletion: number;
  };
  categories: AgentEvaluationCategoryReport[];
  cases: AgentEvaluationCaseResult[];
  /** Additive multi-response evaluation; never replaces the five Tool/grounding/completion metrics. */
  travelProgress?: TravelProgressReport[];
}

export interface AgentEvaluationCategoryReport {
  category: AgentEvaluationCategory;
  caseCount: number;
  passedCaseCount: number;
  metrics: AgentEvaluationReport["metrics"];
}

export type AgentEvaluationProfile = "smoke" | "full";
export type AgentEvaluationMetricName = keyof AgentEvaluationReport["metrics"];

export interface AgentEvaluationThreshold {
  operator: "minimum" | "maximum";
  value: number;
}

export type AgentEvaluationThresholds = Record<
  AgentEvaluationMetricName,
  AgentEvaluationThreshold
>;

export interface AgentEvaluationRunReport extends AgentEvaluationReport {
  profile: AgentEvaluationProfile;
  selectedTag?: string;
  selectedCaseId?: string;
  thresholds: AgentEvaluationThresholds;
  passed: boolean;
  thresholdFailures: string[];
}
