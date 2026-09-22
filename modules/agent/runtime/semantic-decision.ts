import type { AgentDecisionSummary } from "./agent-decision-summary";

export type MissingRequirementResolution = "tool" | "assumption" | "user_decision" | "authorization";
export interface MissingRequirement {
  action: "use_tool" | "ask" | "present" | "propose";
  field: string;
  targetRef?: string;
  resolution: MissingRequirementResolution;
  reason: string;
}
interface DecisionBase {
  version: 1;
  interpretedGoal: string;
  targetRefs: string[];
  constraintRefs: string[];
  missingRequirements: MissingRequirement[];
  usedEvidenceIds: string[];
}
export type SemanticDecision =
  | DecisionBase & { action: "use_tool"; toolName: string }
  | DecisionBase & { action: "ask"; questionRefs: string[] }
  | DecisionBase & { action: "present" }
  | DecisionBase & { action: "propose"; proposalKind: "trip_update" | "consultation_update" | "cost_update" };

export type SemanticDecisionError = "invalid_schema" | "action_mismatch" | "target_mismatch" |
  "missing_requirement_mismatch" | "stale_reference";

export function semanticDecisionFromSummary(summary: AgentDecisionSummary): SemanticDecision {
  const base: DecisionBase = {
    version: 1,
    interpretedGoal: summary.interpretedGoal,
    targetRefs: [],
    constraintRefs: [],
    missingRequirements: summary.missingRequirements ? structuredClone(summary.missingRequirements) : summary.unresolvedFacts.map((field) => ({
      action: summary.selectedAction === "use_tool" ? "use_tool" : summary.selectedAction === "ask_user" ? "ask" : "present",
      field,
      resolution: summary.selectedAction === "use_tool" ? "tool" : "user_decision",
      reason: "legacy_unresolved_fact",
    })),
    usedEvidenceIds: [...(summary.usedEvidenceIds ?? [])],
  };
  if (summary.selectedAction === "use_tool") return { ...base, action: "use_tool", toolName: summary.selectedTool! };
  if (summary.selectedAction === "ask_user") return { ...base, action: "ask", questionRefs: summary.unresolvedFacts };
  return { ...base, action: "present" };
}

export function validateSemanticDecision(input: {
  decision: SemanticDecision;
  nativeToolNames: string[];
  availableToolNames: string[];
  allowedTargetRefs: string[];
}): { valid: true } | { valid: false; error: SemanticDecisionError } {
  const { decision } = input;
  if (decision.version !== 1 || !decision.interpretedGoal.trim() || decision.missingRequirements.some((m) =>
    !m.field.trim() || !m.reason.trim() || !["tool", "assumption", "user_decision", "authorization"].includes(m.resolution))) {
    return { valid: false, error: "invalid_schema" };
  }
  if (decision.targetRefs.some((ref) => !input.allowedTargetRefs.includes(ref))) return { valid: false, error: "target_mismatch" };
  if (decision.action === "use_tool" && (!input.availableToolNames.includes(decision.toolName) ||
    input.nativeToolNames.length !== 1 || input.nativeToolNames[0] !== decision.toolName)) {
    return { valid: false, error: "action_mismatch" };
  }
  if (decision.action !== "use_tool" && input.nativeToolNames.length) return { valid: false, error: "action_mismatch" };
  if (decision.action === "ask" && !decision.missingRequirements.some((m) => m.action === "ask" &&
    (m.resolution === "user_decision" || m.resolution === "authorization"))) {
    return { valid: false, error: "missing_requirement_mismatch" };
  }
  return { valid: true };
}
