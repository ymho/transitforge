import type { AgentProgressReporter } from "@raiquora/agent/agent-progress";
import type { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import type { AgentRuntimeContextInput } from "@raiquora/agent/agent-decision-context";
import type { Evidence } from "@raiquora/agent/evidence-model";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import type { AgentRuntimeLimits } from "@raiquora/agent/runtime-policies";
import type { ResearchExecutionLedger } from "@raiquora/agent/research-execution";
import type { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import type { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import type { EffectiveIntent } from "@raiquora/agent/effective-intent";
import type { UtteranceInterpretation } from "@raiquora/agent/semantic-interpretation";
import type { PublicSemanticReceipt } from "@raiquora/agent/public-semantic-receipt";

/** A known validation rejection, not a failed or ambiguously committed state operation. */
export class ServerAgentIntentRejectedError extends Error {
  constructor() { super("intent_rejected"); this.name = "ServerAgentIntentRejectedError"; }
}

/** Bounded runtime failure metadata. It deliberately carries no provider message,
 * prompt, user content, Tool payload, URL, ID or raw exception. */
export type ServerAgentRuntimeFailureStage = "agent_invoke" | "intent_state" | "read_tool" | "runtime_projection";
export type ServerAgentRuntimeFailureKind = "abort" | "timeout" | "provider" | "validation" | "unknown";
export class ServerAgentRuntimeExecutionError extends Error {
  constructor(readonly stage: ServerAgentRuntimeFailureStage, readonly kind: ServerAgentRuntimeFailureKind) {
    super(`server_agent_runtime_${stage}_${kind}`);
    this.name = "ServerAgentRuntimeExecutionError";
  }
}

export interface ServerAgentIntentController {
  apply(interpretation: UtteranceInterpretation): Promise<{
    receipt: PublicSemanticReceipt;
    effectiveIntent: EffectiveIntent;
  }>;
}

export interface ServerAgentRuntimeInput {
  executionId: string;
  userRequest: string;
  researchMode: { requestedMode: "standard" | "detailed"; effectiveMode: "standard" | "detailed" };
  context?: AgentRuntimeContextInput;
  tools: AgentToolRegistry;
  evidenceRegistry: ToolEvidenceRegistry;
  toolExecutor: AgentToolExecutor;
  limits: AgentRuntimeLimits;
  researchLedger: ResearchExecutionLedger;
  initialEvidence?: Evidence[];
  reportProgress?: AgentProgressReporter;
  /** Application-owned semantic acceptance seam. Absent on V1 and accepted-turn replay. */
  intentController?: ServerAgentIntentController;
}

/** Backend execution-engine port. Authentication/state resolution happens before this boundary. */
export type ServerAgentRuntimeRunner = (input: ServerAgentRuntimeInput) => Promise<AgentRuntimeResult>;
