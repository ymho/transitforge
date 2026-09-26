// V1 regression only: do not use this suite as the Agent v2 compatibility oracle.\n// Re-express user-visible requirements at Application/Domain boundaries for the greenfield Strands runtime.\nimport { expect, it, vi } from "vitest";
import { MultiStepAgentRuntime } from "./agent-runtime";
import { AgentToolExecutor } from "./agent-tool-executor";
import { ResearchExecutionLedger } from "./research-execution";
import { AgentToolRegistry } from "./tool-registry";
import { ToolEvidenceRegistry } from "./tool-evidence-registry";
import { successfulAgentToolResult } from "./tool-contract";
import type { ResearchBudget } from "./research-budget";

const base: ResearchBudget = { policyVersion: "test", maximumModelCalls: 1, maximumToolCalls: 1, maximumCandidates: 1,
  maximumDocuments: 1, maximumProviderReadCalls: 1, maximumBytes: 100, maximumInputTokens: 100, maximumOutputTokens: 100,
  maximumRerankCalls: 1, maximumKnowledgeBaseCalls: 1, maximumParallelReads: 1, deadlineMs: 10_000 };
const request = { executionId: "execution", feature: "concierge" as const, userRequest: "調べて" };

it("stops before a model provider call when reservation is unavailable", async () => {
  const tools = new AgentToolRegistry(), generate = vi.fn(async () => { throw new Error("must not execute"); });
  const ledger = new ResearchExecutionLedger({ ...base, maximumModelCalls: 0 }, { requestedMode: "standard", effectiveMode: "standard" });
  const result = await new MultiStepAgentRuntime({ model: { generate }, tools,
    toolExecutor: new AgentToolExecutor(tools, new ToolEvidenceRegistry()), researchLedger: ledger }).run(request);
  expect(result.status).toBe("limit_reached"); expect(generate).not.toHaveBeenCalled();
});

it("stops before Tool execution when the Tool-call reservation is unavailable", async () => {
  const tools = new AgentToolRegistry(), execute = vi.fn(async () => successfulAgentToolResult({ ok: true }));
  tools.register({ name: "read", description: "read", inputSchema: { type: "object", properties: {}, additionalProperties: false }, parseInput: value => ({ ok: true, input: value }), execute });
  const generate = vi.fn(async () => ({ message: { role: "assistant" as const, content: [{ type: "tool_call" as const, toolCallId: "call", name: "read", input: {} }] },
    stopReason: "tool_calls" as const, metadata: { provider: "fixture", usage: { inputTokens: 1, outputTokens: 1 } } }));
  const ledger = new ResearchExecutionLedger({ ...base, maximumToolCalls: 0 }, { requestedMode: "standard", effectiveMode: "standard" });
  const result = await new MultiStepAgentRuntime({ model: { generate }, tools,
    toolExecutor: new AgentToolExecutor(tools, new ToolEvidenceRegistry()), researchLedger: ledger }).run(request);
  expect(result.status).toBe("limit_reached"); expect(generate).toHaveBeenCalledOnce(); expect(execute).not.toHaveBeenCalled();
});
