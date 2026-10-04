import { vi } from "vitest";
import { AgentTraceRecorder } from "@raiquora/agent/agent-trace";
import type { ServerAgentRuntimeInput } from "../ports/server-agent-runtime.js";

/** Exercises Application proposal registration and persistence at the runtime port.
 * These capabilities are not exposed to the current native SDK Tool catalog. */
export function applicationProposalRuntime(step: () => { name: string; input: Record<string, unknown> }) {
  return vi.fn(async (input: ServerAgentRuntimeInput) => {
    const command = step();
    const trace = new AgentTraceRecorder(input.executionId, { omitContent: true });
    const execution = await input.toolExecutor.execute({ executionId: input.executionId,
      toolCallId: "proposal-fixture", toolName: command.name, toolInput: command.input, timeoutMs: 1000 }, trace);
    if (!execution.result.ok) throw new Error("Application proposal fixture rejected");
    return { status: "completed" as const, response: "提案を確認してください。まだ保存していません。",
      evidence: execution.evidence, claims: [], trace: trace.snapshot() };
  });
}
