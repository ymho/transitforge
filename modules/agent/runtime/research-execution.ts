import type { AgentTrace } from "./agent-trace";
import type { ModelTokenRates } from "./model-usage-cost";
import { estimateModelUsageCost } from "./model-usage-cost";
import type { AgentModelUsage } from "./model-provider";
import type { ResearchBudget, ResearchBudgetStopReason } from "./research-budget";

export type ResearchExternalCall = "provider_read" | "rerank" | "knowledge_base" | "save";

export interface ResearchExecutionUsage {
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly providerReads: number;
  readonly rerankCalls: number;
  readonly knowledgeBaseCalls: number;
  readonly saveCalls: number;
  readonly retries: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly cache: Readonly<Record<"read" | "write" | "miss" | "unknown" | "disabled", number>>;
  readonly wallClockMs: number;
  readonly estimatedCostUsd?: number;
  readonly pricingVersion?: string;
  readonly costComplete: boolean;
  readonly measurementCoverage: Readonly<Record<"modelCalls" | "toolCalls" | "providerReads" | "rerankCalls" | "knowledgeBaseCalls" | "saveCalls" | "retries" | "tokens" | "cache" | "cost", boolean>>;
}

export interface ResearchExecutionOutcome {
  readonly version: "research-execution-v1";
  readonly policyVersion: string;
  readonly requestedMode: "standard" | "detailed";
  readonly effectiveMode: "standard" | "detailed";
  readonly status: "completed" | "partial" | "failed" | "stopped";
  readonly usage: ResearchExecutionUsage;
  readonly coveredScopes: readonly string[];
  readonly remainingScopes: readonly string[];
  /** Server-issued locator only. Resolution always rechecks owner/conversation/Trip/revision; possession grants no authority. */
  readonly continuation?: { readonly kind: "receipt-result" | "new-turn-request"; readonly issuedBy: "server"; readonly ref: string; readonly expiresAt: string };
  readonly stopReason?: ResearchBudgetStopReason | "provider_failure" | "user_stopped";
}

type ReservedCounter = "modelCalls" | "toolCalls" | "providerReads" | "rerankCalls" | "knowledgeBaseCalls" | "saveCalls";

/**
 * Per-turn accounting only. Callers reserve synchronously before an external call, then record
 * provider usage after it settles. It intentionally stores no prompt, document, profile or private reasoning.
 */
export class ResearchExecutionLedger {
  private readonly startedAt: number;
  private readonly reserved: Record<ReservedCounter, number> = { modelCalls: 0, toolCalls: 0, providerReads: 0,
    rerankCalls: 0, knowledgeBaseCalls: 0, saveCalls: 0 };
  private readonly tokens = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
  private readonly cache = { read: 0, write: 0, miss: 0, unknown: 0, disabled: 0 };
  private readonly covered = new Set<string>();
  private readonly deferred = new Set<string>();
  private retries = 0;
  private estimatedCostUsd = 0;
  private costComplete = true;
  private pricingVersion?: string;
  private readonly measured: Set<keyof ResearchExecutionUsage["measurementCoverage"]>;

  constructor(readonly budget: ResearchBudget, readonly mode: { requestedMode: "standard" | "detailed"; effectiveMode: "standard" | "detailed" },
    private readonly now: () => number = Date.now, measuredFields: readonly (keyof ResearchExecutionUsage["measurementCoverage"])[] =
      ["modelCalls", "toolCalls", "providerReads", "rerankCalls", "knowledgeBaseCalls", "saveCalls", "retries", "tokens", "cache", "cost"]) {
    this.startedAt = now();
    this.measured = new Set(measuredFields);
    if (mode.requestedMode === "standard" && mode.effectiveMode === "detailed") throw new Error("Research mode exceeds user request");
  }

  reserve(counter: ReservedCounter, amount = 1): boolean {
    return this.reserveAll([{ counter, amount }]);
  }

  /** Atomically reserves a compound external boundary; no counter changes unless every limit admits the call. */
  reserveAll(entries: readonly { counter: ReservedCounter; amount?: number }[]): boolean {
    if (!entries.length || this.deadlineReached()) return false;
    const requested = new Map<ReservedCounter, number>();
    for (const { counter, amount = 1 } of entries) {
      if (!Number.isSafeInteger(amount) || amount < 1) return false;
      requested.set(counter, (requested.get(counter) ?? 0) + amount);
    }
    for (const [counter, amount] of requested) {
      if (this.reserved[counter] + amount > this.maximum(counter)) return false;
    }
    for (const [counter, amount] of requested) this.reserved[counter] += amount;
    return true;
  }

