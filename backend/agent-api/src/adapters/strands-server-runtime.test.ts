import { describe, expect, it, vi } from "vitest";
import { ResearchExecutionLedger, researchBudgetForRuntimeLimits } from "@raiquora/agent/research-execution";
import type { Evidence } from "@raiquora/agent/evidence-model";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import type { StrandsAgentEngine } from "./strands-agent-engine.js";
import { createStrandsServerRuntime } from "./strands-server-runtime.js";
const limits = { maxIterations: 4, maxModelCalls: 6, maxToolCalls: 6, maxExecutionMs: 10_000, maxEvidence: 20 };
function runtimeInput() {
  const tools = new AgentToolRegistry(), evidenceRegistry = new ToolEvidenceRegistry();
  return { executionId: "strands-runtime-test", userRequest: "京都について教えて",
    researchMode: { requestedMode: "standard" as const, effectiveMode: "standard" as const },
    context: { featureContext: { calendarDate: "2026-09-26" } }, tools, evidenceRegistry,
    toolExecutor: new AgentToolExecutor(tools, evidenceRegistry), limits,
    researchLedger: new ResearchExecutionLedger(researchBudgetForRuntimeLimits(limits, "strands-test-v2"),
      { requestedMode: "standard", effectiveMode: "standard" }) };
}
const evidence: Evidence = { id: "evidence:trip:kyoto", category: "station", knowledgeKind: "deterministic_fact", subject: "京都",
  facts: { description: "保存済みTripでは京都が目的地です" },
  references: [{ sourceType: "trip-state", sourceRef: "trip:kyoto", retrievedAt: "2026-09-26T00:00:00.000Z", freshness: "current", summary: "京都" }],
  observation: { observationId: "evidence:trip:kyoto", subjectKey: "trip:kyoto", scopeKey: "trip", predicate: "destination",
    retrievedAt: "2026-09-26T00:00:00.000Z", applicability: "applicable", retention: "reference_only" } };
const trace = { executionId: "strands-runtime-test", events: [], droppedEventCount: 0 };
const answer = { kind: "answer", references: [{ evidenceId: evidence.id, field: "description" }] };
function fake(overrides: Record<string, unknown> = {}) {
  return { run: vi.fn(async (_input: { modelInput?: string }) => ({
    stopReason: "endTurn", evidence: [], trace, ...overrides,
  })) };
}
describe("createStrandsServerRuntime", () => {
  it("passes the existing bounded Application context to Strands", async () => {
    const input = runtimeInput(), engine = fake({ replyProposal: { kind: "conversation", message: "greeting" },
      metrics: { modelCalls: 1, toolCalls: 0, inputTokens: 100, outputTokens: 20, totalTokens: 120 } });
    const result = await createStrandsServerRuntime(engine as unknown as StrandsAgentEngine)(input);
    expect(result.status).toBe("completed");
    const payload = JSON.parse(engine.run.mock.calls[0]![0].modelInput!);
    expect(payload.userMessage).toBe(input.userRequest);
    expect(payload.application.clock).toMatchObject({ role: "reference_only", referenceDate: "2026-09-26" });
    expect(result.publicReply?.kind).toBe("conversation");
    expect(input.researchLedger.outcome({ remainingScopes: [] }).usage).toMatchObject({ modelCalls: 1, inputTokens: 100, outputTokens: 20 });
  });
  it("publishes verified Evidence instead of unbound model prose", async () => {
    const engine = fake({ replyProposal: answer, response: "捏造した自由文" });
    const result = await createStrandsServerRuntime(engine as unknown as StrandsAgentEngine)({ ...runtimeInput(), initialEvidence: [evidence] });
    expect(result.status).toBe("completed");
    expect(result.response).toContain("保存済みTripでは京都が目的地です");
    expect(result.response).not.toContain("捏造した");
    expect(result.claims[0]?.groundingStatus).toBe("supported");
    expect(result.publicReply?.references).toEqual(answer.references);
  });
  it("never publishes plain model prose, with or without unrelated Evidence", async () => {
    for (const initialEvidence of [[], [evidence]]) {
      const engine = fake({ response: "保存しておきます。" });
      const result = await createStrandsServerRuntime(engine as unknown as StrandsAgentEngine)({ ...runtimeInput(), initialEvidence });
      expect(result).toMatchObject({ status: "failed", response: "", publicationError: "missing_reply_proposal" });
      expect(result.publicReply).toBeUndefined();
    }
  });
  it("allows no-evidence conversation and unavailable operations, but not fabricated receipts", async () => {
    for (const replyProposal of [{ kind: "conversation", message: "thanks" }, { kind: "unavailable", operation: "save" },
      { kind: "clarification", target: "start_date" }]) {
      const result = await createStrandsServerRuntime(fake({ replyProposal }) as unknown as StrandsAgentEngine)(runtimeInput());
      expect(result.status).toBe("completed");
      expect(result.claims).toEqual([]);
    }
    const rejected = await createStrandsServerRuntime(fake({ replyProposal: { kind: "operation_result", receiptId: "invented" } }) as unknown as StrandsAgentEngine)(runtimeInput());
    expect(rejected).toMatchObject({ status: "failed", publicationError: "invalid_receipt" });
  });
  it("rejects conflicting same-ID observations instead of silently choosing one", async () => {
    const changed = { ...evidence, facts: { description: "異なる内容" } };
    const result = await createStrandsServerRuntime(fake({ replyProposal: answer, evidence: [changed] }) as unknown as StrandsAgentEngine)(
      { ...runtimeInput(), initialEvidence: [evidence] });
    expect(result).toMatchObject({ status: "failed", publicationError: "evidence_collision" });
  });
  it("rejects a UTF-8 reply that cannot fit the Conversation message envelope", async () => {
    const large = { ...evidence, facts: { first: "旅".repeat(2000), second: "旅".repeat(2000), third: "旅".repeat(2000) } };
    const replyProposal = { kind: "answer", references: ["first", "second", "third"].map((field) => ({ evidenceId: large.id, field })) };
    const result = await createStrandsServerRuntime(fake({ replyProposal }) as unknown as StrandsAgentEngine)(
      { ...runtimeInput(), initialEvidence: [large] });
    expect(result).toMatchObject({ status: "failed", response: "", publicationError: "response_budget" });
    expect(result.publicReply).toBeUndefined();
  });
  it("maps bounded Strands stops to the shared Runtime status", async () => {
    const result = await createStrandsServerRuntime(fake({ stopReason: "limitTurns", replyProposal: answer }) as unknown as StrandsAgentEngine)(runtimeInput());
    expect(result.status).toBe("limit_reached");
    expect(result.response).toBe("");
  });
});
