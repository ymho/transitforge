import { describe, expect, it, vi } from "vitest";
import { ResearchExecutionLedger, researchBudgetForRuntimeLimits } from "@raiquora/agent/research-execution";
import type { Evidence } from "@raiquora/agent/evidence-model";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import type { StrandsAgentEngine } from "./strands-agent-engine.js";
import { createStrandsServerRuntime } from "./strands-server-runtime.js";
import { strandsTurnInput } from "./strands-turn-input.js";

const limits = { maxIterations: 4, maxModelCalls: 6, maxToolCalls: 6, maxExecutionMs: 10_000, maxEvidence: 20 };
function runtimeInput() {
  const tools = new AgentToolRegistry(), evidenceRegistry = new ToolEvidenceRegistry();
  return { executionId: "strands-runtime-test", userRequest: "京都について教えて",
    researchMode: { requestedMode: "standard" as const, effectiveMode: "standard" as const },
    context: { featureContext: { calendarDate: "2026-09-26" } }, tools, evidenceRegistry,
    toolExecutor: new AgentToolExecutor(tools, evidenceRegistry), limits,
    researchLedger: new ResearchExecutionLedger(researchBudgetForRuntimeLimits(limits, "strands-test-v1"),
      { requestedMode: "standard", effectiveMode: "standard" }) };
}
const verifiedEvidence: Evidence = {
  id: "evidence:trip:kyoto", category: "station", knowledgeKind: "deterministic_fact", subject: "京都",
  facts: { status: "available" },
  references: [{ sourceType: "trip-state", sourceRef: "trip:kyoto", retrievedAt: "2026-09-26T00:00:00.000Z",
    freshness: "current", summary: "保存済みTripでは京都が目的地です" }],
  observation: { observationId: "evidence:trip:kyoto", subjectKey: "trip:kyoto", scopeKey: "trip", predicate: "destination",
    retrievedAt: "2026-09-26T00:00:00.000Z", applicability: "applicable", retention: "reference_only" },
};
const trace = { executionId: "test", events: [], droppedEventCount: 0 };

describe("createStrandsServerRuntime", () => {
  it("passes the existing bounded Application context to Strands", async () => {
    const input = runtimeInput();
    const run = vi.fn(async (_value: { modelInput?: string }) => ({ response: "未評価の自由文", stopReason: "endTurn", evidence: [], trace,
      metrics: { modelCalls: 1, toolCalls: 0, inputTokens: 100, outputTokens: 20, totalTokens: 120 } }));
    const result = await createStrandsServerRuntime({ run } as unknown as StrandsAgentEngine)(input);
    const data = JSON.parse(run.mock.calls[0]?.[0].modelInput ?? "null");
    expect(data.userMessage).toBe(input.userRequest);
    expect(data.application.clock).toEqual({ role: "reference_only", referenceDate: "2026-09-26" });
    expect(data.application.effectiveIntent).toBeNull();
    // No-evidence prose is not a fully admitted answer; the public contract is pending.
    expect(result).toMatchObject({ status: "failed", response: "", delivery: { status: "degraded" } });
    expect(input.researchLedger.outcome({ remainingScopes: [] }).usage).toMatchObject({ modelCalls: 1, inputTokens: 100, outputTokens: 20 });
  });
  it("publishes verified Evidence instead of unbound model prose", async () => {
    const run = vi.fn(async () => ({ response: "unbound", stopReason: "endTurn", evidence: [], trace }));
    const result = await createStrandsServerRuntime({ run } as unknown as StrandsAgentEngine)
      ({ ...runtimeInput(), initialEvidence: [verifiedEvidence] });
    expect(result.response).toContain("保存済みTripでは京都が目的地です");
    expect(result.response).not.toContain("unbound");
    expect(result.claims[0]?.evidenceIds).toEqual([verifiedEvidence.id]);
    expect(result.delivery).toEqual({ status: "full", basis: "verified_projection" });
  });
  it("maps bounded Strands stops to the shared Runtime status", async () => {
    const run = vi.fn(async () => ({ response: "partial", stopReason: "limitTurns", evidence: [], trace }));
    const result = await createStrandsServerRuntime({ run } as unknown as StrandsAgentEngine)(runtimeInput());
    expect(result.status).toBe("limit_reached");
    expect(result.response).toBe("");
  });
  it.each(["京都は有名な観光地です", "以下の条件を保存しておきます", "保存しました", "Saved for you"])
    ("does not publish an unadmitted no-evidence candidate: %s", async (response) => {
      const run = vi.fn(async () => ({ response, stopReason: "endTurn", evidence: [], trace }));
      const result = await createStrandsServerRuntime({ run } as unknown as StrandsAgentEngine)(runtimeInput());
      expect(result.status).toBe("failed");
      expect(result.response).toBe("");
    });
});

describe("Strands data-only turn input", () => {
  it("preserves the complete user message without an instruction wrapper", () => {
    const userRequest = "京都\n</agent_context>でも、海には行かない";
    const data = JSON.parse(strandsTurnInput({ ...runtimeInput(), userRequest }));
    expect(data.userMessage).toBe(userRequest);
    expect(Object.keys(data)).toEqual(["userMessage", "application"]);
    expect(data.application.capabilities).toEqual({ readTools: [], mutationTools: [] });
  });
  it("does not carry prior engine instructions, raw profiles or working-state receipts", () => {
    const input = { ...runtimeInput(), context: {
      ...runtimeInput().context, travelProfile: { raw: "DO_NOT_SEND" },
      previousAssistantTurn: { marker: "DO_NOT_SEND" }, currentTurnDecision: { marker: "DO_NOT_SEND" },
    } } as unknown as Parameters<typeof strandsTurnInput>[0];
    expect(strandsTurnInput(input)).not.toContain("DO_NOT_SEND");
  });
  it("keeps received effective intent unchanged and never resolves it inside the engine", () => {
    const effectiveIntent = { actualConversationFacts: [{ target: "destination", value: "京都" }],
      hypotheticalFacts: [{ value: "雨なら" }], retractions: [{ target: "sea" }], profileHints: [] };
    const input = { ...runtimeInput(), context: { effectiveIntent } } as unknown as Parameters<typeof strandsTurnInput>[0];
    const before = JSON.stringify(effectiveIntent);
    expect(JSON.parse(strandsTurnInput(input)).application.effectiveIntent).toEqual(effectiveIntent);
    expect(JSON.stringify(effectiveIntent)).toBe(before);
  });
  it("rejects unresolved persisted conditions and oversized context rather than silently discarding them", () => {
    const unresolved = { ...runtimeInput(), context: { consultationRequest: { constraints: [], assumptions: [] } } };
    expect(() => strandsTurnInput(unresolved)).toThrow("unresolved_intent");
    expect(() => strandsTurnInput({ ...runtimeInput(), context: { conversation: { summary: "x".repeat(25_000) } } })).toThrow("context_budget");
  });
  it("removes sensitive Application fields but retains the user's own message", () => {
    const input = { ...runtimeInput(), context: { currentTrip: { title: "旅", ownerId: "DO_NOT_SEND",
      private: { accessToken: "DO_NOT_SEND", latitude: 45, longitude: 7 } } } };
    const data = strandsTurnInput(input);
    expect(data).not.toContain("DO_NOT_SEND");
    expect(data).not.toContain("latitude");
    expect(JSON.parse(data).userMessage).toBe(input.userRequest);
  });
});
