import { parseAgentDecisionSummary, type AgentDecisionSummary } from "./agent-decision-summary";
import { outputContract } from "./output-contract";

const structuredPresentationSchema = {
  anyOf: [
    {
      type: "object", additionalProperties: false,
      properties: {
        kind: { const: "source-explanation" },
        sections: { type: "array", minItems: 1, maxItems: 6, items: {
          type: "object", additionalProperties: false,
          properties: {
            evidenceId: { type: "string" }, quote: { type: "string", maxLength: 400 },
            mode: { type: "string", enum: ["feature", "comparison", "recommendation"] },
            preference: { type: "object", additionalProperties: false,
              properties: { field: { type: "string" }, value: { type: "string" } }, required: ["field", "value"] },
          }, required: ["evidenceId", "quote", "mode"],
        } },
      }, required: ["kind", "sections"],
    },
    {
      type: "object", additionalProperties: false,
      properties: {
        kind: { const: "travel-plan" },
        startDate: { anyOf: [{ type: "string" }, { type: "null" }] },
        candidates: { type: "array", minItems: 1, maxItems: 3, items: {
          type: "object", additionalProperties: false,
          properties: {
            evidenceId: { type: "string" }, quote: { type: "string", maxLength: 400 }, photoEvidenceId: { type: "string" },
            itinerary: { type: "array", minItems: 1, maxItems: 90, items: {
              type: "object", additionalProperties: false,
              properties: {
                day: { type: "integer" }, freeDay: { type: "boolean" },
                activities: { type: "array", maxItems: 24, items: {
                  type: "object", additionalProperties: false,
                  properties: {
                    period: { type: "string", enum: ["morning", "afternoon", "evening", "day", "unscheduled"] },
                    activity: { type: "string", enum: ["arrival_and_local_lunch", "visit_featured_place", "leisurely_walk", "cafe_break", "check_in_and_rest", "local_dinner", "quiet_morning", "visit_nearby", "souvenir_and_departure", "stay_and_relax"] },
                    title: { type: "string" }, kind: { type: "string", enum: ["transport", "stay", "activity", "free-time"] }, sourceRef: { type: "string" },
                  }, required: ["period"],
                } },
              }, required: ["day", "activities"],
            } },
            estimate: { type: "object", additionalProperties: false,
              properties: {
                currency: { const: "JPY" }, partySize: { type: "integer" }, nights: { type: "integer" },
                originTravel: { type: "string", enum: ["included", "excluded"] },
                lodgingClass: { type: "string", enum: ["economy", "standard", "premium"] },
                items: { type: "object", additionalProperties: false,
                  properties: { transport: { type: "integer" }, accommodation: { type: "integer" }, sightseeing: { type: "integer" }, food: { type: "integer" } },
                  required: ["transport", "accommodation", "sightseeing", "food"] },
              }, required: ["currency", "partySize", "nights", "originTravel", "lodgingClass", "items"] },
          }, required: ["evidenceId", "quote", "itinerary", "estimate"],
        } },
      }, required: ["kind", "startDate", "candidates"],
    },
  ],
};

const agentTurnOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    responseText: { type: "string", minLength: 1, maxLength: 12_000 },
    presentation: structuredPresentationSchema,
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
};

export const agentTurnOutputContract = outputContract(
  "agent_turn_result",
  "1",
  agentTurnOutputSchema,
  "Semantic decision and user-visible response",
);

/** Final answers backed by retrieved place sources must carry the typed
 * presentation that Application validates and renders. Native toolUse responses
 * are unaffected because Bedrock does not apply the final text schema to them. */
export const agentTurnPresentationOutputContract = outputContract(
  "agent_turn_result",
  "2",
  { ...agentTurnOutputSchema, required: ["responseText", "presentation", "decision"] },
  "Semantic decision and required Evidence-bound presentation",
);

export interface DecodedAgentTurnOutput {
  responseText: string;
  decision: AgentDecisionSummary;
  presentation?: Record<string, unknown>;
}

export function decodeAgentTurnOutput(value: unknown): DecodedAgentTurnOutput | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !["responseText", "decision", "presentation"].includes(key)) ||
    typeof value.responseText !== "string" || !value.responseText.trim() || value.responseText.length > 12_000) return undefined;
  const decision = parseAgentDecisionSummary(value.decision);
  const presentation = value.presentation;
  if (presentation !== undefined && (!isRecord(presentation) || !["source-explanation", "travel-plan"].includes(String(presentation.kind)))) return undefined;
  return decision ? { responseText: value.responseText, decision, ...(presentation ? { presentation } : {}) } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
