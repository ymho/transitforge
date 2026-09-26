import type { TrustedPrincipal } from "../../contracts/trusted-principal.js";
import { MultiStepAgentRuntime, type AgentModelClassPolicy } from "@raiquora/agent/agent-runtime";
import type { AgentModelProvider } from "@raiquora/agent/model-provider";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import type { AgentRuntimeLimits } from "@raiquora/agent/runtime-policies";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import type { AgentRuntimeContextInput } from "@raiquora/agent/agent-decision-context";
import { requireTripPrincipal } from "../../contracts/trip-principal.js";
import type { AgentDiagnosticEvent, AgentDiagnosticsSink } from "../../ports/agent-diagnostics.js";
import { bindPublicPlanTarget } from "@raiquora/agent/public-plan-presentation";
import type { ResearchTarget } from "../../contracts/server-state.js";
import { ResearchExecutionLedger, researchBudgetForRuntimeLimits } from "@raiquora/agent/research-execution";
import { validateAgentRuntimeLimits } from "@raiquora/agent/runtime-policies";
import type { ModelTokenRates } from "@raiquora/agent/model-usage-cost";
import type { AgentProgressReporter } from "@raiquora/agent/agent-progress";
import { ServerAgentRuntimeExecutionError, type ServerAgentRuntimeRunner } from "../../ports/server-agent-runtime.js";
import { evidenceForCurrentIntent } from "@raiquora/agent/intent-action-policy";

/** Caller authenticates principal. Only an injected server loader may resolve references to state. */
export interface ServerAgentTurn {
  principal: TrustedPrincipal;
  userRequest: string;
  conversationId?: string;
  tripId?: string;
  uiContext?: { itemId?: string; calendarDate?: string };
  requestedResearchMode?: "standard" | "detailed";
  researchTarget?: ResearchTarget;
}
export interface ServerAgentScope extends ServerAgentTurn { executionId: string; researchMode: { requestedMode: "standard" | "detailed"; effectiveMode: "standard" | "detailed" } }
export interface ServerAgentDependencies {
  newExecutionId: () => string;
  createModel: (scope: ServerAgentScope) => AgentModelProvider;
  registerTools: (tools: AgentToolRegistry, evidence: ToolEvidenceRegistry, scope: ServerAgentScope) => void;
  limits?: Partial<AgentRuntimeLimits>;
  modelClassPolicy?: AgentModelClassPolicy;
  now?: () => Date;
  /** Trusted composition only; never supplied through the turn/request payload. */
  loadContext?: (scope: ServerAgentScope) => Promise<AgentRuntimeContextInput>;
  diagnostics?: AgentDiagnosticsSink;
  log?: (event: string, fields: Record<string, unknown>) => void;
  /** Server authorization/policy only. Browser may request detailed mode but cannot grant it. */
  detailedResearchAllowed?: boolean;
  detailedResearchLimits?: Partial<AgentRuntimeLimits>;
  /** Exact provider model ID lookup. Unknown models deliberately produce incomplete cost. */
  modelTokenRates?: (model: string | undefined) => ModelTokenRates | undefined;
  onResearchLedger?: (ledger: ResearchExecutionLedger) => void;
  /** Optional execution-engine seam. Omit to use the V1 MultiStepAgentRuntime. */
  runRuntime?: ServerAgentRuntimeRunner;
  /** Trusted Application projection over validated per-turn results. */
  projectResult?: (result: AgentRuntimeResult, scope: ServerAgentScope) => Partial<AgentRuntimeResult>;
}

