import {
  Agent, BedrockModel, tool,
  type AgentConfig, type BaseModelConfig, type InvokableTool,
  type JSONSchema, type JSONValue, type Model,
} from "@strands-agents/sdk";
import { AgentTraceRecorder, type AgentTrace } from "@raiquora/agent/agent-trace";
import { validateToolIntentUse } from "@raiquora/agent/intent-action-policy";
import type { EffectiveIntent } from "@raiquora/agent/effective-intent";
import type { Evidence } from "@raiquora/agent/evidence-model";
import type { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import type { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { agentV2ReplySchema, type AgentV2ReplyProposal } from "@raiquora/agent/agent-v2-reply";
import { AgentV2ReplySubmission } from "./strands-reply-submission.js";
import { agentV2CandidateReferences, publicReplyField } from "@raiquora/agent/agent-v2-publication";
import { decodeUtteranceInterpretation, semanticInterpretationOutputContract } from "@raiquora/agent/semantic-interpretation";
import { ServerAgentIntentRejectedError, ServerAgentRuntimeExecutionError, type ServerAgentIntentController,
  type ServerAgentRuntimeFailureKind } from "../ports/server-agent-runtime.js";

export const strandsReplyToolName = "submit_reply";
export const strandsIntentToolName = "update_intent";
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
  modelInput?: string;
  tools: AgentToolRegistry;
  toolExecutor: AgentToolExecutor;
  effectiveIntent?: EffectiveIntent;
  cancelSignal?: AbortSignal;
  limits?: { maxTurns?: number; maxToolCalls?: number; maxExecutionMs?: number; maxTotalTokens?: number; maxOutputTokens?: number };
  reserveToolCall?: () => boolean;
  intentController?: ServerAgentIntentController;
}
export interface StrandsAgentRunResult {
  /** Not public text. The Application admits the typed proposal separately. */
  replyProposal?: AgentV2ReplyProposal;
  /** Latest Application-owned snapshot, also used at the reply publication boundary. */
  effectiveIntent?: EffectiveIntent;
  stopReason: string;
  evidence: Evidence[];
  trace: AgentTrace;
  limitReason?: "tool_calls" | "deadline";
  metrics?: { modelCalls: number; toolCalls: number; inputTokens: number; outputTokens: number; totalTokens: number;
    cacheReadInputTokens?: number; cacheWriteInputTokens?: number };
}
export interface StrandsAgentLike {
  invoke(args: string, options?: {
    cancelSignal?: AbortSignal;
    limits?: { turns?: number; totalTokens?: number; outputTokens?: number };
  }): Promise<{
    stopReason: string;
    lastMessage?: unknown;
    metrics?: { cycleCount: number;
      accumulatedUsage: { inputTokens: number; outputTokens: number; totalTokens: number;
        cacheReadInputTokens?: number; cacheWriteInputTokens?: number };
      toolMetrics: Record<string, { callCount: number }> };
  }>;
}
export type StrandsAgentFactory = (config: AgentConfig) => StrandsAgentLike;

/** Strands owns the loop. This adapter provides scoped Tools and a reply channel,
 * not planning phases, text repairs or a second source of Conversation state. */
export class StrandsAgentEngine {
  private readonly createAgent: StrandsAgentFactory;
  private readonly model?: Model<BaseModelConfig>;
  constructor(private readonly options: StrandsAgentEngineOptions,
    dependencies: { createAgent?: StrandsAgentFactory; model?: Model<BaseModelConfig> } = {}) {
    this.model = dependencies.model;
    this.createAgent = dependencies.createAgent ?? ((config) => new Agent(config));
  }
  async run(input: StrandsAgentRunInput): Promise<StrandsAgentRunResult> {
    if (!input.executionId.trim() || !input.userRequest.trim()) throw new Error("Strands Agent requires executionId and userRequest");
    if (input.tools.descriptors().some(({ name }) => [strandsReplyToolName, strandsIntentToolName].includes(name))) throw new Error("Reserved Agent v2 tool name");
    const evidence: Evidence[] = [], submission = new AgentV2ReplySubmission();
    let currentEffectiveIntent = input.effectiveIntent, intentAttempted = false, intentUnavailable = false;
    const trace = new AgentTraceRecorder(input.executionId, { omitContent: true });
    trace.taskStarted(input.userRequest);
    const budgetState = { toolCalls: 0, toolLimitReached: false };
    const tools = createStrandsReadTools({
      registry: input.tools, executor: input.toolExecutor, executionId: input.executionId,
      getEffectiveIntent: () => currentEffectiveIntent, toolTimeoutMs: this.options.toolTimeoutMs ?? 20_000,
      trace, evidence, budgetState, maxToolCalls: input.limits?.maxToolCalls,
      reserveToolCall: input.reserveToolCall, canExecute: () => !submission.submitted && !intentUnavailable,
    });
    const intentController = input.intentController;
    if (intentController) tools.push(tool({
      name: strandsIntentToolName,
      description: "Submit one bounded semantic delta from the current userMessage when it adds, corrects, retracts or narrows accepted travel conditions. Quotes must be exact substrings of the current userMessage. The Application validates and commits the delta before any later read Tool uses it. Do not call this for unchanged conversation or after submit_reply.",
      inputSchema: semanticInterpretationOutputContract.schema as JSONSchema,
      callback: async (value, context) => {
        if (submission.submitted) return jsonValue({ ok: false, error: { code: "reply_submitted", retryable: false } });
        if (context?.cancelSignal.aborted) return jsonValue({ ok: false, error: { code: "execution_failed", retryable: true } });
        if (intentAttempted) return jsonValue({ ok: false, error: { code: "intent_update_limit", retryable: false } });
        intentAttempted = true;
        const interpretation = decodeUtteranceInterpretation(value);
        if (!interpretation || interpretation.outcome !== "delta") {
          return jsonValue({ ok: false, error: { code: "intent_rejected", retryable: false } });
        }
        try {
          const accepted = await intentController.apply(interpretation);
          currentEffectiveIntent = accepted.effectiveIntent;
          return jsonValue({ ok: true, receipt: accepted.receipt, effectiveIntent: accepted.effectiveIntent });
        } catch (error) {
          if (error instanceof ServerAgentIntentRejectedError) {
            return jsonValue({ ok: false, error: { code: "intent_rejected", retryable: false } });
          }
          // A commit or refresh may have failed after persistence. Never publish
          // against the old snapshot or turn an ambiguous write into a rejection.
          intentUnavailable = true;
          return jsonValue({ ok: false, error: { code: "intent_unavailable", retryable: false } });
        }
      },
    }));
    tools.push(tool({
      name: strandsReplyToolName,
      description: "Submit one reply after any necessary reads, then stop. Use answer with references to actual Evidence fields and optional evidence-bound commentary; candidates with evidenceIds selected from candidateReferences and required commentary explaining your selection; conversation with a message key; clarification with a missing target; unavailable with an operation; operation_result only with an Application receipt ID; uncertainty for unverified information. Never supply card payloads, new factual values, reasoning, or fabricated operation results. This does not save, book or pay.",
      inputSchema: agentV2ReplySchema as JSONSchema,
      callback: (value) => jsonValue(submission.receive(value)),
    }));
    const agent = this.createAgent({
      model: this.model ?? new BedrockModel({ modelId: this.options.modelId, region: this.options.region,
        maxTokens: this.options.maxOutputTokens ?? 2_048, temperature: 0, stream: false }),
      tools, systemPrompt: this.options.systemPrompt,
      printer: false, contextManager: false, retryStrategy: null, toolExecutor: "sequential",
    });
    const startedAt = Date.now();
    const deadlineSignal = input.limits?.maxExecutionMs ? AbortSignal.timeout(input.limits.maxExecutionMs) : undefined;
    const cancelSignal = combineSignals(input.cancelSignal, deadlineSignal);
    try {
      const result = await agent.invoke(input.modelInput ?? input.userRequest, {
        ...(cancelSignal ? { cancelSignal } : {}), limits: {
          turns: input.limits?.maxTurns ?? this.options.maxTurns ?? 8,
          ...(input.limits?.maxTotalTokens ?? this.options.maxTotalTokens
            ? { totalTokens: input.limits?.maxTotalTokens ?? this.options.maxTotalTokens } : {}),
          ...(input.limits?.maxOutputTokens ?? this.options.maxOutputTokens
            ? { outputTokens: input.limits?.maxOutputTokens ?? this.options.maxOutputTokens } : {}),
        },
      });
      if (intentUnavailable) throw new ServerAgentRuntimeExecutionError("intent_state", "unknown");
      // Neither lastMessage nor SDK debug/string output crosses the publication boundary.
      trace.taskCompleted(result.stopReason === "cancelled" ? "cancelled" : "completed", Date.now() - startedAt,
        result.stopReason === "endTurn" ? undefined : result.stopReason);
      const usage = result.metrics?.accumulatedUsage, replyProposal = submission.snapshot();
      return {
        ...(replyProposal ? { replyProposal } : {}), stopReason: result.stopReason,
        ...(currentEffectiveIntent ? { effectiveIntent: structuredClone(currentEffectiveIntent) } : {}),
        evidence: evidence.map((item) => structuredClone(item)), trace: trace.snapshot(),
        ...(budgetState.toolLimitReached ? { limitReason: "tool_calls" as const } : {}),
        ...(result.stopReason === "cancelled" && deadlineSignal?.aborted ? { limitReason: "deadline" as const } : {}),
        ...(result.metrics && usage ? { metrics: {
          modelCalls: result.metrics.cycleCount,
          // Local intent/reply operations are not external Domain Tool calls.
          toolCalls: budgetState.toolCalls,
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
          ...(usage.cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens: usage.cacheReadInputTokens }),
          ...(usage.cacheWriteInputTokens === undefined ? {} : { cacheWriteInputTokens: usage.cacheWriteInputTokens }),
        } } : {}),
      };
    } catch (error) {
      trace.taskCompleted("failed", Date.now() - startedAt, error instanceof Error ? error.name : "unknown_error");
      if (error instanceof ServerAgentRuntimeExecutionError) throw error;
      throw new ServerAgentRuntimeExecutionError("agent_invoke", runtimeFailureKind(error));
    }
  }
}
export function createStrandsReadTools(input: {
  registry: AgentToolRegistry; executor: AgentToolExecutor; executionId: string; getEffectiveIntent?: () => EffectiveIntent | undefined;
  toolTimeoutMs: number; trace: AgentTraceRecorder; evidence: Evidence[];
  budgetState?: { toolCalls: number; toolLimitReached: boolean }; maxToolCalls?: number;
  reserveToolCall?: () => boolean; canExecute?: () => boolean;
}): InvokableTool<unknown, JSONValue>[] {
  return input.registry.descriptors().filter(({ name }) => input.registry.effect(name) === "read").map((descriptor) => tool({
    name: descriptor.name, description: descriptor.description, inputSchema: descriptor.inputSchema as JSONSchema,
    callback: async (rawInput, context) => {
      const toolInput = jsonObject(rawInput);
      if (!toolInput) return jsonValue({ ok: false, error: { code: "invalid_input", retryable: false } });
      if (input.canExecute && !input.canExecute()) return jsonValue({ ok: false, error: { code: "reply_submitted", retryable: false } });
      const effectiveIntent = input.getEffectiveIntent?.();
      const decision = validateToolIntentUse(descriptor, toolInput, effectiveIntent);
      if (!decision.accepted) return jsonValue({ ok: false, error: {
        code: decision.error?.code ?? "precondition_failed", retryable: decision.error?.retryable ?? false } });
      if (context?.cancelSignal.aborted) return jsonValue({ ok: false, error: { code: "execution_failed", retryable: true } });
      if (input.maxToolCalls !== undefined && (input.budgetState?.toolCalls ?? 0) >= input.maxToolCalls ||
          input.reserveToolCall && !input.reserveToolCall()) {
        if (input.budgetState) input.budgetState.toolLimitReached = true;
        return jsonValue({ ok: false, error: { code: "execution_failed", retryable: false, reason: "tool_budget" } });
      }
      if (input.budgetState) input.budgetState.toolCalls += 1;
      let execution;
      try {
        execution = await input.executor.execute({
          executionId: input.executionId, toolCallId: context?.toolUse.toolUseId ?? `strands-${descriptor.name}`,
          toolName: descriptor.name, toolInput, timeoutMs: input.toolTimeoutMs,
          // Bind every V2 read to its Application snapshot, even where a Tool has no
          // field-level intent policy. A later intent update cannot relabel old reads.
          ...(effectiveIntent ? { intentDependency: {
            intentRevision: effectiveIntent.intentRevision, fingerprint: effectiveIntent.fingerprint,
            targets: decision.dependencyTargets } } : {}),
        }, input.trace);
      } catch (error) {
        throw new ServerAgentRuntimeExecutionError("read_tool", runtimeFailureKind(error));
      }
      if (execution.evidence.length) input.evidence.push(...execution.evidence.map((item) => structuredClone(item)));
      if (!execution.result.ok) return jsonValue({ ok: false, error: {
        code: execution.result.error.code, retryable: execution.result.error.retryable } });
      return jsonValue({ ok: true, output: execution.result.output, evidenceIds: execution.evidence.map(({ id }) => id),
        candidateReferences: agentV2CandidateReferences(execution.evidence, effectiveIntent),
        replyReferences: execution.evidence.map((item) => ({ evidenceId: item.id,
          fields: Object.fromEntries(Object.entries(item.facts).filter(([key]) => publicReplyField(key))) })) });
    },
  }));
}
function runtimeFailureKind(error: unknown): ServerAgentRuntimeFailureKind {
  const name = error instanceof Error ? error.name : "";
  if (/abort/iu.test(name)) return "abort";
  if (/timeout/iu.test(name)) return "timeout";
  if (/(?:service|throttl|quota|bedrock|model)/iu.test(name)) return "provider";
  if (/(?:validation|schema|invalid|type)/iu.test(name)) return "validation";
  return "unknown";
}
function jsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
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
