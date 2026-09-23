import { parseAgentDecisionSummary, type AgentDecisionSummary } from "./agent-decision-summary";
import { outputContract } from "./output-contract";

export const agentTurnOutputContract = outputContract("agent_turn_result", "1", {
  type: "object",
  additionalProperties: false,
  properties: {
    responseText: { type: "string", minLength: 1, maxLength: 12_000 },
    decision: {
      type: "object",
      additionalProperties: false,
      properties: {
        interpretedGoal: { type: "string", minLength: 1, maxLength: 240 },
        hardConstraints: { type: "array", items: { $ref: "#/$defs/decisionValue" }, maxItems: 12 },
        softPreferences: { type: "array", items: { $ref: "#/$defs/decisionValue" }, maxItems: 12 },
        selectedAction: { type: "string", enum: ["use_tool", "ask_user", "answer"] },
        selectedTool: { type: "string" },
        unresolvedFacts: { type: "array", items: { type: "string" }, maxItems: 8 },
        reasonCodes: { type: "array", items: { type: "string" }, maxItems: 6 },
        replanReason: { type: "string", enum: ["tool_result_received", "tool_failed", "evidence_insufficient", "constraint_conflict", "new_information"] },
        usedEvidenceIds: { type: "array", items: { type: "string" }, maxItems: 10 },
        inTripAnswerPlan: { type: "object", additionalProperties: false, properties: {
          evidence: { type: "array", minItems: 1, maxItems: 6, items: { $ref: "#/$defs/inTripReference" } },
        }, required: ["evidence"] },
        missingRequirements: { type: "array", items: { $ref: "#/$defs/missingRequirement" }, maxItems: 8 },
      },
      required: ["interpretedGoal", "hardConstraints", "softPreferences", "selectedAction", "unresolvedFacts", "reasonCodes"],
    },
  },
  required: ["responseText", "decision"],
  $defs: {
    decisionValue: {
      type: "object", additionalProperties: false,
      properties: { key: { type: "string" }, value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] } },
      required: ["key", "value"],
    },
    missingRequirement: {
      type: "object", additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["use_tool", "ask", "present", "propose"] },
        field: { type: "string" }, targetRef: { type: "string" },
        resolution: { type: "string", enum: ["tool", "assumption", "user_decision", "authorization"] },
        reason: { type: "string" },
      },
      required: ["action", "field", "resolution", "reason"],
    },
    inTripReference: { type: "object", additionalProperties: false, properties: {
      evidenceId: { type: "string", minLength: 1, maxLength: 160 },
      presentation: { type: "string", enum: ["planned-itinerary", "rail-impact", "environment-impact", "reservation", "location-permission", "uncertainty", "external-result"] },
    }, required: ["evidenceId", "presentation"] },
  },
}, "Semantic decision and user-visible response");

export interface DecodedAgentTurnOutput {
  responseText: string;
  decision: AgentDecisionSummary;
}

export function decodeAgentTurnOutput(value: unknown): DecodedAgentTurnOutput | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "responseText" && key !== "decision") ||
    typeof value.responseText !== "string" || !value.responseText.trim() || value.responseText.length > 12_000) return undefined;
  const decision = parseAgentDecisionSummary(value.decision);
  return decision ? { responseText: value.responseText, decision } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
