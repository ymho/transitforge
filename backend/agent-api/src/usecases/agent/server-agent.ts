import type { TrustedPrincipal } from "../../contracts/trusted-principal.js";
import { MultiStepAgentRuntime, type AgentModelClassPolicy } from "@raiquora/agent/agent-runtime";
import type { AgentModelProvider } from "@raiquora/agent/model-provider";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import type { AgentRuntimeLimits } from "@raiquora/agent/runtime-policies";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import { requireTripPrincipal } from "../../contracts/trip-principal.js";

/** Caller authenticates principal. References are not loaded or trusted as planning state. */
export interface ServerAgentTurn {
  principal: TrustedPrincipal;
  userRequest: string;
  conversationId?: string;
  tripId?: string;
  uiContext?: { itemId?: string };
}
export interface ServerAgentScope extends ServerAgentTurn { executionId: string }
export interface ServerAgentDependencies {
  newExecutionId: () => string;
  createModel: (scope: ServerAgentScope) => AgentModelProvider;
  registerTools: (tools: AgentToolRegistry, evidence: ToolEvidenceRegistry, scope: ServerAgentScope) => void;
  limits?: Partial<AgentRuntimeLimits>;
  modelClassPolicy?: AgentModelClassPolicy;
  now?: () => Date;
}

/** Transport-independent, per-turn composition; no shared mutable principal/tool/evidence state. */
export function createServerAgentApplication(dependencies: ServerAgentDependencies) {
  return { async runAgentTurn(input: ServerAgentTurn): Promise<AgentRuntimeResult> {
    requireTripPrincipal(input.principal);
    if (typeof input.userRequest !== "string" || !input.userRequest.trim() || input.userRequest.length > 8_000) throw new Error("Invalid user request");
    for (const value of [input.conversationId, input.tripId, input.uiContext?.itemId]) {
      if (value !== undefined && (typeof value !== "string" || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value))) throw new Error("Invalid Agent reference");
    }
    const scope: ServerAgentScope = {
      principal: { subject: input.principal.subject, identity: { ...input.principal.identity }, scopes: [...input.principal.scopes] }, userRequest: input.userRequest,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.tripId ? { tripId: input.tripId } : {}),
      ...(input.uiContext?.itemId ? { uiContext: { itemId: input.uiContext.itemId } } : {}),
      executionId: dependencies.newExecutionId(),
    };
    const tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
    dependencies.registerTools(tools, evidence, scope);
    // A UI reference is a hint only. Resolving it against authorized Trip State belongs to #479.
    return new MultiStepAgentRuntime({ model: dependencies.createModel(scope), tools,
      toolExecutor: new AgentToolExecutor(tools, evidence, dependencies.now),
      limits: dependencies.limits, now: dependencies.now, modelClassPolicy: dependencies.modelClassPolicy,
    }).run({ executionId: scope.executionId, feature: "concierge", userRequest: scope.userRequest });
  } };
}
