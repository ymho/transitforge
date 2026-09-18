import { withAgentDecisionSummary } from "@raiquora/agent/model-response";
import type { AgentModelMessage, AgentModelProvider, AgentModelRequest, AgentModelResponse } from "@raiquora/agent/model-provider";
import { modelToolDescription } from "@raiquora/agent/tool-contract";
import type { ConversationModel } from "../ports/conversation-model.js";
import type { AgentMessage } from "../contracts/agent-request.js";

/** In-process bridge. The existing ConversationModel owns Bedrock and its system prompt. */
export class ConversationModelProvider implements AgentModelProvider {
  constructor(private readonly model: ConversationModel, private readonly executionId: string) {}

  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    const response = await this.model.converse({
      messages: request.messages.map(toConversationMessage),
      ...(request.tools?.length ? { tools: request.tools.map(tool => ({
        name: tool.name, description: modelToolDescription(tool), inputSchema: { ...tool.inputSchema },
      })) } : {}),
      ...(request.modelClass ? { modelClass: request.modelClass } : {}),
      ...(request.modelCallId ? { trace: { modelCallId: request.modelCallId, apiRequestId: this.executionId } } : {}),
    });
    return withAgentDecisionSummary({
      message: { role: response.message.role, content: response.message.content.map(block => {
        if ("text" in block) return { type: "text", text: block.text };
        if ("toolUse" in block) return { type: "tool_call", toolCallId: block.toolUse.toolUseId, name: block.toolUse.name, input: block.toolUse.input };
        return { type: "tool_result", toolCallId: block.toolResult.toolUseId, status: block.toolResult.status, output: block.toolResult.content[0].json };
      }) },
      stopReason: response.stopReason === "tool_use" ? "tool_calls" : response.stopReason === "max_tokens" ? "max_tokens" : "completed",
      metadata: { provider: "bedrock", model: response.metadata.modelId, latencyMs: response.metadata.latencyMs, usage: response.metadata.usage },
    });
  }
}

function toConversationMessage(message: AgentModelMessage): AgentMessage {
  return { role: message.role, content: message.content.map(block => {
    if (block.type === "text") return { text: block.text };
    if (block.type === "tool_call") return { toolUse: { toolUseId: block.toolCallId, name: block.name, input: block.input } };
    return { toolResult: { toolUseId: block.toolCallId, status: block.status, content: [{ json: block.output }] } };
  }) };
}
