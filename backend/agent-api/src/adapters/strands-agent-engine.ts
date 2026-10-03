import {
  Agent, BedrockModel, StructuredOutputError, tool,
  type AgentConfig, type BaseModelConfig, type InvokableTool,
  type JSONSchema, type JSONValue, type Model, type MessageData,
} from "@strands-agents/sdk";
import { AgentTraceRecorder, type AgentTrace } from "@raiquora/agent/agent-trace";
import { validateToolIntentUse } from "@raiquora/agent/intent-action-policy";
import type { EffectiveIntent } from "@raiquora/agent/effective-intent";
import { mergeEvidenceObservations, type Evidence } from "@raiquora/agent/evidence-model";
import type { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import type { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { AgentV2ReplyError, agentV2StructuredOutputSchema, type AgentV2ReplyProposal } from "@raiquora/agent/agent-v2-reply";
import { admitAgentV2Reply, agentV2CandidateReferences, agentV2ReplyReferences } from "@raiquora/agent/agent-v2-publication";
import { placeConditionUpdateInputSchema, partyConditionUpdateInputSchema, travelPeriodUpdateInputSchema, budgetConditionUpdateInputSchema,
  tripScenarioInputSchema, admitTripScenario, ConditionUpdateRejectedError, type ConversationConditionInput } from "@raiquora/agent/conversation-condition";
import { ServerAgentRuntimeExecutionError, type ServerAgentConditionController,
  type ServerAgentRuntimeFailureKind } from "../ports/server-agent-runtime.js";

export const strandsConditionToolNames = ["update_current_destination", "update_current_origin", "update_current_party", "update_current_travel_period", "update_current_budget", "consider_trip_scenario"] as const;
export interface StrandsAgentEngineOptions {
  modelId: string;
  region: string;
  systemPrompt: string;
  maxTurns?: number;
  maxTotalTokens?: number;
  /** Per model response, not cumulative invocation. */
  maxOutputTokens?: number;
  maxInvocationOutputTokens?: number;
  toolTimeoutMs?: number;
  /** Explicit Nova configuration selected by the composition root. */
  novaReasoningEffort?: "low";
}
export interface StrandsAgentRunInput {
  executionId: string;
  userRequest: string;
  modelInput?: string;
  /** Public owner-scoped history; no raw SDK Tool results or internal reasoning. */
  history?: MessageData[];
  tools: AgentToolRegistry;
  toolExecutor: AgentToolExecutor;
  effectiveIntent?: EffectiveIntent;
  initialEvidence?: Evidence[];
  maxEvidence?: number;
  cancelSignal?: AbortSignal;
  limits?: { maxTurns?: number; maxToolCalls?: number; maxExecutionMs?: number; maxTotalTokens?: number; maxOutputTokens?: number };
  reserveToolCall?: () => boolean;
  conditionController?: ServerAgentConditionController;
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
  metrics?: { modelCalls: number; toolCalls: number; conditionToolCalls: number; structuredOutputCalls: number;
    inputTokens: number; outputTokens: number; totalTokens: number;
    cacheReadInputTokens?: number; cacheWriteInputTokens?: number };
}
export interface StrandsAgentLike {
  invoke(args: string, options?: {
    cancelSignal?: AbortSignal;
    limits?: { turns?: number; totalTokens?: number; outputTokens?: number };
  }): Promise<{
    stopReason: string;
    structuredOutput?: unknown;
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
    if (input.tools.descriptors().some(({ name }) => (strandsConditionToolNames as readonly string[]).includes(name))) throw new Error("Reserved Agent v2 tool name");
    const evidence: Evidence[] = [];
    let currentEffectiveIntent = input.effectiveIntent, intentUnavailable = false;
    const trace = new AgentTraceRecorder(input.executionId, { omitContent: true });
    trace.taskStarted(input.userRequest);
    const budgetState = { toolCalls: 0, toolLimitReached: false };
    const tools = createStrandsReadTools({
      registry: input.tools, executor: input.toolExecutor, executionId: input.executionId,
      getEffectiveIntent: () => currentEffectiveIntent, toolTimeoutMs: this.options.toolTimeoutMs ?? 20_000,
      trace, evidence, budgetState, maxToolCalls: input.limits?.maxToolCalls,
      reserveToolCall: input.reserveToolCall, canExecute: () => !intentUnavailable,
    });
    const controller = input.conditionController;
    if (controller) {
      const apply = async (change: ConversationConditionInput, signal?: AbortSignal): Promise<JSONValue> => {
        if (signal?.aborted) throw new Error("execution_cancelled");
        if (intentUnavailable) throw new Error("condition_unavailable");
        try {
          // Application owns operation identity, replay, rejection and current state.
          // A repeated target is not evidence that this particular change was accepted.
          const accepted = await controller.apply(change);
          currentEffectiveIntent = accepted.effectiveIntent;
          // The model only needs the acceptance receipt. The authoritative effectiveIntent
          // stays Application-owned and is bound to later reads through getEffectiveIntent.
          return jsonValue({ ok: true, status: "applied", receipt: accepted.receipt,
            scope: "consultation_conditions_only", itineraryItemsChanged: false,
            researchPerformed: false });
        } catch (error) {
          if (error instanceof ConditionUpdateRejectedError) throw error;
          // The SDK reports Tool errors. An uncertain write additionally closes reads
          // and publication; no recovery by reinterpreting or repairing the user input.
          intentUnavailable = true;
          throw new Error("condition_unavailable");
        }
      };
      tools.push(
        tool({ name: "update_current_destination", inputSchema: placeConditionUpdateInputSchema,
          description: "今回の相談の行き先について、利用者自身の行きたい場所の希望・訂正・明示撤回を1回で受理する。日程未定の希望や、魅力・見どころを尋ねる質問と一緒に述べた希望も対象。検索Toolは相談条件を保存しないため、このToolで希望を受理した上で質問にも答える。設定/訂正はaction=set、未定に戻す明示はaction=clear。訂正でclear→setの2操作に分けない。仮定・what-if・比較だけ、変更なしでは使わない。Tripやプロフィールは変更しない。",
          callback: (value, context) => apply(value.action === "set"
            ? { target: "destination", place: value.place!, quote: value.quote }
            : { target: "destination", place: null, quote: value.quote }, context?.cancelSignal) }),
        tool({ name: "update_current_origin", inputSchema: placeConditionUpdateInputSchema,
          description: "今回の相談の出発地について、利用者が実際の条件として設定・訂正・明示撤回した最終状態を1回で反映する。設定/訂正はaction=set、未定に戻す明示はaction=clear。訂正でclear→setの2操作に分けない。普段の出発地の推測、仮定・what-if・比較だけ、変更なしでは使わない。Tripやプロフィールは変更しない。",
          callback: (value, context) => apply(value.action === "set"
            ? { target: "origin", place: value.place!, quote: value.quote }
            : { target: "origin", place: null, quote: value.quote }, context?.cancelSignal) }),
        tool({ name: "update_current_party", inputSchema: partyConditionUpdateInputSchema,
          description: "今回の旅行で実際に採用する現在の人数条件だけを永続更新する。利用者が現在条件として採用・訂正した場合はaction=set、人数を未定に戻す明示はaction=clear。合計人数だけならparty.kind=countを使い、大人/子どもの内訳を推測しない。大人/子どもの人数が明示された場合だけparty.kind=compositionを使う。年齢・年代・関係性は扱わない。仮定・反実仮想・what-if・比較では使わず、consider_trip_scenarioを使う。プロフィールは変更しない。",
          callback: (value, context) => apply(value.action === "set"
            ? { target: "party_size", party: value.party!, quote: value.quote }
            : { target: "party_size", party: null, quote: value.quote }, context?.cancelSignal) }),
        tool({ name: "update_current_travel_period", inputSchema: travelPeriodUpdateInputSchema,
          description: "今回の旅行で実際に採用する旅行期間の最終状態を1回で永続更新する。設定・訂正はaction=set、日程全体を未定へ戻す明示はaction=clear。start/end/durationは今回の発言で明示したものだけ指定する。外側quoteをApplicationが月・日・泊数/日数の根拠として検証する。日付はcalendar_dateでdayを必須、monthは明示または開始日から同月と読める場合、yearは利用者が年を明示した場合だけ設定する。年未指定はApplicationが基準日以降で最初に来る月日へ決める。今日/明日/明後日はrelative_date。以前のduration等を持ち越さず、日付や日数を推測・補完しない。what-if・比較ではconsider_trip_scenarioを使う。",
          callback: (value, context) => apply(value.action === "set"
            ? { target: "travel_period", period: value.period!, quote: value.quote }
            : { target: "travel_period", period: null, quote: value.quote }, context?.cancelSignal) }),
        tool({ name: "update_current_budget", inputSchema: budgetConditionUpdateInputSchema,
          description: "今回の旅行で実際に採用する予算条件を永続更新する。設定・訂正はaction=set、予算を未定に戻す明示はaction=clear。amountは通貨のmajor unitで指定し、5万円は50000。currencyは利用者が通貨を明示した場合だけ、basisは旅行全体か1人あたりかを明示した場合だけ指定する。Applicationがquoteから金額・通貨・basisを再検証し、モデルの推測は保存しない。what-if・比較ではconsider_trip_scenarioを使う。プロフィールは変更しない。",
          callback: (value, context) => apply(value.action === "set"
            ? { target: "budget", budget: value.budget!, quote: value.quote }
            : { target: "budget", budget: null, quote: value.quote }, context?.cancelSignal) }),
        tool({ name: "consider_trip_scenario", inputSchema: tripScenarioInputSchema,
          description: "現在の実旅行条件を一切変更せず、人数・旅行期間・予算の仮定、反実仮想、what-if、シナリオ比較を考える非永続Tool。成功時点でactual条件はすでに保持されているため、元の値へ戻す・維持する目的でupdate_current_*を呼ばない。同じuserMessageに仮定とは別の明示的なactual変更がある場合だけ、その変更に対応するwriterを別途使う。保存・A commit・Intent revision更新を行わない。",
          callback: (value, context) => {
            if (context?.cancelSignal.aborted) throw new Error("execution_cancelled");
            const scenario = admitTripScenario(value, input.userRequest);
            return jsonValue({ ok: true, scenario, currentConditionsUnchanged: true,
              actualConditionWriteRequired: false, restoreCurrentConditions: false });
          } }),
      );
    }
    const baseModel = this.model ?? new BedrockModel({ modelId: this.options.modelId, region: this.options.region,
      maxTokens: this.options.maxOutputTokens ?? 2_048, temperature: 0, stream: false,
      // Provider configuration is explicit; isolated engines keep their existing budgets/configuration.
      ...(this.options.novaReasoningEffort ? {
        additionalRequestFields: { reasoningConfig: { type: "enabled", maxReasoningEffort: this.options.novaReasoningEffort } },
      } : {}) });
    // Reuse Application admission in the SDK's native validation feedback. This
    // does not repair a reply, start another invoke, or bypass final publication.
    const validatedOutputSchema = agentV2StructuredOutputSchema.superRefine(({ reply }, context) => {
      const merged = mergeEvidenceObservations([], [...(input.initialEvidence ?? []), ...evidence], input.maxEvidence);
      if (merged.collisions.length || merged.conflictingObservationIds.length) {
        context.addIssue({ code: "custom", message: "evidence_collision", path: ["reply"] });
        return;
      }
      try {
        admitAgentV2Reply(reply, { executionId: input.executionId, evidence: merged.evidence,
          effectiveIntent: currentEffectiveIntent, receipts: [], availableOperations: [] });
      } catch (error) {
        if (!(error instanceof AgentV2ReplyError)) throw error;
        context.addIssue({ code: "custom", path: ["reply"],
          message: `${error.code}: select an exact reference from the latest Tool replyReferences for facts; otherwise use a supported conversation, clarification, uncertainty or unavailable reply. Never invent fields, IDs or operation receipts.` });
      }
    });
    const agent = this.createAgent({
      model: baseModel,
      ...(input.history?.length ? { messages: input.history } : {}),
      structuredOutputSchema: validatedOutputSchema,
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
          ...(input.limits?.maxOutputTokens ?? this.options.maxInvocationOutputTokens
            ? { outputTokens: input.limits?.maxOutputTokens ?? this.options.maxInvocationOutputTokens } : {}),
        },
      });
      if (intentUnavailable) throw new ServerAgentRuntimeExecutionError("intent_state", "unknown");
      // Neither lastMessage nor SDK debug/string output crosses the publication boundary.
      trace.taskCompleted(result.stopReason === "cancelled" ? "cancelled" : "completed", Date.now() - startedAt,
        result.stopReason === "endTurn" ? undefined : result.stopReason);
      const usage = result.metrics?.accumulatedUsage;
      const parsed = result.structuredOutput === undefined ? undefined : agentV2StructuredOutputSchema.safeParse(result.structuredOutput);
      if (parsed && !parsed.success) throw new ServerAgentRuntimeExecutionError("runtime_projection", "validation");
      const replyProposal = parsed?.success ? parsed.data.reply : undefined;
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
          // SDK-owned/local Tools are not external reads, but their bounded call counts
          // distinguish a condition-write loop from structured-output retries.
          conditionToolCalls: strandsConditionToolNames.reduce((sum, name) =>
            sum + (result.metrics?.toolMetrics[name]?.callCount ?? 0), 0),
          structuredOutputCalls: result.metrics.toolMetrics.strands_structured_output?.callCount ?? 0,
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
          ...(usage.cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens: usage.cacheReadInputTokens }),
          ...(usage.cacheWriteInputTokens === undefined ? {} : { cacheWriteInputTokens: usage.cacheWriteInputTokens }),
        } } : {}),
      };
    } catch (error) {
      trace.taskCompleted("failed", Date.now() - startedAt, error instanceof Error ? error.name : "unknown_error");
      if (error instanceof ServerAgentRuntimeExecutionError) throw error;
      if (error instanceof StructuredOutputError) throw new ServerAgentRuntimeExecutionError("runtime_projection", "validation");
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
  return input.registry.descriptors().filter((descriptor) => input.registry.effect(descriptor.name) === "read" ||
    descriptor.effect === "proposal" && descriptor.requiredCapabilities?.includes("agent-v2-proposal")).map((descriptor) => tool({
    name: descriptor.name, description: descriptor.description, inputSchema: descriptor.inputSchema as JSONSchema,
    callback: async (rawInput, context) => {
      const toolInput = jsonObject(rawInput);
      if (!toolInput) return jsonValue({ ok: false, error: { code: "invalid_input", retryable: false } });
      if (input.canExecute && !input.canExecute()) return jsonValue({ ok: false, error: { code: "intent_unavailable", retryable: false } });
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
      // Purpose Tools already completed their research pipeline. Raw discovery,
      // page bodies and assessments duplicate the validated reply references and
      // are internal research state, not additional model work to perform.
      const output = ["explore_destination", "discover_destinations"].includes(descriptor.name)
        ? { outcome: jsonObject(execution.result.output)?.outcome }
        : execution.result.output;
      return jsonValue({ ok: true, output, evidenceIds: execution.evidence.map(({ id }) => id),
        candidateReferences: agentV2CandidateReferences(execution.evidence, effectiveIntent),
        replyReferences: agentV2ReplyReferences(execution.evidence, effectiveIntent) });
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
