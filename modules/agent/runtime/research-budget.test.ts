import { expect, it } from "vitest";
import { executeBoundedAgentReads } from "./agent-tool-executor";
import { ResearchBudgetLedger, selectResearchBudget, type ResearchBudget } from "./research-budget";

const budget: ResearchBudget = { policyVersion: "v1", maximumModelCalls: 2, maximumToolCalls: 3, maximumCandidates: 5,
  maximumDocuments: 5, maximumBytes: 1000, maximumInputTokens: 100, maximumOutputTokens: 100,
  maximumRerankCalls: 1, maximumKnowledgeBaseCalls: 1, maximumParallelReads: 2, deadlineMs: 1000 };

it("reserves budget atomically before parallel work and does not escalate detailed mode", () => {
  const ledger = new ResearchBudgetLedger(budget);
  expect([ledger.reserve("toolCalls"), ledger.reserve("toolCalls", 2), ledger.reserve("toolCalls")]).toEqual([true, true, false]);
  expect(selectResearchBudget("detailed", { standard: budget, detailedAllowed: false }).mode).toMatchObject({ effectiveMode: "standard", reasonCodes: ["server_policy_limit"] });
});

it("bounds independent reads and retains declaration order", async () => {
  let active = 0, maximum = 0;
  const result = await executeBoundedAgentReads([30, 5, 15].map((delay, index) => async () => {
    active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, delay)); active--; return index;
  }), 2);
  expect(maximum).toBe(2);
  expect(result).toEqual([0, 1, 2]);
});
