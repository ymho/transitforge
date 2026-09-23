import { withAgentDecisionSummary } from "@raiquora/agent/model-response";
import { agentTurnOutputContract, decodeAgentTurnOutput } from "@raiquora/agent/agent-output-contract";
import { AgentModelError, type AgentModelMessage, type AgentModelProvider, type AgentModelRequest, type AgentModelResponse } from "@raiquora/agent/model-provider";
import { modelToolDescription } from "@raiquora/agent/tool-contract";
import { ConversationModelError, type ConversationModel } from "../ports/conversation-model.js";
import type { AgentMessage } from "../contracts/agent-request.js";

/** In-process bridge. The existing ConversationModel owns Bedrock and its system prompt. */
export class ConversationModelProvider implements AgentModelProvider {
  constructor(private readonly model: ConversationModel, private readonly executionId: string) {}

  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    let response;
    try { response = await this.model.converse({
      messages: request.messages.map(toConversationMessage),
      ...(request.tools?.length ? { tools: request.tools.map(tool => ({
        name: tool.name, description: modelToolDescription(tool), inputSchema: { ...tool.inputSchema },
      })) } : {}),
      ...(request.modelClass ? { modelClass: request.modelClass } : {}),
      ...(request.modelCallId ? { trace: { modelCallId: request.modelCallId, apiRequestId: this.executionId } } : {}),
      outputContract: request.outputContract ?? agentTurnOutputContract,
      ...(request.prompt ? { prompt: request.prompt } : {}),
    }); } catch (error) {
      if (error instanceof ConversationModelError) throw new AgentModelError(error.code, error.message, error.retryable);
      throw error;
    }
    const mapped: AgentModelResponse = {
      message: { role: response.message.role, content: response.message.content.map(block => {
        if ("text" in block) return { type: "text", text: block.text };
        if ("toolUse" in block) return { type: "tool_call", toolCallId: block.toolUse.toolUseId, name: block.toolUse.name, input: block.toolUse.input };
        return { type: "tool_result", toolCallId: block.toolResult.toolUseId, status: block.toolResult.status, output: block.toolResult.content[0].json };
      }) },
      stopReason: response.stopReason === "tool_use" ? "tool_calls" : response.stopReason === "max_tokens" ? "max_tokens" : "completed",
      metadata: { provider: "bedrock", model: response.metadata.modelId, latencyMs: response.metadata.latencyMs, usage: response.metadata.usage,
        outputMode: response.metadata.outputMode, outputContract: response.metadata.outputContract,
        omittedSchemaConstraints: response.metadata.omittedSchemaConstraints, cacheStatus: response.metadata.cacheStatus },
    };
    if (response.stopReason === "tool_use") return mapped;
    const textBlocks = response.message.content.flatMap(block => "text" in block ? [block.text] : []);
    const decoded = textBlocks.length === 1 ? decodeJsonOutput(textBlocks[0]!, response.metadata.outputMode) : undefined;
    if (decoded) return {
      ...mapped,
      message: { role: "assistant", content: [{ type: "text", text: decoded.responseText }] },
      decisionSummaryStatus: "valid",
      decisionSummary: decoded.decision,
      ...(decoded.decision.usedEvidenceIds ? { declaredEvidenceIds: decoded.decision.usedEvidenceIds } : {}),
    };
    // Explicitly versioned migration path only. Provider/application strict responses never
    // get a second permissive interpretation after schema decoding failed.
    return response.metadata.outputMode === "legacy_text" || response.metadata.outputMode === undefined ? withAgentDecisionSummary(mapped) : {
      ...mapped, decisionSummaryStatus: "invalid",
    };
  }
}

function decodeJsonOutput(text: string, mode: "provider_strict" | "application_strict" | "legacy_text" | undefined) {
  if (mode === "legacy_text" || mode === undefined) return undefined;
  try { return decodeAgentTurnOutput(JSON.parse(text)); } catch { return undefined; }
}

function toConversationMessage(message: AgentModelMessage): AgentMessage {
  return { role: message.role, content: message.content.map(block => {
    if (block.type === "text") return { text: block.text };
    if (block.type === "tool_call") return { toolUse: { toolUseId: block.toolCallId, name: block.name, input: block.input } };
    return { toolResult: { toolUseId: block.toolCallId, status: block.status, content: [{ json: block.output }] } };
  }) };
}
