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
  /** Model-visible bounded context produced by the Application. Defaults to userRequest. */
  modelInput?: string;
  tools: AgentToolRegistry;
  toolExecutor: AgentToolExecutor;
  effectiveIntent?: EffectiveIntent;
  cancelSignal?: AbortSignal;
  limits?: {
    maxTurns?: number;
    maxToolCalls?: number;
    maxExecutionMs?: number;
    maxTotalTokens?: number;
    maxOutputTokens?: number;
  };
  /** Return false to reject a Tool call before side effects/provider access. */
  reserveToolCall?: () => boolean;
}

export interface StrandsAgentRunResult {
  response: string;
  stopReason: string;
  evidence: Evidence[];
  trace: AgentTrace;
  limitReason?: "tool_calls" | "deadline";
  metrics?: {
    modelCalls: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
  };
}

export interface StrandsAgentLike {
  invoke(args: string, options?: {
    cancelSignal?: AbortSignal;
    limits?: { turns?: number; totalTokens?: number; outputTokens?: number };
  }): Promise<{
    stopReason: string;
    toString(): string;
    metrics?: {
      cycleCount: number;
      accumulatedUsage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cacheReadInputTokens?: number;
        cacheWriteInputTokens?: number;
      };
      toolMetrics: Record<string, { callCount: number }>;
    };
  }>;
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

    const budgetState = { toolCalls: 0, toolLimitReached: false };
    const tools = createStrandsReadTools({
      registry: input.tools,
      executor: input.toolExecutor,
      executionId: input.executionId,
      effectiveIntent: input.effectiveIntent,
      toolTimeoutMs: this.options.toolTimeoutMs ?? 20_000,
      trace,
      evidence,
      budgetState,
      maxToolCalls: input.limits?.maxToolCalls,
      reserveToolCall: input.reserveToolCall,
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
    const deadlineSignal = input.limits?.maxExecutionMs ? AbortSignal.timeout(input.limits.maxExecutionMs) : undefined;
    const cancelSignal = combineSignals(input.cancelSignal, deadlineSignal);
    try {
      const result = await agent.invoke(input.modelInput ?? input.userRequest, {
        ...(cancelSignal ? { cancelSignal } : {}),
        limits: {
          turns: input.limits?.maxTurns ?? this.options.maxTurns ?? 8,
          ...(input.limits?.maxTotalTokens ?? this.options.maxTotalTokens
            ? { totalTokens: input.limits?.maxTotalTokens ?? this.options.maxTotalTokens } : {}),
          ...(input.limits?.maxOutputTokens ?? this.options.maxOutputTokens
            ? { outputTokens: input.limits?.maxOutputTokens ?? this.options.maxOutputTokens } : {}),
        },
      });
      const response = result.toString();
      trace.responseGenerated(response);
      trace.taskCompleted(result.stopReason === "cancelled" ? "cancelled" : "completed", Date.now() - startedAt,
        result.stopReason === "endTurn" ? undefined : result.stopReason);
      const usage = result.metrics?.accumulatedUsage;
      return {
        response,
        stopReason: result.stopReason,
        evidence: evidence.map((item) => structuredClone(item)),
        trace: trace.snapshot(),
        ...(budgetState.toolLimitReached ? { limitReason: "tool_calls" as const } : {}),
        ...(result.stopReason === "cancelled" && deadlineSignal?.aborted ? { limitReason: "deadline" as const } : {}),
        ...(result.metrics && usage ? { metrics: {
          modelCalls: result.metrics.cycleCount,
          toolCalls: Object.values(result.metrics.toolMetrics).reduce((sum, item) => sum + item.callCount, 0),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          ...(usage.cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens: usage.cacheReadInputTokens }),
          ...(usage.cacheWriteInputTokens === undefined ? {} : { cacheWriteInputTokens: usage.cacheWriteInputTokens }),
        } } : {}),
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
  budgetState?: { toolCalls: number; toolLimitReached: boolean };
  maxToolCalls?: number;
  reserveToolCall?: () => boolean;
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
        if (input.maxToolCalls !== undefined && (input.budgetState?.toolCalls ?? 0) >= input.maxToolCalls ||
            input.reserveToolCall && !input.reserveToolCall()) {
          if (input.budgetState) input.budgetState.toolLimitReached = true;
          return jsonValue({ ok: false, error: { code: "execution_failed", retryable: false, reason: "tool_budget" } });
        }
        if (input.budgetState) input.budgetState.toolCalls += 1;

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

function combineSignals(primary: AbortSignal | undefined, deadline: AbortSignal | undefined): AbortSignal | undefined {
  if (!primary) return deadline;
  if (!deadline) return primary;
  return AbortSignal.any([primary, deadline]);
}