/** Transport-independent, per-turn composition; no shared mutable principal/tool/evidence state. */
export function createServerAgentApplication(dependencies: ServerAgentDependencies) {
  return { async runAgentTurn(input: ServerAgentTurn, reportProgress?: AgentProgressReporter): Promise<AgentRuntimeResult> {
    requireTripPrincipal(input.principal);
    if (typeof input.userRequest !== "string" || !input.userRequest.trim() || input.userRequest.length > 8_000) throw new Error("Invalid user request");
    for (const value of [input.conversationId, input.tripId, input.uiContext?.itemId]) {
      if (value !== undefined && (typeof value !== "string" || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value))) throw new Error("Invalid Agent reference");
    }
    if (input.uiContext?.calendarDate !== undefined && !calendarDate(input.uiContext.calendarDate)) throw new Error("Invalid calendar date");
    if (input.requestedResearchMode !== undefined && !["standard", "detailed"].includes(input.requestedResearchMode)) throw new Error("Invalid research mode");
    const requestedMode = input.requestedResearchMode ?? "standard";
    const scope: ServerAgentScope = {
      principal: { subject: input.principal.subject, identity: { ...input.principal.identity }, scopes: [...input.principal.scopes] }, userRequest: input.userRequest,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.tripId ? { tripId: input.tripId } : {}),
      requestedResearchMode: requestedMode,
      ...(input.researchTarget ? { researchTarget: structuredClone(input.researchTarget) } : {}),
      ...(input.uiContext?.itemId || input.uiContext?.calendarDate ? { uiContext: {
        ...(input.uiContext.itemId ? { itemId: input.uiContext.itemId } : {}),
        ...(input.uiContext.calendarDate ? { calendarDate: input.uiContext.calendarDate } : {}),
      } } : {}),
      executionId: dependencies.newExecutionId(),
      researchMode: { requestedMode, effectiveMode: requestedMode === "detailed" && dependencies.detailedResearchAllowed && dependencies.detailedResearchLimits ? "detailed" : "standard" },
    };
    let context = await dependencies.loadContext?.(scope);
    const changedIntentTargets = context?.taskContext?.currentIntentChange?.operations
      .filter(({ frame }) => frame === "actual").map(({ target }) => target) ?? [];
    const initialEvidence = context?.workingState?.groundingEvidence
      ? evidenceForCurrentIntent(context.workingState.groundingEvidence, context.effectiveIntent, changedIntentTargets)
      : undefined;
    if (input.researchTarget) {
      const target = validateResearchTarget(input.researchTarget);
      const receipt = context?.workingState?.presentations.find((value) => value.presentationId === target.presentationId);
      const taskTarget = context?.taskContext?.target;
      const workingTarget = context?.workingState?.target;
      if (!receipt || !receipt.target || target.tripId !== receipt.target.tripId || target.baseTripRevision !== receipt.target.baseTripRevision ||
          target.tripId !== workingTarget?.tripId || target.baseTripRevision !== workingTarget?.tripRevision ||
          target.tripId !== undefined && (scope.tripId !== target.tripId || taskTarget?.kind !== "trip" || taskTarget.tripId !== target.tripId) ||
          target.baseTripRevision !== undefined && (taskTarget?.kind !== "trip" || taskTarget.tripRevision !== target.baseTripRevision) ||
          target.candidateSetId !== undefined && (receipt.candidateSetRef?.kind !== "candidate-set-ref" || receipt.candidateSetRef.candidateSetId !== target.candidateSetId ||
            receipt.candidateSetRef.revision !== target.candidateSetRevision)) throw new Error("Stale or foreign research target");
      if (context?.taskContext) context = { ...context, taskContext: { ...context.taskContext, researchTarget: target } };
    }
    await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: scope.executionId,
      phase: "context", reason: "compiled", occurredAt: (dependencies.now?.() ?? new Date()).toISOString(),
      counts: { acceptedCharacters: scope.userRequest.length,
        included: Array.isArray(context?.currentTrip?.schedule) ? context.currentTrip.schedule.length : 0,
        omitted: Number.isSafeInteger(context?.currentTrip?.omittedItemCount)
          ? Number(context?.currentTrip?.omittedItemCount)
          : context?.currentTrip?.scheduleTruncated === true ? 1 : 0 },
      correlation: { ...(Number.isSafeInteger(context?.currentTrip?.sourceRevision) ? { tripRevision: Number(context?.currentTrip?.sourceRevision) } : {}) } });
    await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: scope.executionId,
      phase: "compile-context", reason: "compiled", occurredAt: (dependencies.now?.() ?? new Date()).toISOString(),
      counts: { included: Array.isArray(context?.currentTrip?.schedule) ? context.currentTrip.schedule.length : 0,
        omitted: Number.isSafeInteger(context?.currentTrip?.omittedItemCount) ? Number(context?.currentTrip?.omittedItemCount) : context?.currentTrip?.scheduleTruncated === true ? 1 : 0 },
      correlation: { ...(Number.isSafeInteger(context?.currentTrip?.sourceRevision) ? { tripRevision: Number(context?.currentTrip?.sourceRevision) } : {}) } });
    const tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
    dependencies.registerTools(tools, evidence, scope);
    const selectedLimits = validateAgentRuntimeLimits(scope.researchMode.effectiveMode === "detailed" ? dependencies.detailedResearchLimits : dependencies.limits);
    const researchLedger = new ResearchExecutionLedger(
      researchBudgetForRuntimeLimits(selectedLimits, scope.researchMode.effectiveMode === "detailed" ? "detailed-v1" : "standard-v1"),
      scope.researchMode, () => (dependencies.now?.() ?? new Date()).getTime(), ["modelCalls", "toolCalls", "tokens", "cache", "cost"]);
    dependencies.onResearchLedger?.(researchLedger);
    const toolExecutor = new AgentToolExecutor(tools, evidence, dependencies.now);
    let result: AgentRuntimeResult;
    if (dependencies.runRuntime) {
      try {
        result = await dependencies.runRuntime({
          executionId: scope.executionId,
          userRequest: scope.userRequest,
          researchMode: scope.researchMode,
          ...(context ? { context } : {}),
          tools,
          evidenceRegistry: evidence,
          toolExecutor,
          limits: selectedLimits,
          researchLedger,
          ...(initialEvidence?.length ? { initialEvidence } : {}),
          ...(reportProgress ? { reportProgress } : {}),
        });
      } catch (error) {
        const failure = error instanceof ServerAgentRuntimeExecutionError
          ? `v2:${error.stage}:${error.kind}`
          : "v2:runner:unknown";
        await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: scope.executionId,
          phase: "runtime", reason: "failed", mode: failure, incomplete: true,
          occurredAt: (dependencies.now?.() ?? new Date()).toISOString() });
        throw error;
      }
    } else {
      result = await new MultiStepAgentRuntime({ model: dependencies.createModel(scope), tools,
        toolExecutor,
        limits: selectedLimits, now: dependencies.now, modelClassPolicy: dependencies.modelClassPolicy,
        researchLedger, modelTokenRates: dependencies.modelTokenRates,
        reportProgress,
      }).run({ executionId: scope.executionId, feature: "concierge", userRequest: scope.userRequest,
        researchMode: scope.researchMode,
        ...(context ? { context, omitTraceContent: true } : {}),
        ...(initialEvidence?.length ? { initialEvidence } : {}) });
    }
    result = { ...result, researchExecution: researchLedger.outcome({ remainingScopes: [],
      ...(result.status === "failed" || result.status === "limit_reached" ? { failed: true, stopReason: result.status === "limit_reached" ? "budget_exhausted" as const : "provider_failure" as const } : {}) }) };
    if (result.publicPlanPresentation && context?.taskContext?.target.kind === "trip" && context.taskContext.target.tripRevision !== undefined) {
      result = { ...result, publicPlanPresentation: bindPublicPlanTarget(result.publicPlanPresentation,
        { tripId: context.taskContext.target.tripId, baseTripRevision: context.taskContext.target.tripRevision }) };
    }
    if (result.status === "completed" || result.status === "follow_up") result = { ...result, ...dependencies.projectResult?.(result, scope) };
    await publishRuntimeDiagnostics(dependencies, result, scope.executionId);
    return result;
  } };
}

