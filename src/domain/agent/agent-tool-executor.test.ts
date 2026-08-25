import { describe, expect, it } from "vitest";

import { AgentToolExecutor } from "./agent-tool-executor";
import { AgentTraceRecorder } from "./agent-trace";
import { validAgentToolInput, type AgentTool } from "./tool-contract";
import { ToolEvidenceRegistry } from "./tool-evidence-registry";
import { AgentToolRegistry } from "./tool-registry";

describe("AgentToolExecutor", () => {
  it("aborts and reports a tool that exceeds its bounded execution time", async () => {
    let receivedSignal: AbortSignal | undefined;
    const hangingTool: AgentTool<Record<string, never>, never> = {
      name: "hanging_tool",
      description: "応答しないfixture",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      parseInput: () => validAgentToolInput({}),
      execute: (_input, context) => {
        receivedSignal = context.signal;
        return new Promise(() => undefined);
      },
    };
    const tools = new AgentToolRegistry();
    tools.register(hangingTool);
    const executor = new AgentToolExecutor(tools, new ToolEvidenceRegistry());
    const trace = new AgentTraceRecorder("execution-1");

    const execution = await executor.execute({
      executionId: "execution-1",
      toolCallId: "call-1",
      toolName: "hanging_tool",
      toolInput: {},
      timeoutMs: 2,
    }, trace);

    expect(execution.result).toMatchObject({
      ok: false,
      error: { code: "execution_failed", retryable: true },
    });
    expect(receivedSignal?.aborted).toBe(true);
    expect(trace.snapshot().events.at(-1)).toMatchObject({
      type: "tool_completed",
      outcome: "error",
    });
  });
});