  recordModel(usage: AgentModelUsage | undefined, cacheStatus: keyof ResearchExecutionUsage["cache"], rates?: ModelTokenRates): void {
    this.cache[cacheStatus] += 1;
    for (const key of Object.keys(this.tokens) as Array<keyof typeof this.tokens>) {
      const value = usage?.[key];
      if (value !== undefined) {
        if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid model usage");
        this.tokens[key] += value;
      }
    }
    if (!rates) { this.costComplete = false; return; }
    if (this.pricingVersion && this.pricingVersion !== rates.pricingVersion) throw new Error("Pricing version changed during execution");
    this.pricingVersion = rates.pricingVersion;
    const cost = estimateModelUsageCost(usage, rates);
    if (cost.estimatedCostUsd === undefined) this.costComplete = false;
    else this.estimatedCostUsd += cost.estimatedCostUsd;
  }

  recordRetry(): void { this.retries += 1; }
  markMeasured(...fields: Array<keyof ResearchExecutionUsage["measurementCoverage"]>): void { fields.forEach((field) => this.measured.add(field)); }
  cover(scope: string): void { if (!validRef(scope)) throw new Error("Invalid covered scope"); this.covered.add(scope); }
  defer(scope: string): void { if (!validRef(scope)) throw new Error("Invalid remaining scope"); this.deferred.add(scope); }
  deadlineReached(): boolean { return this.now() - this.startedAt >= this.budget.deadlineMs; }

  outcome(input: { remainingScopes: readonly string[]; continuation?: ResearchExecutionOutcome["continuation"];
    stopReason?: ResearchExecutionOutcome["stopReason"]; failed?: boolean }): ResearchExecutionOutcome {
    const remaining = uniqueRefs([...this.deferred, ...input.remainingScopes]);
    const deferredWithoutContinuation = this.deferred.size > 0 && !input.continuation;
    if (remaining.length && !input.continuation && !input.failed && !deferredWithoutContinuation && input.stopReason !== "needs_user_input") {
      throw new Error("Partial research requires a continuation reference");
    }
    if (input.continuation && (!validRef(input.continuation.ref) || !validInstant(input.continuation.expiresAt) || input.continuation.issuedBy !== "server" ||
      !["receipt-result", "new-turn-request"].includes(input.continuation.kind))) throw new Error("Invalid continuation");
    const limitExceeded = this.deadlineReached() || this.reserved.modelCalls > this.budget.maximumModelCalls ||
      this.reserved.toolCalls > this.budget.maximumToolCalls || this.tokens.inputTokens > this.budget.maximumInputTokens ||
      this.tokens.outputTokens > this.budget.maximumOutputTokens || this.costLimitExceeded();
    const stopReason = input.stopReason ?? (this.deadlineReached() ? "deadline" : limitExceeded || deferredWithoutContinuation ? "budget_exhausted" : undefined);
    const status = input.failed || deferredWithoutContinuation ? "failed" : stopReason === "user_stopped" ? "stopped" : remaining.length ? "partial" : stopReason ? "failed" : "completed";
    return structuredClone({ version: "research-execution-v1", policyVersion: this.budget.policyVersion,
      requestedMode: this.mode.requestedMode, effectiveMode: this.mode.effectiveMode, status,
      usage: { ...this.reserved, retries: this.retries, ...this.tokens, cache: this.cache,
        wallClockMs: Math.max(0, this.now() - this.startedAt),
        ...(this.costComplete && this.pricingVersion ? { estimatedCostUsd: this.estimatedCostUsd, pricingVersion: this.pricingVersion } : {}),
        costComplete: this.costComplete && this.pricingVersion !== undefined,
        measurementCoverage: Object.fromEntries(["modelCalls", "toolCalls", "providerReads", "rerankCalls", "knowledgeBaseCalls", "saveCalls", "retries", "tokens", "cache", "cost"]
          .map((field) => [field, this.measured.has(field as keyof ResearchExecutionUsage["measurementCoverage"])])) as ResearchExecutionUsage["measurementCoverage"] },
      coveredScopes: [...this.covered].sort(), remainingScopes: remaining.sort(),
      ...(input.continuation ? { continuation: input.continuation } : {}), ...(stopReason ? { stopReason } : {}) }) as ResearchExecutionOutcome;
  }

