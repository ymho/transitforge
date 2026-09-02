import type { AgentMessage, AgentToolDefinition, JsonObject } from "../contracts/agent-request.js";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { ConversationModel } from "../ports/conversation-model.js";

export function createBedrockConverseOperation(
  model: ConversationModel,
  log: (event: string, fields: Record<string, unknown>) => void = () => undefined,
): AgentOperation {
  return async (request: JsonObject, context) => {
    const startedAt = performance.now();
    log("bedrock_converse_started", { requestId: context.requestId });
    const result = await model.converse({
      messages: request.messages as AgentMessage[],
      ...(request.toolDefinitions === undefined ? {} : {
        tools: request.toolDefinitions as AgentToolDefinition[],
      }),
      ...(request.modelClass === undefined ? {} : {
        modelClass: request.modelClass as import("../contracts/model-class.js").ConversationModelClass,
      }),
      trace: {
        modelCallId: typeof request.modelCallId === "string"
          ? request.modelCallId
          : context.requestId,
        apiRequestId: context.requestId,
      },
    });
    log("bedrock_converse_completed", {
      requestId: context.requestId,
      durationMs: Math.round(performance.now() - startedAt),
      stopReason: result.stopReason,
    });
    return {
      body: {
        message: result.message,
        stopReason: result.stopReason,
        metadata: result.metadata,
      },
    };
  };
}
