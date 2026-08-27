import type { JsonObject } from "../contracts/agent-request.js";
import { validatedMessages } from "../contracts/agent-request.js";
import type {
  ConversationModel,
  ConversationModelRequest,
  ConversationModelResponse,
  ConversationModelUsage,
} from "../ports/conversation-model.js";

export interface BedrockConverseInvoker {
  converse(input: JsonObject): Promise<unknown>;
}

export interface BedrockConversationOptions {
  modelId: string;
  systemPrompt: string;
  timeoutMs?: number;
  now?: () => number;
}

export class BedrockConversationModel implements ConversationModel {
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly client: BedrockConverseInvoker,
    private readonly options: BedrockConversationOptions,
  ) {
    this.timeoutMs = options.timeoutMs ?? 55_000;
    this.now = options.now ?? (() => performance.now());
  }

  async converse(request: ConversationModelRequest): Promise<ConversationModelResponse> {
    const startedAt = this.now();
    const providerRequest: JsonObject = {
      modelId: this.options.modelId,
      system: [{ text: this.options.systemPrompt }],
      messages: request.messages,
      ...(request.tools === undefined ? {} : {
        toolConfig: {
          tools: request.tools.map((definition) => ({
            toolSpec: {
              name: definition.name,
              description: definition.description,
              inputSchema: { json: novaToolInputSchema(definition.inputSchema) },
            },
          })),
        },
      }),
      inferenceConfig: { maxTokens: 500, temperature: 0 },
    };
    const providerResponse = await withTimeout(
      this.client.converse(providerRequest),
      this.timeoutMs,
    );
    return normalizedResponse(
      providerResponse,
      this.options.modelId,
      Math.round(this.now() - startedAt),
    );
  }
}

function novaToolInputSchema(inputSchema: JsonObject): JsonObject {
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

function normalizedResponse(
  value: unknown,
  modelId: string,
  measuredLatencyMs: number,
): ConversationModelResponse {
  if (!isRecord(value) || !isRecord(value.output) || !isRecord(value.output.message)) {
    throw new Error("Bedrock returned an unexpected response");
  }
  if (value.stopReason !== "end_turn" && value.stopReason !== "tool_use" && value.stopReason !== "max_tokens") {
    throw new Error("Bedrock returned an unexpected response");
  }
  const message = validatedMessages({ messages: [value.output.message] })[0];
  if (!message || message.role !== "assistant") {
    throw new Error("Bedrock returned an unexpected response");
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
