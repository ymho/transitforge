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
    tools.register({ ...binding.descriptor,
      parseInput: value => validateAgentToolInput(binding.descriptor.inputSchema, value),
      async execute(input, context) {
        const result = await binding.operation(input, { requestId: context.executionId });
        const status = result.statusCode ?? 200;
        if (status >= 400) return failedAgentToolResult({ code: status < 500 ? "invalid_input" : "execution_failed",
          message: "Tool operation failed", retryable: status === 429 || status >= 500 });
        return successfulAgentToolResult(result.body);
      },
    });
    evidence.register(binding.descriptor.name, binding.evidence);
  }
}
