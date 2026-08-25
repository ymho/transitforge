import type {
  BedrockAgentContentBlock,
  BedrockAgentMessage,
  BedrockAgentResponse,
} from "../http/agent-api/bedrock-agent-contract";
import { invokeBedrockAgent } from "../http/agent-api/bedrock-agent";
import type {
  AgentModelContent,
  AgentModelMessage,
  AgentModelProvider,
  AgentModelRequest,
  AgentModelResponse,
} from "../../application/agent/model-provider";

export class BedrockModelProvider implements AgentModelProvider {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    const result = await invokeBedrockAgent(
      request.messages.map(toBedrockMessage),
      this.fetcher,
      request.tools,
    );
    return {
      message: fromBedrockMessage(result.body.message),
      stopReason: fromBedrockStopReason(result.body.stopReason),
      metadata: {
        provider: "bedrock",
        ...(result.metadata.requestId === undefined
          ? {}
          : { requestId: result.metadata.requestId }),
        ...(result.body.metadata?.modelId === undefined
          ? {}
          : { model: result.body.metadata.modelId }),
        ...(result.body.metadata?.latencyMs === undefined
          ? {}
          : { latencyMs: result.body.metadata.latencyMs }),
        ...(result.body.metadata?.usage === undefined
          ? {}
          : { usage: result.body.metadata.usage }),
      },
    };
  }
}

function toBedrockMessage(message: AgentModelMessage): BedrockAgentMessage {
  return {
    role: message.role,
    content: message.content.map(toBedrockContent),
  };
}

function toBedrockContent(content: AgentModelContent): BedrockAgentContentBlock {
  if (content.type === "text") return { text: content.text };
  if (content.type === "tool_call") {
    return {
      toolUse: {
        toolUseId: content.toolCallId,
        name: content.name,
        input: content.input,
      },
    };
  }
  return {
    toolResult: {
      toolUseId: content.toolCallId,
      status: content.status,
      content: [{ json: content.output }],
    },
  };
}

function fromBedrockMessage(message: BedrockAgentMessage): AgentModelMessage {
  return {
    role: message.role,
    content: message.content.map(fromBedrockContent),
  };
}

function fromBedrockContent(content: BedrockAgentContentBlock): AgentModelContent {
  if ("text" in content) return { type: "text", text: content.text };
  if ("toolUse" in content) {
    return {
      type: "tool_call",
      toolCallId: content.toolUse.toolUseId,
      name: content.toolUse.name,
      input: content.toolUse.input,
    };
  }
  return {
    type: "tool_result",
    toolCallId: content.toolResult.toolUseId,
    status: content.toolResult.status,
    output: content.toolResult.content[0]?.json ?? null,
  };
}

function fromBedrockStopReason(
  stopReason: BedrockAgentResponse["stopReason"],
): AgentModelResponse["stopReason"] {
  if (stopReason === "tool_use") return "tool_calls";
  if (stopReason === "max_tokens") return "max_tokens";
  return "completed";
}
