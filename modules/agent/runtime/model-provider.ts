import type { AgentToolDescriptor } from "./tool-contract";
import type { AgentDecisionSummary } from "./agent-decision-summary";
import type { AgentOutputContract } from "./output-contract";

export type AgentModelClass = "default" | "lightweight" | "decision";
export type AgentModelFailureCode = "refusal" | "timeout" | "truncation" | "invalid_schema" | "provider_error";
export class AgentModelError extends Error {
  override name = "AgentModelError";
  constructor(readonly code: AgentModelFailureCode, message: string, readonly retryable: boolean) { super(message); }
}

export type AgentModelContent =
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      toolCallId: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolCallId: string;
      status: "success" | "error";
      output: unknown;
    };

export interface AgentModelMessage {
  role: "assistant" | "user";
  content: AgentModelContent[];
}

export interface AgentModelRequest {
  messages: AgentModelMessage[];
  tools?: AgentToolDescriptor[];
  modelClass?: AgentModelClass;
  modelCallId?: string;
  outputContract?: AgentOutputContract;
  prompt?: CompiledPrompt;
}

export interface CompiledPrompt {
  contractVersion: "compiled-prompt-v1";
  stableSegments: Array<{ kind: "system" | "tools" | "schema"; version: string; hash: string }>;
  dynamicSegments: Array<{ kind: "request" | "working_state" | "trip" | "evidence"; ref: string }>;
  coverage: { status: "complete" | "partial"; includedScopes: string[]; omittedScopes: string[] };
  omissionManifest: Array<{ scope: string; reason: "budget" | "not_loaded" | "source_unavailable" | "stale_revision" }>;
  cacheIntent: { enabled: boolean; checkpoint: "system" | "tools" | "none"; ttlSeconds?: number };
  budgetSnapshotRef?: string;
}

export interface AgentModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  cacheTtlSeconds?: number;
}

export interface AgentModelMetadata {
  provider: string;
  requestId?: string;
  model?: string;
  latencyMs?: number;
  usage?: AgentModelUsage;
  outputMode?: "provider_strict" | "application_strict" | "legacy_text";
  outputContract?: import("./output-contract").OutputContractRef;
  omittedSchemaConstraints?: string[];
  cacheStatus?: "read" | "write" | "miss" | "unknown" | "disabled";
}

export interface AgentModelResponse {
  declaredInTripAnswerPlan?: import("./in-trip-answer-plan").InTripAnswerPlan;
  message: AgentModelMessage;
  stopReason: "completed" | "tool_calls" | "max_tokens";
  metadata: AgentModelMetadata;
  decisionSummaryStatus?: "valid" | "missing" | "invalid";
  decisionSummary?: AgentDecisionSummary;
  invalidUsedEvidenceIds?: boolean;
  declaredEvidenceIds?: string[];
}

export interface AgentModelProvider {
  generate(request: AgentModelRequest): Promise<AgentModelResponse>;
}
