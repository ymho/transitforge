import type { AgentToolDescriptor } from "./tool-contract";

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
}

export interface AgentModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AgentModelMetadata {
  provider: string;
  requestId?: string;
  model?: string;
  latencyMs?: number;
  usage?: AgentModelUsage;
}

export interface AgentModelResponse {
  message: AgentModelMessage;
  stopReason: "completed" | "tool_calls" | "max_tokens";
  metadata: AgentModelMetadata;
}

export interface AgentModelProvider {
  generate(request: AgentModelRequest): Promise<AgentModelResponse>;
}
