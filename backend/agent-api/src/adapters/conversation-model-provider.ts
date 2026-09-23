import { withAgentDecisionSummary } from "@raiquora/agent/model-response";
import { agentTurnOutputContract, agentTurnPresentationOutputContract, decodeAgentTurnOutput } from "@raiquora/agent/agent-output-contract";
import { AgentModelError, type AgentModelMessage, type AgentModelProvider, type AgentModelRequest, type AgentModelResponse } from "@raiquora/agent/model-provider";
import { modelToolDescription } from "@raiquora/agent/tool-contract";
import { ConversationModelError, type ConversationModel } from "../ports/conversation-model.js";
import type { AgentMessage } from "../contracts/agent-request.js";

/** In-process bridge. The existing ConversationModel owns Bedrock and its system prompt. */
export class ConversationModelProvider implements AgentModelProvider {
  constructor(private readonly model: ConversationModel, private readonly executionId: string) {}

  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    const outputContract = request.outputContract ?? agentTurnOutputContract;
    let response;
    try { response = await this.model.converse({
      messages: request.messages.map(toConversationMessage),
      ...(request.tools?.length ? { tools: request.tools.map(tool => ({
        name: tool.name, description: modelToolDescription(tool), inputSchema: { ...tool.inputSchema },
      })) } : {}),
      ...(request.modelClass ? { modelClass: request.modelClass } : {}),
      ...(request.modelCallId ? { trace: { modelCallId: request.modelCallId, apiRequestId: this.executionId } } : {}),
      outputContract,
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
    const parsed = textBlocks.length === 1 ? parseJsonOutput(textBlocks[0]!, response.metadata.outputMode) : undefined;
    const decoded = parsed === undefined ? undefined : decodeAgentTurnOutput(parsed);
    const presentationRequired = requiresPresentation(outputContract);
    // Some application-strict models still place the requested presentation JSON in
    // responseText. Promote exactly one recognized object; Application performs the
    // complete Evidence/itinerary/cost/reference validation before rendering it.
    const presentation = decoded?.presentation ?? (presentationRequired && response.metadata.outputMode === "application_strict"
      ? embeddedPresentation(decoded?.responseText) : undefined);
    if (decoded && (!presentationRequired || presentation)) return {
      ...mapped,
      // Structured Evidence-bound presentations are validated and rendered by the
      // Application. Model-authored responseText cannot override their facts.
      message: { role: "assistant", content: [{ type: "text", text: decoded.responseText }] },
      ...(presentation ? { declaredPresentation: presentation } : {}),
      decisionSummaryStatus: "valid",
      decisionSummary: decoded.decision,
      ...(decoded.decision.usedEvidenceIds ? { declaredEvidenceIds: decoded.decision.usedEvidenceIds } : {}),
    };
    // Decision metadata is advisory for presentation rendering. Preserve an
    // independently recognizable v2 presentation when only Decision decoding
    // failed; Runtime still validates every Evidence, quote, itinerary, cost and
    // photo reference before anything is displayed. Never use this path to route
    // a Tool or to mark the Decision valid.
    const presentationWithInvalidDecision = presentationRequired && response.metadata.outputMode === "application_strict"
      ? independentlyDecodedPresentation(parsed) : undefined;
    if (presentationWithInvalidDecision) return {
      ...mapped,
      message: { role: "assistant", content: [{ type: "text", text: presentationWithInvalidDecision.responseText }] },
      declaredPresentation: presentationWithInvalidDecision.presentation,
      decisionSummaryStatus: "invalid",
    };
    // Explicitly versioned migration path only. Provider/application strict responses never
    // get a second permissive interpretation after schema decoding failed.
    return response.metadata.outputMode === "legacy_text" || response.metadata.outputMode === undefined ? withAgentDecisionSummary(mapped) : {
      ...mapped, decisionSummaryStatus: "invalid",
    };
  }
}

function requiresPresentation(contract: typeof agentTurnOutputContract): boolean {
  return contract.name === agentTurnPresentationOutputContract.name &&
    contract.version === agentTurnPresentationOutputContract.version &&
    contract.schemaHash === agentTurnPresentationOutputContract.schemaHash;
}

function embeddedPresentation(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).kind !== undefined &&
      ["source-explanation", "travel-plan"].includes(String((value as Record<string, unknown>).kind))
      ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function parseJsonOutput(text: string, mode: "provider_strict" | "application_strict" | "legacy_text" | undefined): unknown {
  if (mode === "legacy_text" || mode === undefined) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

function independentlyDecodedPresentation(value: unknown): { responseText: string; presentation: Record<string, unknown> } | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !["responseText", "decision", "presentation"].includes(key)) ||
      !("decision" in value) || typeof value.responseText !== "string" || !value.responseText.trim() || value.responseText.length > 12_000 ||
      !isRecord(value.presentation) || !["source-explanation", "travel-plan"].includes(String(value.presentation.kind))) return undefined;
  return { responseText: value.responseText, presentation: value.presentation };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toConversationMessage(message: AgentModelMessage): AgentMessage {
  return { role: message.role, content: message.content.map(block => {
    if (block.type === "text") return { text: block.text };
    if (block.type === "tool_call") return { toolUse: { toolUseId: block.toolCallId, name: block.name, input: block.input } };
    return { toolResult: { toolUseId: block.toolCallId, status: block.status, content: [{ json: block.output }] } };
  }) };
}