async function publishRuntimeDiagnostics(dependencies: ServerAgentDependencies, result: AgentRuntimeResult, executionId: string): Promise<void> {
  for (const event of result.trace.events) {
    if (event.type === "decision_recorded") {
      await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId,
        phase: "decision", reason: "validated", occurredAt: event.occurredAt, counts: { validated: 1 } });
      await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId,
        phase: "select-action", reason: "validated", occurredAt: event.occurredAt, counts: { validated: 1 } });
    }
    if (event.type === "tool_completed") await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId,
      phase: "tool", reason: event.outcome === "success" ? "completed" : "failed", occurredAt: event.occurredAt,
      correlation: { toolCallId: event.toolCallId }, refs: [event.toolName] });
  }
  const completion = [...result.trace.events].reverse().find((event) => event.type === "task_completed");
  await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId,
    phase: "runtime", reason: result.status === "completed" || result.status === "follow_up" ?
      result.delivery?.status === "degraded" || result.delivery?.status === "partial" ? "partial" : "completed" :
      diagnosticFailureReason(completion?.type === "task_completed" ? completion.reason : undefined),
    occurredAt: completion?.occurredAt ?? (dependencies.now?.() ?? new Date()).toISOString(),
    ...(result.delivery ? { mode: `delivery:${result.delivery.status}:${result.delivery.basis}` } : {}),
    incomplete: result.status === "failed" || result.status === "limit_reached" || result.delivery?.status !== undefined && result.delivery.status !== "full" });
}

