import type { AssessedEvidenceClaim, Evidence } from "./evidence-model";
import type { AgentTrace } from "./agent-trace";
import type { AgentRuntimeContextInput } from "./agent-decision-context";
import type { AgentTurnObservation } from "./agent-turn-outcome";

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
  turnObservation?: AgentTurnObservation;
  status: AgentRuntimeStatus;
  response: string;
  evidence: Evidence[];
  claims: AssessedEvidenceClaim[];
  viewerActions: AgentViewerActionOutcome[];
  trace: AgentTrace;
}
