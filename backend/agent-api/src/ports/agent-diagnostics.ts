export type AgentDiagnosticPhase = "context" | "decision" | "tool" | "evidence" | "presentation" | "runtime" | "save" | "research" | "cache";
export type AgentDiagnosticReason = "compiled" | "validated" | "rejected" | "completed" | "failed" | "partial" |
  "not_loaded" | "stale_revision" | "budget_exhausted" | "schema_invalid" | "provider_refusal" | "provider_timeout" | "provider_error" |
  "response_rejected" | "model_invalid_schema" | "invalid_initial_evidence" | "missing_tool_call" | "invalid_in_trip_answer_plan" |
  "invalid_response_contract" | "invalid_used_evidence_ids" | "unbound_candidate_source" |
  "completion_ambiguous" | "iteration_budget" | "model_budget" | "tool_budget" | "deadline" | "finalization_tool_calls" |
  "planning_progress_required" | "planning_evidence_required" | "planning_plan_required" | "place_photo_required" | "final_response_policy_rejected";

/** Allowlisted operational data only. No prompt, profile text, coordinates, URL or reservation value. */
export interface AgentDiagnosticEvent {
  version: "agent-diagnostic-v1";
  executionId: string;
  phase: AgentDiagnosticPhase;
  reason: AgentDiagnosticReason;
  occurredAt: string;
  correlation?: { modelCallId?: string; toolCallId?: string; turnId?: string; tripRevision?: number };
  counts?: Partial<Record<"acceptedCharacters" | "included" | "omitted" | "generated" | "validated" | "published" |
    "inputTokens" | "outputTokens" | "cacheReadInputTokens" | "cacheWriteInputTokens" | "parallelReads" | "retries", number>>;
  refs?: string[];
  mode?: string;
  incomplete?: boolean;
}

export interface AgentDiagnosticsSink { record(event: AgentDiagnosticEvent): Promise<void> }