function diagnosticFailureReason(reason: string | undefined): AgentDiagnosticEvent["reason"] {
  if (reason === "model_invalid_schema" || reason === "invalid_initial_evidence" ||
      reason === "missing_tool_call" || reason === "invalid_in_trip_answer_plan" ||
      reason === "invalid_response_contract" || reason === "invalid_used_evidence_ids" ||
      reason === "unbound_candidate_source") return reason;
  if (reason === "runtime_iteration_budget") return "iteration_budget";
  if (reason === "runtime_model_budget" || reason === "research_model_budget") return "model_budget";
  if (reason === "runtime_tool_budget" || reason === "research_tool_budget") return "tool_budget";
  if (reason === "runtime_deadline" || reason === "research_deadline") return "deadline";
  if (reason === "finalization_tool_calls") return "finalization_tool_calls";
  if (reason === "planning_progress_required" || reason === "planning_evidence_required" || reason === "planning_plan_required" ||
      reason === "place_photo_required" || reason === "final_response_policy_rejected") return reason;
  if (reason === "runtime_limit_reached") return "budget_exhausted";
  if (reason?.includes("timeout")) return "provider_timeout";
  if (reason?.includes("refusal")) return "provider_refusal";
  if (reason?.includes("provider_error")) return "provider_error";
  if (reason?.includes("invalid_schema") || reason?.startsWith("invalid_") || reason?.includes("contract") || reason?.includes("grounded") || reason === "missing_tool_call") return "schema_invalid";
  if (reason === "unsupported_claim" || reason?.startsWith("unbound_") || reason?.startsWith("missing_source_")) return "response_rejected";
  return "failed";
}

async function safeDiagnostic(dependencies: ServerAgentDependencies, event: AgentDiagnosticEvent): Promise<void> {
  if (!dependencies.diagnostics) return;
  try { await dependencies.diagnostics.record(event); }
  catch { dependencies.log?.("agent_diagnostic_dropped", { executionId: event.executionId, phase: event.phase }); }
}

function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validateResearchTarget(value: ServerAgentTurn["researchTarget"]): NonNullable<ServerAgentTurn["researchTarget"]> {
  if (!value || typeof value.presentationId !== "string" || !value.presentationId.trim() || value.presentationId.length > 200 ||
      value.candidateSetId !== undefined && (typeof value.candidateSetId !== "string" || !value.candidateSetId.trim() || value.candidateSetId.length > 300) ||
      [value.candidateSetRevision, value.baseTripRevision].some((item) => item !== undefined && (!Number.isSafeInteger(item) || Number(item) < 0)) ||
      value.tripId !== undefined && (typeof value.tripId !== "string" || !value.tripId.trim() || value.tripId.length > 200) ||
      (value.candidateSetId === undefined) !== (value.candidateSetRevision === undefined)) throw new Error("Invalid research target");
  return structuredClone(value);
}
