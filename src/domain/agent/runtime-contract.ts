import type { Evidence } from "./evidence-model";
import type { AgentTrace } from "./agent-trace";

export type AgentRuntimeFeature =
  | "journey_planning"
  | "train_guidance"
  | "operational_analysis"
  | "travel_planning";

export interface AgentRuntimeRequest {
  executionId: string;
  feature: AgentRuntimeFeature;
  userRequest: string;
}

export interface AgentProblemFrame {
  feature: AgentRuntimeFeature;
  normalizedIntent: string;
  objective: string;
  constraints: Record<string, unknown>;
  missingInformation: string[];
}

export interface AgentPlan {
  steps: string[];
}

export type AgentRuntimeStatus =
  | "completed"
  | "follow_up"
  | "limit_reached"
  | "failed";

export interface AgentRuntimeResult {
  status: AgentRuntimeStatus;
  response: string;
  evidence: Evidence[];
  trace: AgentTrace;
}
