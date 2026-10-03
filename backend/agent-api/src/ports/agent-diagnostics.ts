export type AgentDiagnosticPhase = "interpret" | "resolve" | "authorize" | "reduce" | "accept" | "compile-context" | "select-action" |
  "tool" | "respond" | "publish" | "context" | "decision" | "evidence" | "presentation" | "execution" | "runtime" | "save" | "research" | "cache";
export type AgentDiagnosticReason = "compiled" | "validated" | "rejected" | "completed" | "failed" | "partial" |
  "started" | "no_change" | "ambiguous" | "unsupported" | "accepted" |
  "not_loaded" | "stale_revision" | "budget_exhausted" | "schema_invalid" | "provider_refusal" | "provider_timeout" | "provider_error" |
  "response_rejected" | "model_invalid_schema" | "invalid_initial_evidence" | "missing_tool_call" | "invalid_in_trip_answer_plan" |
  "invalid_response_contract" | "invalid_used_evidence_ids" | "unbound_candidate_source" |
  "completion_ambiguous" | "iteration_budget" | "model_budget" | "tool_budget" | "deadline" | "finalization_tool_calls" |
  "output_token_budget" | "total_token_budget" | "model_output_limit" | "context_window_limit" | "cancelled" |
  "planning_progress_required" | "planning_evidence_required" | "planning_plan_required" | "place_photo_required" | "final_response_policy_rejected";

/** Backend-owned allowlist, not an SDK import or an arbitrary provider string. */
export type AgentExecutionStopReason = "endTurn" | "toolUse" | "stopSequence" | "limitTurns" | "limitTotalTokens" |
  "limitOutputTokens" | "maxTokens" | "modelContextWindowExceeded" | "cancelled" | "contentFiltered" |
  "guardrailIntervened" | "unknown" | "not_recorded";
export type AgentExecutionCounts = Partial<Record<"modelCalls" | "toolCalls" | "conditionToolCalls" | "structuredOutputCalls" | "inputTokens" | "outputTokens" | "totalTokens", number>>;
export interface AgentExecutionDiagnostic {
  reason: AgentDiagnosticReason;
  stopReason: AgentExecutionStopReason;
  limitReason?: "tool_calls" | "deadline";
  /** Absent measurements stay absent; an SDK exception is not proof of zero usage. */
  counts?: AgentExecutionCounts;
}

/** Allowlisted operational data only. No prompt, profile text, coordinates, URL or reservation value. */
export interface AgentDiagnosticEvent {
  version: "agent-diagnostic-v1";
  executionId: string;
  phase: AgentDiagnosticPhase;
  reason: AgentDiagnosticReason;
  occurredAt: string;
  correlation?: { modelCallId?: string; toolCallId?: string; turnId?: string; tripRevision?: number; intentRevision?: number;
    schemaVersion?: string; ruleVersion?: string };
  counts?: Partial<Record<"acceptedCharacters" | "included" | "omitted" | "generated" | "validated" | "published" |
    "inputTokens" | "outputTokens" | "totalTokens" | "modelCalls" | "toolCalls" | "conditionToolCalls" | "structuredOutputCalls" |
    "cacheReadInputTokens" | "cacheWriteInputTokens" | "parallelReads" | "retries", number>>;
  stopReason?: AgentExecutionStopReason;
  limitReason?: "tool_calls" | "deadline";
  toolErrorCode?: import("@raiquora/agent/tool-contract").AgentToolErrorCode;
  refs?: string[];
  mode?: string;
  incomplete?: boolean;
}

export interface AgentDiagnosticsSink { record(event: AgentDiagnosticEvent): Promise<void> }
