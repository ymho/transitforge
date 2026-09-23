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
import { compileBedrockSchema } from "./bedrock-schema-compiler.js";
import { configuredBedrockCapabilities, type BedrockProviderCapabilities } from "./bedrock-provider-capabilities.js";
import { ConversationModelError } from "../ports/conversation-model.js";

export interface BedrockConverseInvoker {
  converse(input: JsonObject): Promise<unknown>;
}

export interface BedrockConversationOptions {
  modelId: string;
  maxOutputTokens?: number;
  lightweightModelId?: string;
  decisionModelId?: string;
  systemPrompt: string;
  traceRecorder?: ModelCallTraceRecorder;
  log?: (event: string, fields: Record<string, unknown>) => void;
  timeoutMs?: number;
  now?: () => number;
  region?: string;
  /** Explicit configuration/probe result. Never infer capabilities from a model name. */
  capabilities?: (modelId: string) => BedrockProviderCapabilities;
  promptCachingEnabled?: boolean;
}

export class BedrockConversationModel implements ConversationModel {
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly log: (event: string, fields: Record<string, unknown>) => void;

  constructor(
    private readonly client: BedrockConverseInvoker,
    private readonly options: BedrockConversationOptions,
  ) {
    if (options.maxOutputTokens !== undefined &&
      (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 1 || options.maxOutputTokens > 5_000)) {
      throw new Error("maxOutputTokens must be an integer between 1 and 5000");
    }
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
    const capabilities = this.options.capabilities?.(modelId) ?? configuredBedrockCapabilities(
      modelId,
      this.options.region ?? "unknown",
    );
    const compiledOutput = request.outputContract
      ? compileBedrockSchema(request.outputContract.schema, capabilities)
      : undefined;
    const caching = promptCachePlan(request, capabilities, this.options.promptCachingEnabled === true);
    const providerRequest: JsonObject = {
      modelId,
      system: [
        { text: this.options.systemPrompt },
        ...(compiledOutput?.mode === "application_strict" ? [{ text: applicationStrictInstruction(request.outputContract!) }] : []),
        ...(caching.systemCheckpoint ? [{ cachePoint: { type: "default" } }] : []),
      ],
      messages: request.messages,
      ...(!request.tools?.length ? {} : {
        toolConfig: {
          tools: [...request.tools.map((definition) => ({
            toolSpec: {
              name: definition.name,
              description: definition.description,
              inputSchema: { json: compileBedrockSchema(definition.inputSchema, capabilities).schema },
              ...(capabilities.strictToolUse === "supported" ? { strict: true } : {}),
            },
          })), ...(caching.toolsCheckpoint ? [{ cachePoint: { type: "default" } }] : [])],
        },
      }),
      ...(compiledOutput?.mode === "provider_strict" && capabilities.structuredTextOutput === "supported" ? {
        outputConfig: { textFormat: { type: "json_schema", structure: { jsonSchema: {
          name: request.outputContract!.name,
          description: request.outputContract!.description ?? request.outputContract!.name,
          schema: JSON.stringify(compiledOutput.schema),
        } } } },
      } : {}),
      inferenceConfig: { maxTokens: this.options.maxOutputTokens ?? 4_096, temperature: 0 },
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
        compiledOutput,
        request.outputContract,
        caching.enabled,
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
    const privateProfile = JSON.stringify(request.messages).includes("consentedPreferenceNotes") ||
      request.messages.some((message) => message.content.some((block) => "text" in block && typeof block.text === "string" && block.text.includes('"conversation":')));
    try {
      await this.options.traceRecorder.record({
        modelCallId: request.trace.modelCallId,
        apiRequestId: request.trace.apiRequestId,
        startedAt,
        completedAt: new Date().toISOString(),
        // Explicit consent to send Profile text to the model is not consent to retain it.
        // Omit the whole conversation: later Tool inputs/results may quote that text too.
        providerRequest: privateProfile
          ? { ...providerRequest, messages: "[private-profile-content-omitted]" }
          : providerRequest,
        outcome: privateProfile && outcome.status === "failed"
          ? { ...outcome, error: { ...outcome.error, message: "[private-profile-content-omitted]" } }
          : outcome,
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
  compiledOutput?: ReturnType<typeof compileBedrockSchema>,
  outputContract?: ConversationModelRequest["outputContract"],
  cachingEnabled = false,
): ConversationModelResponse {
  if (!isRecord(value) || !isRecord(value.output) || !isRecord(value.output.message)) {
    throw new ConversationModelError("provider_error", "Bedrock response is missing output.message", false);
  }
  if (["guardrail_intervened", "content_filtered", "refusal"].includes(String(value.stopReason))) {
    throw new ConversationModelError("refusal", `Bedrock refused the response (${String(value.stopReason)})`, false);
  }
  if (value.stopReason !== "end_turn" && value.stopReason !== "tool_use" && value.stopReason !== "max_tokens") {
    throw new ConversationModelError("provider_error", `Bedrock returned unsupported stopReason: ${String(value.stopReason)}`, false);
  }
  let message: ReturnType<typeof validatedMessages>[number];
  try {
    message = validatedMessages({ messages: [value.output.message] })[0];
  } catch {
    throw new ConversationModelError("invalid_schema", "Bedrock response does not match the assistant message contract", false);
  }
  if (!message || message.role !== "assistant") {
    throw new ConversationModelError("invalid_schema", "Bedrock response does not match the assistant message contract", false);
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
      ...(compiledOutput ? { outputMode: compiledOutput.mode, omittedSchemaConstraints: compiledOutput.omittedConstraints } : { outputMode: "legacy_text" as const }),
      ...(outputContract ? { outputContract: { name: outputContract.name, version: outputContract.version, schemaHash: outputContract.schemaHash } } : {}),
      cacheStatus: cacheStatus(usage, cachingEnabled),
    },
  };
}

function modelCallFailureDiagnostic(error: unknown): ModelCallFailureDiagnostic {
  if (error instanceof ConversationModelError) {
    return { name: error.name, message: error.message, retryable: error.retryable };
  }
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
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "cacheReadInputTokens", "cacheWriteInputTokens"] as const) {
    if (nonNegativeNumber(value[key])) usage[key] = Math.trunc(value[key]);
  }
  if (isRecord(value.cacheDetails) && typeof value.cacheDetails.ttl === "string") {
    if (value.cacheDetails.ttl === "5m") usage.cacheTtlSeconds = 300;
    if (value.cacheDetails.ttl === "1h") usage.cacheTtlSeconds = 3_600;
  }
  return Object.keys(usage).length === 0 ? undefined : usage;
}

function cacheStatus(usage: ConversationModelUsage | undefined, enabled: boolean): ConversationModelResponse["metadata"]["cacheStatus"] {
  if (!enabled) return "disabled";
  if (usage?.cacheReadInputTokens !== undefined && usage.cacheReadInputTokens > 0) return "read";
  if (usage?.cacheWriteInputTokens !== undefined && usage.cacheWriteInputTokens > 0) return "write";
  return usage ? "miss" : "unknown";
}

function promptCachePlan(
  request: ConversationModelRequest,
  capabilities: BedrockProviderCapabilities,
  enabledByConfiguration: boolean,
): { enabled: boolean; systemCheckpoint: boolean; toolsCheckpoint: boolean } {
  const intent = request.prompt?.cacheIntent;
  const desired = intent?.checkpoint;
  const selected = desired === "tools" && capabilities.promptCaching.checkpointFields.includes("tools") ? "tools" :
    capabilities.promptCaching.checkpointFields.includes("system") ? "system" : undefined;
  const supportedCheckpoint = selected !== undefined;
  const enabled = enabledByConfiguration && intent?.enabled === true && supportedCheckpoint && capabilities.promptCaching.mode !== "none" &&
    capabilities.promptCaching.mode !== "unmeasured";
  if (!enabled) return { enabled: false, systemCheckpoint: false, toolsCheckpoint: false };
  return {
    enabled: true,
    systemCheckpoint: selected === "system",
    toolsCheckpoint: selected === "tools" && Boolean(request.tools?.length),
  };
}

function applicationStrictInstruction(contract: NonNullable<ConversationModelRequest["outputContract"]>): string {
  const hasPresentation = typeof contract.schema.properties === "object" && contract.schema.properties !== null &&
    Object.hasOwn(contract.schema.properties, "presentation");
  return [
    `出力契約 ${contract.name}@${contract.version} (${contract.schemaHash}) に従い、`,
    "native toolUseを返さない最終応答ではJSON objectだけを返してください。Markdown fenceや説明文を外側へ追加しないでください。",
    hasPresentation
      ? "別の指示がsource-explanationまたはtravel-plan JSONを求める場合も外側の出力契約を置き換えず、そのobjectをpresentationへ設定してください。responseTextは短い利用者向けラベルのstringにしてください。"
      : "別の指示が本文をJSONにするよう求める場合も、外側の出力契約を置き換えず、そのJSONをresponseTextの文字列値としてJSON.stringify相当で格納してください。responseTextへobjectを直接設定しないでください。",
    `JSON Schema: ${JSON.stringify(contract.schema)}`,
  ].join(" ");
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
        timeout = setTimeout(() => reject(new ConversationModelError("timeout", "Bedrock request timed out", true)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
