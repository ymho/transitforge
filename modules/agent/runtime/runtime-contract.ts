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
  researchMode?: { requestedMode: "standard" | "detailed"; effectiveMode: "standard" | "detailed" };
  context?: AgentRuntimeContextInput;
  /** Trusted host privacy policy, never model/transport input. Keeps diagnostic counts and timing. */
  omitTraceContent?: boolean;
  /** Trusted Application boundary only, never general/model Context or public request body. */
  initialEvidence?: Evidence[];
}

export type AgentRuntimeStatus =
  | "completed"
  | "follow_up"
  | "limit_reached"
  | "failed";

export interface AgentRuntimeResult {
  turnObservation?: AgentTurnObservation;
  publicPlanPresentation?: import("./public-plan-presentation").PublicPlanPresentation;
  /** Content-free per-turn accounting. Safe to retain/replay with the turn receipt. */
  researchExecution?: import("./research-execution").ResearchExecutionOutcome;
  status: AgentRuntimeStatus;
  response: string;
  evidence: Evidence[];
  claims: AssessedEvidenceClaim[];
  trace: AgentTrace;
}