  private costLimitExceeded(): boolean {
    return this.budget.estimatedCostLimitUsd !== undefined && this.costComplete && this.estimatedCostUsd >= this.budget.estimatedCostLimitUsd;
  }

  private maximum(counter: ReservedCounter): number {
    return counter === "modelCalls" ? this.budget.maximumModelCalls : counter === "toolCalls" ? this.budget.maximumToolCalls :
      counter === "rerankCalls" ? this.budget.maximumRerankCalls : counter === "knowledgeBaseCalls" ? this.budget.maximumKnowledgeBaseCalls :
      counter === "providerReads" ? this.budget.maximumProviderReadCalls : 1;
  }
}

export function parseResearchExecutionOutcome(value: unknown): ResearchExecutionOutcome {
  if (!record(value) || !only(value, ["version", "policyVersion", "requestedMode", "effectiveMode", "status", "usage", "coveredScopes", "remainingScopes", "continuation", "stopReason"]) ||
      value.version !== "research-execution-v1" || !validRef(value.policyVersion) || !["standard", "detailed"].includes(String(value.requestedMode)) ||
      !["standard", "detailed"].includes(String(value.effectiveMode)) || value.requestedMode === "standard" && value.effectiveMode === "detailed" ||
      !["completed", "partial", "failed", "stopped"].includes(String(value.status)) || !Array.isArray(value.coveredScopes) || !Array.isArray(value.remainingScopes)) throw new Error("Invalid research execution");
  const coveredScopes = uniqueRefs(value.coveredScopes as string[]), remainingScopes = uniqueRefs(value.remainingScopes as string[]);
  const usage = value.usage;
  if (!record(usage) || !only(usage, ["modelCalls", "toolCalls", "providerReads", "rerankCalls", "knowledgeBaseCalls", "saveCalls", "retries", "inputTokens", "outputTokens", "cacheReadInputTokens", "cacheWriteInputTokens", "cache", "wallClockMs", "estimatedCostUsd", "pricingVersion", "costComplete", "measurementCoverage"]) ||
      ["modelCalls", "toolCalls", "providerReads", "rerankCalls", "knowledgeBaseCalls", "saveCalls", "retries", "inputTokens", "outputTokens", "cacheReadInputTokens", "cacheWriteInputTokens", "wallClockMs"].some((key) => !count(usage[key])) ||
      typeof usage.costComplete !== "boolean" || !record(usage.cache) || !only(usage.cache, ["read", "write", "miss", "unknown", "disabled"]) ||
      Object.values(usage.cache).some((item) => !count(item)) || !record(usage.measurementCoverage) ||
      !only(usage.measurementCoverage, ["modelCalls", "toolCalls", "providerReads", "rerankCalls", "knowledgeBaseCalls", "saveCalls", "retries", "tokens", "cache", "cost"]) ||
      Object.values(usage.measurementCoverage).some((item) => typeof item !== "boolean") || (usage.estimatedCostUsd !== undefined && (typeof usage.estimatedCostUsd !== "number" || !Number.isFinite(usage.estimatedCostUsd) || usage.estimatedCostUsd < 0)) ||
      (usage.estimatedCostUsd === undefined) !== (usage.pricingVersion === undefined) || usage.pricingVersion !== undefined && !validRef(usage.pricingVersion)) throw new Error("Invalid research usage");
  if (value.stopReason !== undefined && !["budget_exhausted", "deadline", "rate_limited", "needs_user_input", "provider_failure", "user_stopped"].includes(String(value.stopReason))) throw new Error("Invalid research stop reason");
  if (value.continuation !== undefined && (!record(value.continuation) || !only(value.continuation, ["kind", "issuedBy", "ref", "expiresAt"]) ||
      !["receipt-result", "new-turn-request"].includes(String(value.continuation.kind)) || value.continuation.issuedBy !== "server" ||
      !validRef(value.continuation.ref) || typeof value.continuation.expiresAt !== "string" || !validInstant(value.continuation.expiresAt))) throw new Error("Invalid research continuation");
  if (value.status === "completed" && (remainingScopes.length || value.stopReason !== undefined || value.continuation !== undefined) ||
      value.status === "partial" && (!remainingScopes.length || value.continuation === undefined)) throw new Error("Inconsistent research outcome");
  return structuredClone({ ...value, coveredScopes, remainingScopes }) as unknown as ResearchExecutionOutcome;
}

