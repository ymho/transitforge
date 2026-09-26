import { describe, expect, it, vi } from "vitest";
import { ResearchExecutionLedger, researchBudgetForRuntimeLimits } from "@raiquora/agent/research-execution";
import type { Evidence } from "@raiquora/agent/evidence-model";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import type { StrandsAgentEngine } from "./strands-agent-engine.js";
import { createStrandsServerRuntime } from "./strands-server-runtime.js";

const limits = { maxIterations: 4, maxModelCalls: 6, maxToolCalls: 6, maxExecutionMs: 10_000, maxEvidence: 20 };

function ledger() {
  return new ResearchExecutionLedger(researchBudgetForRuntimeLimits(limits, "strands-test-v1"),
    { requestedMode: "standard", effectiveMode: "standard" });
}

function runtimeInput() {
  const tools = new AgentToolRegistry(), evidenceRegistry = new ToolEvidenceRegistry();
  return {
    executionId: "strands-runtime-test",
    userRequest: "京都について教えて",
    researchMode: { requestedMode: "standard" as const, effectiveMode: "standard" as const },
    context: { featureContext: { calendarDate: "2026-09-26" } },
    tools,
    evidenceRegistry,
    toolExecutor: new AgentToolExecutor(tools, evidenceRegistry),
    limits,
    researchLedger: ledger(),
  };
}

const verifiedEvidence: Evidence = {
  id: "evidence:trip:kyoto",
  category: "external",
  knowledgeKind: "deterministic_fact",
  subject: "京都",
  facts: { status: "available" },
  references: [{ sourceType: "trip-state", sourceRef: "trip:kyoto", retrievedAt: "2026-09-26T00:00:00.000Z",
    freshness: "current", summary: "保存済みTripでは京都が目的地です" }],
  observation: { observationId: "evidence:trip:kyoto", subjectKey: "trip:kyoto", scopeKey: "trip",
    predicate: "destination", retrievedAt: "2026-09-26T00:00:00.000Z", applicability: "applicable", retention: "reference_only" },
};

describe("createStrandsServerRuntime", () => {
  it("passes the existing bounded Application context to Strands", async () => {
    const input = runtimeInput();
    const run = vi.fn(async (value: { modelInput?: string }) => ({
      response: "一般案内です",
      stopReason: "endTurn",
      evidence: [],
      trace: { executionId: input.executionId, events: [], droppedEventCount: 0 },
      metrics: { modelCalls: 1, toolCalls: 0, inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    }));
    const runtime = createStrandsServerRuntime({ run } as unknown as StrandsAgentEngine);

    const result = await runtime(input);

    expect(result.status).toBe("completed");
    expect(result.response).toBe("一般案内です");
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0].modelInput).toContain("<agent_context>");
    expect(run.mock.calls[0]?.[0].modelInput).toContain("2026-09-26");
    expect(input.researchLedger.outcome({ remainingScopes: [] }).usage).toMatchObject({
      modelCalls: 1, toolCalls: 0, inputTokens: 100, outputTokens: 20,
    });
  });

  it("publishes verified Evidence instead of unbound model prose", async () => {
    const input = { ...runtimeInput(), initialEvidence: [verifiedEvidence] };
    const run = vi.fn(async () => ({
      response: "モデルが勝手に作った京都の説明",
      stopReason: "endTurn",
      evidence: [],
      trace: { executionId: input.executionId, events: [], droppedEventCount: 0 },
    }));
    const runtime = createStrandsServerRuntime({ run } as unknown as StrandsAgentEngine);

    const result = await runtime(input);

    expect(result.status).toBe("completed");
    expect(result.response).toContain("保存済みTripでは京都が目的地です");
    expect(result.response).not.toContain("勝手に作った");
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.evidenceIds).toEqual([verifiedEvidence.id]);
    expect(result.delivery).toEqual({ status: "full", basis: "verified_projection" });
  });

  it("maps bounded Strands stops to the shared Runtime status", async () => {
    const input = runtimeInput();
    const runtime = createStrandsServerRuntime({ run: vi.fn(async () => ({
      response: "partial",
      stopReason: "limitTurns",
      evidence: [],
      trace: { executionId: input.executionId, events: [], droppedEventCount: 0 },
    })) } as unknown as StrandsAgentEngine);

    const result = await runtime(input);

    expect(result.status).toBe("limit_reached");
    expect(result.delivery?.status).toBe("degraded");
  });
});
