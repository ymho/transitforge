import type { AgentRuntimeFeature, AgentRuntimeStatus } from "../runtime-contract";

export const agentEvaluationDatasetSchemaVersion = "agent-eval-dataset-v1";
export const agentEvaluationObservationSchemaVersion = "agent-eval-observations-v1";

export const agentEvaluationCategories = [
  "ambiguous-request",
  "cancellation",
  "delay",
  "constraint",
  "information-gap",
  "multi-tool",
  "viewer-action",
] as const;

export type AgentEvaluationCategory = typeof agentEvaluationCategories[number];

export interface AgentEvaluationDataset {
  schemaVersion: typeof agentEvaluationDatasetSchemaVersion;
  cases: AgentEvaluationCase[];
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
  constraints: Record<string, string | number | boolean | string[]>;
  status: AgentRuntimeStatus;
  minimumGroundedClaimRate: number;
  maximumUnsupportedClaimRate: number;
  allowedViewerActions: string[];
  requiredViewerActions: string[];
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
  viewerActions: Array<{
    actionType: string;
    status: "applied" | "rejected";
  }>;
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
    viewerActionValidity: number;
  };
  failures: string[];
}

export interface AgentEvaluationReport {
  schemaVersion: "agent-eval-report-v2";
  datasetSchemaVersion: typeof agentEvaluationDatasetSchemaVersion;
  caseCount: number;
  passedCaseCount: number;
  metrics: {
    toolSelectionAccuracy: number;
    constraintSatisfaction: number;
    groundedClaimRate: number | null;
    unsupportedClaimRate: number | null;
    taskCompletion: number;
    viewerActionValidity: number;
  };
  categories: AgentEvaluationCategoryReport[];
  cases: AgentEvaluationCaseResult[];
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
