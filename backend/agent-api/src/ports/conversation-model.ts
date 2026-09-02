import type {
  AgentMessage,
  AgentToolDefinition,
} from "../contracts/agent-request.js";
import type { ConversationModelClass } from "../contracts/model-class.js";

export interface ConversationModelRequest {
  messages: AgentMessage[];
  tools?: AgentToolDefinition[];
  modelClass?: ConversationModelClass;
  trace?: {
    modelCallId: string;
    apiRequestId: string;
  };
}

export interface ConversationModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ConversationModelResponse {
  message: AgentMessage;
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  metadata: {
    modelId: string;
    latencyMs: number;
    usage?: ConversationModelUsage;
  };
}

export interface ConversationModel {
  converse(request: ConversationModelRequest): Promise<ConversationModelResponse>;
}
