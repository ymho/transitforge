import type { AgentProgressReporter } from "@raiquora/agent/agent-progress";
import type { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import type { AgentRuntimeContextInput } from "@raiquora/agent/agent-decision-context";
import type { Evidence } from "@raiquora/agent/evidence-model";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import type { AgentRuntimeLimits } from "@raiquora/agent/runtime-policies";
import type { ResearchExecutionLedger } from "@raiquora/agent/research-execution";
import type { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import type { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";

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
}

/** Backend execution-engine port. Authentication/state resolution happens before this boundary. */
export type ServerAgentRuntimeRunner = (input: ServerAgentRuntimeInput) => Promise<AgentRuntimeResult>;