/** Reserve the single immutable turn-result save before calling the repository. Retry readback never calls this. */
export function reserveResearchResultSave(value: ResearchExecutionOutcome): ResearchExecutionOutcome {
  const parsed = parseResearchExecutionOutcome(value);
  if (parsed.usage.measurementCoverage.saveCalls || parsed.usage.saveCalls !== 0) throw new Error("Research result save already reserved");
  return parseResearchExecutionOutcome({ ...parsed, usage: { ...parsed.usage, saveCalls: 1,
    measurementCoverage: { ...parsed.usage.measurementCoverage, saveCalls: true } } });
}

/** Reconstructs the same public accounting from the bounded runtime trace; no prompt text is read. */
export function summarizeResearchTrace(trace: AgentTrace, budget: ResearchBudget, mode: ResearchExecutionLedger["mode"], ratesForModel?: (model: string | undefined) => ModelTokenRates | undefined): ResearchExecutionOutcome {
  const times = trace.events.map((event) => Date.parse(event.occurredAt)).filter(Number.isFinite);
  const clock = sequenceClock(times.length ? Math.min(...times) : 0, times.length ? Math.max(...times) : 0);
  const ledger = new ResearchExecutionLedger(budget, mode, clock.now, ["modelCalls", "toolCalls", "tokens", "cache", "cost"]);
  for (const event of trace.events) {
    clock.advance(Date.parse(event.occurredAt));
    if (event.type === "model_started") ledger.reserve("modelCalls");
    if (event.type === "model_completed") ledger.recordModel({ inputTokens: event.inputTokens, outputTokens: event.outputTokens,
      totalTokens: event.totalTokens, cacheReadInputTokens: event.cacheReadInputTokens, cacheWriteInputTokens: event.cacheWriteInputTokens }, event.cacheStatus ?? "unknown", ratesForModel?.(event.model));
    if (event.type === "tool_called") ledger.reserve("toolCalls");
  }
  const terminal = [...trace.events].reverse().find((event) => event.type === "task_completed");
  const failed = terminal?.type === "task_completed" && terminal.status === "failed";
  return ledger.outcome({ remainingScopes: [], ...(failed ? { failed: true, stopReason: "provider_failure" } : {}) });
}

export function researchBudgetForRuntimeLimits(limits: { maxModelCalls: number; maxToolCalls: number; maxExecutionMs: number },
  policyVersion: string, maximumParallelReads = 3): ResearchBudget {
  if (!validRef(policyVersion) || ![limits.maxModelCalls, limits.maxToolCalls, limits.maxExecutionMs, maximumParallelReads].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("Invalid runtime research budget");
  return { policyVersion, maximumModelCalls: limits.maxModelCalls, maximumToolCalls: limits.maxToolCalls,
    maximumCandidates: 20, maximumDocuments: limits.maxToolCalls * 6, maximumProviderReadCalls: limits.maxToolCalls * 6, maximumBytes: 180_000,
    maximumInputTokens: 1_000_000, maximumOutputTokens: 250_000, maximumRerankCalls: limits.maxToolCalls,
    maximumKnowledgeBaseCalls: limits.maxToolCalls, maximumParallelReads: Math.min(8, maximumParallelReads), deadlineMs: limits.maxExecutionMs };
}

function uniqueRefs(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > 100 || values.some((value) => !validRef(value))) throw new Error("Invalid remaining scopes");
  return [...new Set(values)];
}
function validRef(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(value); }
function validInstant(value: string): boolean { return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function only(value: Record<string, unknown>, keys: readonly string[]): boolean { const allowed = new Set(keys); return Object.keys(value).every((key) => allowed.has(key)); }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function sequenceClock(start: number, end: number) { let current = start; return { now: () => current, advance(value: number) { if (Number.isFinite(value)) current = Math.max(current, Math.min(value, end)); } }; }
