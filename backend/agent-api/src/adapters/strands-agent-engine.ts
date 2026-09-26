import {
  Agent,
  BedrockModel,
  tool,
  type AgentConfig,
  type BaseModelConfig,
  type InvokableTool,
  type JSONSchema,
  type JSONValue,
  type Model,
} from "@strands-agents/sdk";
import { AgentTraceRecorder, type AgentTrace } from "@raiquora/agent/agent-trace";
import { validateToolIntentUse } from "@raiquora/agent/intent-action-policy";
import type { EffectiveIntent } from "@raiquora/agent/effective-intent";
import type { Evidence } from "@raiquora/agent/evidence-model";
import type { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import type { AgentToolRegistry } from "@raiquora/agent/tool-registry";

export interface StrandsAgentEngineOptions {
  modelId: string;
  region: string;
  systemPrompt: string;
  maxTurns?: number;
  maxTotalTokens?: number;
  maxOutputTokens?: number;
  toolTimeoutMs?: number;
}

export interface StrandsAgentRunInput {
  executionId: string;
  userRequest: string;
  tools: AgentToolRegistry;
  toolExecutor: AgentToolExecutor;
  effectiveIntent?: EffectiveIntent;
  cancelSignal?: AbortSignal;
}

export interface StrandsAgentRunResult {
  response: string;
  stopReason: string;
  evidence: Evidence[];
  trace: AgentTrace;
}

export interface StrandsAgentLike {
  invoke(args: string, options?: {
    cancelSignal?: AbortSignal;
    limits?: { turns?: number; totalTokens?: number; outputTokens?: number };
  }): Promise<{ stopReason: string; toString(): string }>;
}

export type StrandsAgentFactory = (config: AgentConfig) => StrandsAgentLike;

/**
 * Greenfield Agent v2 execution adapter.
 *
 * Strands owns only the bounded model/tool loop. Conversation state, authority,
 * Effective Intent, Evidence applicability and persistence remain Application-owned.
 */
export class StrandsAgentEngine {
  private readonly createAgent: StrandsAgentFactory;

  constructor(
    private readonly options: StrandsAgentEngineOptions,
    dependencies: { createAgent?: StrandsAgentFactory; model?: Model<BaseModelConfig> } = {},
  ) {
    this.model = dependencies.model;
    this.createAgent = dependencies.createAgent ?? ((config) => new Agent(config));
  }

  private readonly model?: Model<BaseModelConfig>;

  async run(input: StrandsAgentRunInput): Promise<StrandsAgentRunResult> {
    if (!input.executionId.trim() || !input.userRequest.trim()) throw new Error("Strands Agent requires executionId and userRequest");
    const evidence: Evidence[] = [];
    const trace = new AgentTraceRecorder(input.executionId, { omitContent: true });
    trace.taskStarted(input.userRequest);

    const tools = createStrandsReadTools({
      registry: input.tools,
      executor: input.toolExecutor,
      executionId: input.executionId,
      effectiveIntent: input.effectiveIntent,
      toolTimeoutMs: this.options.toolTimeoutMs ?? 20_000,
      trace,
      evidence,
    });
    const agent = this.createAgent({
      model: this.model ?? new BedrockModel({
        modelId: this.options.modelId,
        region: this.options.region,
        maxTokens: this.options.maxOutputTokens ?? 2_048,
        temperature: 0,
      }),
      tools,
      systemPrompt: this.options.systemPrompt,
      printer: false,
      contextManager: false,
      retryStrategy: null,
      toolExecutor: "sequential",
    });
    const startedAt = Date.now();
    try {
      const result = await agent.invoke(input.userRequest, {
        cancelSignal: input.cancelSignal,
        limits: {
          turns: this.options.maxTurns ?? 8,
          ...(this.options.maxTotalTokens ? { totalTokens: this.options.maxTotalTokens } : {}),
          ...(this.options.maxOutputTokens ? { outputTokens: this.options.maxOutputTokens } : {}),
        },
      });
      const response = result.toString();
      trace.responseGenerated(response);
      trace.taskCompleted(result.stopReason === "cancelled" ? "cancelled" : "completed", Date.now() - startedAt,
        result.stopReason === "endTurn" ? undefined : result.stopReason);
      return {
        response,
        stopReason: result.stopReason,
        evidence: evidence.map((item) => structuredClone(item)),
        trace: trace.snapshot(),
      };
    } catch (error) {
      trace.taskCompleted("failed", Date.now() - startedAt, error instanceof Error ? error.name : "unknown_error");
      throw error;
    }
  }
}

export function createStrandsReadTools(input: {
  registry: AgentToolRegistry;
  executor: AgentToolExecutor;
  executionId: string;
  effectiveIntent?: EffectiveIntent;
  toolTimeoutMs: number;
  trace: AgentTraceRecorder;
  evidence: Evidence[];
}): InvokableTool<unknown, JSONValue>[] {
  return input.registry.descriptors().filter((descriptor) => input.registry.effect(descriptor.name) === "read").map((descriptor) =>
    tool({
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema as JSONSchema,
      callback: async (rawInput, context) => {
        const toolInput = jsonObject(rawInput);
        if (!toolInput) return jsonValue({ ok: false, error: { code: "invalid_input", retryable: false } });

        const decision = validateToolIntentUse(descriptor, toolInput, input.effectiveIntent);
        if (!decision.accepted) {
          return jsonValue({ ok: false, error: {
            code: decision.error?.code ?? "precondition_failed",
            retryable: decision.error?.retryable ?? false,
          } });
        }
        if (context?.cancelSignal.aborted) return jsonValue({ ok: false, error: { code: "execution_failed", retryable: true } });

        const execution = await input.executor.execute({
          executionId: input.executionId,
          toolCallId: context?.toolUse.toolUseId ?? `strands-${descriptor.name}`,
          toolName: descriptor.name,
          toolInput,
          timeoutMs: input.toolTimeoutMs,
          ...(input.effectiveIntent && decision.dependencyTargets.length ? { intentDependency: {
            intentRevision: input.effectiveIntent.intentRevision,
            fingerprint: input.effectiveIntent.fingerprint,
            targets: decision.dependencyTargets,
          } } : {}),
        }, input.trace);
        if (execution.evidence.length) input.evidence.push(...execution.evidence.map((item) => structuredClone(item)));
        if (!execution.result.ok) {
          return jsonValue({ ok: false, error: {
            code: execution.result.error.code,
            retryable: execution.result.error.retryable,
          } });
        }
        return jsonValue({
          ok: true,
          output: execution.result.output,
          evidenceIds: execution.evidence.map(({ id }) => id),
        });
      },
    }));
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function jsonValue(value: unknown): JSONValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Tool result is not JSON serializable");
  return JSON.parse(serialized) as JSONValue;
}
