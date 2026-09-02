import type { JsonObject } from "../contracts/agent-request.js";
import { validatedMessages } from "../contracts/agent-request.js";
import type {
  ConversationModel,
  ConversationModelRequest,
  ConversationModelResponse,
  ConversationModelUsage,
} from "../ports/conversation-model.js";
import type {
  ModelCallFailureDiagnostic,
  ModelCallTraceRecorder,
} from "../ports/model-call-trace.js";

export interface BedrockConverseInvoker {
  converse(input: JsonObject): Promise<unknown>;
}

export interface BedrockConversationOptions {
  modelId: string;
  lightweightModelId?: string;
  decisionModelId?: string;
  systemPrompt: string;
  traceRecorder?: ModelCallTraceRecorder;
  log?: (event: string, fields: Record<string, unknown>) => void;
  timeoutMs?: number;
  now?: () => number;
}

export class BedrockConversationModel implements ConversationModel {
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly log: (event: string, fields: Record<string, unknown>) => void;

  constructor(
    private readonly client: BedrockConverseInvoker,
    private readonly options: BedrockConversationOptions,
  ) {
    for (const modelId of [
      options.modelId,
      options.lightweightModelId,
      options.decisionModelId,
    ]) {
      if (modelId !== undefined) validateBedrockModelId(modelId);
    }
    this.timeoutMs = options.timeoutMs ?? 55_000;
    this.now = options.now ?? (() => performance.now());
    this.log = options.log ?? (() => undefined);
  }

  async converse(request: ConversationModelRequest): Promise<ConversationModelResponse> {
    const startedAt = this.now();
    const modelId = selectedModelId(this.options, request.modelClass);
    const providerRequest: JsonObject = {
      modelId,
      system: [{ text: this.options.systemPrompt }],
      messages: request.messages,
      ...(request.tools === undefined ? {} : {
        toolConfig: {
          tools: request.tools.map((definition) => ({
            toolSpec: {
              name: definition.name,
              description: definition.description,
              inputSchema: { json: bedrockToolInputSchema(definition.inputSchema) },
            },
          })),
        },
      }),
      inferenceConfig: { maxTokens: 500, temperature: 0 },
    };
    const startedAtIso = new Date().toISOString();
    try {
      const providerResponse = await withTimeout(
        this.client.converse(providerRequest),
        this.timeoutMs,
      );
      const response = normalizedResponse(
        providerResponse,
        modelId,
        Math.round(this.now() - startedAt),
      );
      await this.recordTrace(request, providerRequest, startedAtIso, {
        status: "completed",
        stopReason: response.stopReason,
        modelId: response.metadata.modelId,
        latencyMs: response.metadata.latencyMs,
        ...(response.metadata.usage === undefined ? {} : { usage: response.metadata.usage }),
      });
      return response;
    } catch (error) {
      await this.recordTrace(request, providerRequest, startedAtIso, {
        status: "failed",
        error: modelCallFailureDiagnostic(error),
      });
      throw error;
    }
  }

  private async recordTrace(
    request: ConversationModelRequest,
    providerRequest: JsonObject,
    startedAt: string,
    outcome: Parameters<ModelCallTraceRecorder["record"]>[0]["outcome"],
  ): Promise<void> {
    if (!request.trace || !this.options.traceRecorder) return;
    try {
      await this.options.traceRecorder.record({
        modelCallId: request.trace.modelCallId,
        apiRequestId: request.trace.apiRequestId,
        startedAt,
        completedAt: new Date().toISOString(),
        providerRequest,
        outcome,
      });
    } catch {
      this.log("agent_model_call_trace_store_failed", {
        modelCallId: request.trace.modelCallId,
        requestId: request.trace.apiRequestId,
        outcome: outcome.status,
      });
    }
  }
}

function bedrockToolInputSchema(inputSchema: JsonObject): JsonObject {
  const properties = isRecord(inputSchema.properties)
    ? inputSchema.properties
    : {};
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((value): value is string => typeof value === "string")
    : undefined;
  return {
    type: "object",
    properties,
    ...(required === undefined ? {} : { required }),
  };
}

const bedrockModelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

export function validateBedrockModelId(modelId: string): string {
  if (!bedrockModelIdPattern.test(modelId)) {
    throw new Error("Bedrock model ID is invalid");
  }
  return modelId;
}

function selectedModelId(
  options: BedrockConversationOptions,
  modelClass: ConversationModelRequest["modelClass"],
): string {
  if (modelClass === "lightweight") return options.lightweightModelId ?? options.modelId;
  if (modelClass === "decision") return options.decisionModelId ?? options.modelId;
  return options.modelId;
}

function normalizedResponse(
  value: unknown,
  modelId: string,
  measuredLatencyMs: number,
): ConversationModelResponse {
  if (!isRecord(value) || !isRecord(value.output) || !isRecord(value.output.message)) {
    throw new Error("Bedrock response is missing output.message");
  }
  if (value.stopReason !== "end_turn" && value.stopReason !== "tool_use" && value.stopReason !== "max_tokens") {
    throw new Error(`Bedrock returned unsupported stopReason: ${String(value.stopReason)}`);
  }
  const message = validatedMessages({ messages: [value.output.message] })[0];
  if (!message || message.role !== "assistant") {
    throw new Error("Bedrock response contains an invalid assistant message");
  }
  const providerLatency = isRecord(value.metrics) && nonNegativeNumber(value.metrics.latencyMs)
    ? Math.round(value.metrics.latencyMs)
    : measuredLatencyMs;
  const usage = safeUsage(value.usage);
  return {
    message,
    stopReason: value.stopReason,
    metadata: {
      modelId,
      latencyMs: providerLatency,
      ...(usage === undefined ? {} : { usage }),
    },
  };
}

function modelCallFailureDiagnostic(error: unknown): ModelCallFailureDiagnostic {
  if (!isRecord(error)) {
    return { name: "UnknownError", message: String(error) };
  }
  const metadata = isRecord(error.$metadata) ? error.$metadata : undefined;
  const retryable = isRecord(error.$retryable)
    ? Object.keys(error.$retryable).length > 0
    : undefined;
  return {
    name: typeof error.name === "string" ? error.name : "Error",
    message: typeof error.message === "string" ? error.message : "Unknown model call failure",
    ...(nonNegativeNumber(metadata?.httpStatusCode)
      ? { statusCode: Math.trunc(metadata.httpStatusCode) }
      : {}),
    ...(typeof metadata?.requestId === "string"
      ? { providerRequestId: metadata.requestId }
      : {}),
    ...(retryable === undefined ? {} : { retryable }),
  };
}

function safeUsage(value: unknown): ConversationModelUsage | undefined {
  if (!isRecord(value)) return undefined;
  const usage: ConversationModelUsage = {};
  for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
    if (nonNegativeNumber(value[key])) usage[key] = Math.trunc(value[key]);
  }
  return Object.keys(usage).length === 0 ? undefined : usage;
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Bedrock request timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
