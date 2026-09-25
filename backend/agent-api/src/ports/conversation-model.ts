import type {
  AgentMessage,
  AgentToolDefinition,
} from "../contracts/agent-request.js";
import type { ConversationModelClass } from "../contracts/model-class.js";
import type { CompiledPrompt } from "@raiquora/agent/model-provider";
import type { AgentOutputContract, OutputContractRef } from "@raiquora/agent/output-contract";

export interface ConversationModelRequest {
  messages: AgentMessage[];
  /** Application-owned task instruction. User content remains a separate data message. */
  instruction?: string;
  tools?: AgentToolDefinition[];
  modelClass?: ConversationModelClass;
  trace?: {
    modelCallId: string;
    apiRequestId: string;
  };
  outputContract?: AgentOutputContract;
  prompt?: CompiledPrompt;
}

export interface ConversationModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  cacheTtlSeconds?: number;
}

export interface ConversationModelResponse {
  message: AgentMessage;
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  metadata: {
    modelId: string;
    latencyMs: number;
    usage?: ConversationModelUsage;
    outputMode?: "provider_strict" | "application_strict" | "legacy_text";
    outputContract?: OutputContractRef;
    omittedSchemaConstraints?: string[];
    cacheStatus?: "read" | "write" | "miss" | "unknown" | "disabled";
  };
}

export type ConversationModelFailureCode = "refusal" | "timeout" | "truncation" | "invalid_schema" | "provider_error";
export class ConversationModelError extends Error {
  override name = "ConversationModelError";
  constructor(readonly code: ConversationModelFailureCode, message: string, readonly retryable: boolean) { super(message); }
}

export interface ConversationModel {
  converse(request: ConversationModelRequest): Promise<ConversationModelResponse>;
}
