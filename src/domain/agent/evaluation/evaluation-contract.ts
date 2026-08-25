import type { AgentRuntimeFeature, AgentRuntimeStatus } from "../runtime-contract";

export const agentEvaluationDatasetSchemaVersion = "agent-eval-dataset-v1";
export const agentEvaluationObservationSchemaVersion = "agent-eval-observations-v1";

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
  schemaVersion: "agent-eval-report-v1";
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
  cases: AgentEvaluationCaseResult[];
}
