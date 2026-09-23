import { describe, expect, it } from "vitest";
import { AgentTraceRecorder } from "./agent-trace";
import { ResearchExecutionLedger, reserveResearchResultSave, summarizeResearchTrace } from "./research-execution";
import type { ResearchBudget } from "./research-budget";

const budget: ResearchBudget = { policyVersion: "research-v2", maximumModelCalls: 2, maximumToolCalls: 4, maximumCandidates: 12,
  maximumDocuments: 6, maximumProviderReadCalls: 6, maximumBytes: 40_000, maximumInputTokens: 2_000, maximumOutputTokens: 1_000,
  maximumRerankCalls: 1, maximumKnowledgeBaseCalls: 1, maximumParallelReads: 3, deadlineMs: 30_000, estimatedCostLimitUsd: 0.1 };
const rates = { pricingVersion: "fixture-2026-09", inputPerMillionUsd: 1, outputPerMillionUsd: 2,
  cacheReadPerMillionUsd: .1, cacheWritePerMillionUsd: 1.25 };

describe("research execution accounting", () => {
  it("accounts cache input, retries and each external boundary without raising the selected budget", () => {
    let now = 1_000;
    const ledger = new ResearchExecutionLedger(budget, { requestedMode: "detailed", effectiveMode: "detailed" }, () => now);
    expect(ledger.reserve("modelCalls")).toBe(true);
    expect(ledger.reserve("providerReads", 6)).toBe(true);
    expect(ledger.reserve("providerReads")).toBe(false);
    expect(ledger.reserve("rerankCalls")).toBe(true);
    expect(ledger.reserve("knowledgeBaseCalls")).toBe(true);
    expect(ledger.reserve("saveCalls")).toBe(true);
    ledger.recordRetry();
    ledger.recordModel({ inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 300, cacheWriteInputTokens: 50 }, "read", rates);
    ledger.cover("candidate-discovery"); now += 120;
    expect(ledger.outcome({ remainingScopes: [] })).toMatchObject({ status: "completed", coveredScopes: ["candidate-discovery"], usage: {
      modelCalls: 1, providerReads: 6, rerankCalls: 1, knowledgeBaseCalls: 1, saveCalls: 1, retries: 1,
      inputTokens: 100, cacheReadInputTokens: 300, cacheWriteInputTokens: 50, cache: { read: 1 }, wallClockMs: 120,
      estimatedCostUsd: expect.any(Number), pricingVersion: "fixture-2026-09", costComplete: true,
    } });
  });

  it("requires an opaque continuation for budget partials and rejects mode escalation", () => {
    expect(() => new ResearchExecutionLedger(budget, { requestedMode: "standard", effectiveMode: "detailed" })).toThrow();
    const ledger = new ResearchExecutionLedger(budget, { requestedMode: "standard", effectiveMode: "standard" });
    expect(() => ledger.outcome({ remainingScopes: ["day:31"] })).toThrow("continuation");
    expect(ledger.outcome({ remainingScopes: ["day:31"], stopReason: "budget_exhausted",
      continuation: { kind: "new-turn-request", issuedBy: "server", ref: "research-result:turn-1:page-2", expiresAt: "2026-09-24T00:00:00.000Z" } })).toMatchObject({
      status: "partial", stopReason: "budget_exhausted", remainingScopes: ["day:31"],
      continuation: { ref: "research-result:turn-1:page-2" },
    });
  });

  it("reserves compound provider boundaries atomically and exposes uncontinued work as failed", () => {
    const ledger = new ResearchExecutionLedger({ ...budget, maximumKnowledgeBaseCalls: 0 },
      { requestedMode: "standard", effectiveMode: "standard" });
    expect(ledger.reserveAll([{ counter: "providerReads" }, { counter: "knowledgeBaseCalls" }])).toBe(false);
    ledger.defer("retrieval:knowledge_base:1");
    expect(ledger.outcome({ remainingScopes: [] })).toMatchObject({ status: "failed", stopReason: "budget_exhausted",
      remainingScopes: ["retrieval:knowledge_base:1"], usage: { providerReads: 0, knowledgeBaseCalls: 0 } });
  });

  it("derives model/tool/cache totals from privacy-bounded production trace metadata", () => {
    let tick = 0;
    const recorder = new AgentTraceRecorder("execution", { omitContent: true, now: () => new Date(1_000 + tick++ * 10) });
    recorder.modelStarted("m1", { messageCount: 1, toolNames: ["search"] });
    recorder.modelCompleted({ provider: "fixture", cacheStatus: "write", usage: { inputTokens: 10, outputTokens: 5, cacheWriteInputTokens: 20 } }, "m1");
    recorder.toolCalled("t1", "search", { private: "not retained" });
    recorder.taskCompleted("completed", 30);
    expect(summarizeResearchTrace(recorder.snapshot(), budget, { requestedMode: "standard", effectiveMode: "standard" }, () => rates)).toMatchObject({
      status: "completed", usage: { modelCalls: 1, toolCalls: 1, inputTokens: 10, outputTokens: 5, cacheWriteInputTokens: 20, cache: { write: 1 } },
    });
  });

  it("reserves one result save exactly once before persistence", () => {
    const ledger = new ResearchExecutionLedger(budget, { requestedMode: "standard", effectiveMode: "standard" }, Date.now,
      ["modelCalls", "toolCalls", "tokens", "cache", "cost"]);
    const saved = reserveResearchResultSave(ledger.outcome({ remainingScopes: [] }));
    expect(saved.usage).toMatchObject({ saveCalls: 1, measurementCoverage: { saveCalls: true } });
    expect(() => reserveResearchResultSave(saved)).toThrow();
  });
});
