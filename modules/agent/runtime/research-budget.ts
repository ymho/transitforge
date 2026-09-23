export type ResearchBudgetStopReason = "budget_exhausted" | "deadline" | "rate_limited" | "needs_user_input";

export interface ResearchBudget {
  policyVersion: string;
  maximumModelCalls: number;
  maximumToolCalls: number;
  maximumCandidates: number;
  maximumDocuments: number;
  maximumProviderReadCalls: number;
  maximumBytes: number;
  maximumInputTokens: number;
  maximumOutputTokens: number;
  maximumRerankCalls: number;
  maximumKnowledgeBaseCalls: number;
  maximumParallelReads: number;
  deadlineMs: number;
  estimatedCostLimitUsd?: number;
}

export interface ResearchMode {
  requestedMode: "standard" | "detailed";
  effectiveMode: "standard" | "detailed";
  reasonCodes: Array<"user_selected" | "server_policy_limit" | "task_complexity">;
}

export interface ResearchQuestion {
  id: string;
  purpose: "required_precondition" | "candidate_discriminator" | "optional_enrichment";
  targetRefs: string[];
  requiredFactRefs: string[];
  expectedDecisionImpact: "required" | "ranking" | "presentation";
  resolutionStatus: "open" | "resolved" | "not_found" | "outside_coverage";
}

export interface ResearchOutcome {
  status: "completed" | "partial_result" | "budget_exhausted" | "needs_user_input";
  verifiedCandidateRefs: string[];
  unresolvedQuestionIds: string[];
  coveredScopes: string[];
  remainingScopes: string[];
  continuationRef?: string;
  stopReason?: ResearchBudgetStopReason;
}

type BudgetCounter = "modelCalls" | "toolCalls" | "bytes" | "inputTokens" | "outputTokens" | "rerankCalls" | "knowledgeBaseCalls";

/** Single-execution reservation ledger. Reserve synchronously before starting parallel work. */
export class ResearchBudgetLedger {
  private readonly consumed: Record<BudgetCounter, number> = { modelCalls: 0, toolCalls: 0, bytes: 0,
    inputTokens: 0, outputTokens: 0, rerankCalls: 0, knowledgeBaseCalls: 0 };
  constructor(readonly budget: ResearchBudget) { validateResearchBudget(budget); }
  reserve(counter: BudgetCounter, amount = 1): boolean {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid research budget reservation");
    const limit = ({ modelCalls: this.budget.maximumModelCalls, toolCalls: this.budget.maximumToolCalls,
      bytes: this.budget.maximumBytes, inputTokens: this.budget.maximumInputTokens, outputTokens: this.budget.maximumOutputTokens,
      rerankCalls: this.budget.maximumRerankCalls, knowledgeBaseCalls: this.budget.maximumKnowledgeBaseCalls })[counter];
    if (this.consumed[counter] + amount > limit) return false;
    this.consumed[counter] += amount;
    return true;
  }
  snapshot(): Readonly<Record<BudgetCounter, number>> { return { ...this.consumed }; }
}

export function selectResearchBudget(
  requestedMode: ResearchMode["requestedMode"],
  serverPolicy: { standard: ResearchBudget; detailed?: ResearchBudget; detailedAllowed: boolean },
): { mode: ResearchMode; budget: ResearchBudget } {
  const detailed = requestedMode === "detailed" && serverPolicy.detailedAllowed && serverPolicy.detailed;
  return detailed ? { mode: { requestedMode, effectiveMode: "detailed", reasonCodes: ["user_selected"] }, budget: structuredClone(detailed) } :
    { mode: { requestedMode, effectiveMode: "standard", reasonCodes: requestedMode === "detailed" ? ["server_policy_limit"] : [] }, budget: structuredClone(serverPolicy.standard) };
}

function validateResearchBudget(value: ResearchBudget): void {
  for (const number of [value.maximumModelCalls, value.maximumToolCalls, value.maximumCandidates, value.maximumDocuments, value.maximumProviderReadCalls,
    value.maximumBytes, value.maximumInputTokens, value.maximumOutputTokens, value.maximumRerankCalls,
    value.maximumKnowledgeBaseCalls, value.maximumParallelReads, value.deadlineMs]) {
    if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid research budget");
  }
  if (value.maximumParallelReads < 1 || value.maximumParallelReads > 8 || !value.policyVersion) throw new Error("Invalid research budget");
}
