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

/** Caller authenticates principal. Only an injected server loader may resolve references to state. */
export interface ServerAgentTurn {
  principal: TrustedPrincipal;
  userRequest: string;
  conversationId?: string;
  tripId?: string;
  uiContext?: { itemId?: string; calendarDate?: string };
}
export interface ServerAgentScope extends ServerAgentTurn { executionId: string }
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
}

/** Transport-independent, per-turn composition; no shared mutable principal/tool/evidence state. */
export function createServerAgentApplication(dependencies: ServerAgentDependencies) {
  return { async runAgentTurn(input: ServerAgentTurn): Promise<AgentRuntimeResult> {
    requireTripPrincipal(input.principal);
    if (typeof input.userRequest !== "string" || !input.userRequest.trim() || input.userRequest.length > 8_000) throw new Error("Invalid user request");
    for (const value of [input.conversationId, input.tripId, input.uiContext?.itemId]) {
      if (value !== undefined && (typeof value !== "string" || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value))) throw new Error("Invalid Agent reference");
    }
    if (input.uiContext?.calendarDate !== undefined && !calendarDate(input.uiContext.calendarDate)) throw new Error("Invalid calendar date");
    const scope: ServerAgentScope = {
      principal: { subject: input.principal.subject, identity: { ...input.principal.identity }, scopes: [...input.principal.scopes] }, userRequest: input.userRequest,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.tripId ? { tripId: input.tripId } : {}),
      ...(input.uiContext?.itemId || input.uiContext?.calendarDate ? { uiContext: {
        ...(input.uiContext.itemId ? { itemId: input.uiContext.itemId } : {}),
        ...(input.uiContext.calendarDate ? { calendarDate: input.uiContext.calendarDate } : {}),
      } } : {}),
      executionId: dependencies.newExecutionId(),
    };
    const context = await dependencies.loadContext?.(scope);
    await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: scope.executionId,
      phase: "context", reason: "compiled", occurredAt: (dependencies.now?.() ?? new Date()).toISOString(),
      counts: { acceptedCharacters: scope.userRequest.length,
        included: Array.isArray(context?.currentTrip?.schedule) ? context.currentTrip.schedule.length : 0,
        omitted: Number.isSafeInteger(context?.currentTrip?.omittedItemCount)
          ? Number(context?.currentTrip?.omittedItemCount)
          : context?.currentTrip?.scheduleTruncated === true ? 1 : 0 },
      correlation: { ...(Number.isSafeInteger(context?.currentTrip?.sourceRevision) ? { tripRevision: Number(context?.currentTrip?.sourceRevision) } : {}) } });
    const tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
    dependencies.registerTools(tools, evidence, scope);
    const result = await new MultiStepAgentRuntime({ model: dependencies.createModel(scope), tools,
      toolExecutor: new AgentToolExecutor(tools, evidence, dependencies.now),
      limits: dependencies.limits, now: dependencies.now, modelClassPolicy: dependencies.modelClassPolicy,
    }).run({ executionId: scope.executionId, feature: "concierge", userRequest: scope.userRequest,
      ...(context ? { context, omitTraceContent: true } : {}) });
    await publishRuntimeDiagnostics(dependencies, result, scope.executionId);
    return result;
  } };
}

async function publishRuntimeDiagnostics(dependencies: ServerAgentDependencies, result: AgentRuntimeResult, executionId: string): Promise<void> {
  for (const event of result.trace.events) {
    if (event.type === "decision_recorded") await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId,
      phase: "decision", reason: "validated", occurredAt: event.occurredAt, counts: { validated: 1 } });
    if (event.type === "tool_completed") await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId,
      phase: "tool", reason: event.outcome === "success" ? "completed" : "failed", occurredAt: event.occurredAt,
      correlation: { toolCallId: event.toolCallId }, refs: [event.toolName] });
  }
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
