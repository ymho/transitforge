export type AgentDiagnosticPhase = "context" | "decision" | "tool" | "evidence" | "presentation" | "runtime" | "save" | "research" | "cache";
export type AgentDiagnosticReason = "compiled" | "validated" | "rejected" | "completed" | "failed" | "partial" |
  "not_loaded" | "stale_revision" | "budget_exhausted" | "schema_invalid" | "provider_refusal" | "provider_timeout" |
  "completion_ambiguous";

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
