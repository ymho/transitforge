import type {
  AgentMessage,
  AgentToolDefinition,
} from "../contracts/agent-request.js";

export interface ConversationModelRequest {
  messages: AgentMessage[];
  tools?: AgentToolDefinition[];
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
