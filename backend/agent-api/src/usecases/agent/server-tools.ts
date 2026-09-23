import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry, type ToolEvidenceMapper } from "@raiquora/agent/tool-evidence-registry";
import { validateAgentToolInput } from "@raiquora/agent/agent-tool-input-validator";
import { failedAgentToolResult, successfulAgentToolResult, type AgentToolDescriptor } from "@raiquora/agent/tool-contract";
import type { AgentOperation } from "../../ports/agent-operation.js";

/** The operation can be local or a Provider boundary using fixed egress IP. */
export interface ServerAgentToolBinding {
  descriptor: AgentToolDescriptor;
  operation: AgentOperation;
  evidence: ToolEvidenceMapper;
}
export function registerServerTools(tools: AgentToolRegistry, evidence: ToolEvidenceRegistry, bindings: readonly ServerAgentToolBinding[]) {
  for (const binding of bindings) {
    const descriptor = { effect: "read" as const, outputSchema: { type: "object" as const, properties: {}, additionalProperties: true }, ...binding.descriptor };
    tools.register({ ...descriptor,
      parseInput: value => validateAgentToolInput(binding.descriptor.inputSchema, value),
      async execute(input, context) {
        const result = await binding.operation(input, { requestId: context.executionId,
          ...(context.signal ? { signal: context.signal } : {}), ...(context.deadlineAt ? { deadlineAt: context.deadlineAt } : {}) });
        const status = result.statusCode ?? 200;
        if (status >= 400) return failedAgentToolResult(operationError(status, result.body));
        const output = validateAgentToolInput(descriptor.outputSchema, result.body);
        if (!output.ok) return failedAgentToolResult({ code: "execution_failed", message: "Tool output contract validation failed", retryable: false });
        return successfulAgentToolResult(output.input);
      },
    });
    evidence.register(binding.descriptor.name, binding.evidence);
  }
}

function operationError(status: number, body: Record<string, unknown>) {
  const declared = typeof body.code === "string" ? body.code : undefined;
  const allowed = new Set(["invalid_input", "precondition_failed", "not_found", "outside_coverage", "precondition_missing",
    "stale_revision", "permission_denied", "rate_limited", "unavailable", "ambiguous_entity", "execution_failed"]);
  const code = declared && allowed.has(declared) ? declared : status === 401 || status === 403 ? "permission_denied" :
    status === 404 ? "not_found" : status === 409 ? "stale_revision" : status === 412 ? "precondition_missing" :
    status === 429 ? "rate_limited" : status >= 500 ? "unavailable" : "invalid_input";
  return { code: code as import("@raiquora/agent/tool-contract").AgentToolErrorCode,
    message: typeof body.message === "string" && body.message.length <= 240 ? body.message : "Tool operation failed",
    retryable: code === "rate_limited" || code === "unavailable" || code === "execution_failed" };
}
