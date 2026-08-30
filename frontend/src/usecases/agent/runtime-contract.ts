import type { AssessedEvidenceClaim, Evidence } from "./evidence-model";
import type { AgentTrace } from "./agent-trace";
import type {
  AgentDecisionContext,
  AgentRuntimeContextInput,
} from "./agent-decision-context";

export type AgentRuntimeFeature =
  | "concierge"
  | "journey_planning"
  | "train_guidance"
  | "operational_analysis"
  | "travel_planning";

export interface AgentRuntimeRequest {
  executionId: string;
  feature: AgentRuntimeFeature;
  userRequest: string;
  context?: AgentRuntimeContextInput;
}

export interface AgentProblemFrame {
  feature: AgentRuntimeFeature;
  normalizedIntent: string;
  objective: string;
  constraints: Record<string, unknown>;
  missingInformation: string[];
  decisionContext: AgentDecisionContext;
}

export interface AgentPlan {
  steps: string[];
}

export type AgentRuntimeStatus =
  | "completed"
  | "follow_up"
  | "limit_reached"
  | "failed";

export interface AgentViewerActionOutcome {
  actionType: string;
  status: "applied" | "rejected";
  code?: string;
  reason?: string;
}

export interface AgentRuntimeResult {
  status: AgentRuntimeStatus;
  response: string;
  evidence: Evidence[];
  claims: AssessedEvidenceClaim[];
  viewerActions: AgentViewerActionOutcome[];
  trace: AgentTrace;
}
