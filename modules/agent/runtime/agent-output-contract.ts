import type { MissingRequirement } from "./semantic-decision";
import { inTripPresentations, validInTripAnswerPlan, type InTripAnswerPlan } from "./in-trip-answer-plan";
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
                    title: { type: "string", minLength: 1, maxLength: 300 }, kind: { type: "string", enum: ["transport", "stay", "activity", "free-time"] }, sourceRef: { type: "string", minLength: 1, maxLength: 300 },
                  }, required: ["period", "title", "kind"],
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
          }, required: ["evidenceId", "quote", "itinerary"],
        } },
      }, required: ["kind", "startDate", "candidates"],
    },
  ],
};

const missingRequirementSchema = {
  type: "object", additionalProperties: false,
  properties: {
    action: { const: "ask" }, field: { type: "string" }, targetRef: { type: "string" },
    resolution: { type: "string", enum: ["user_decision", "authorization"] }, reason: { type: "string", maxLength: 240 },
  },
  required: ["action", "field", "resolution", "reason"],
};

const inTripAnswerPlanSchema = {
  type: "object", additionalProperties: false,
  properties: {
    evidence: { type: "array", minItems: 1, maxItems: 6, items: {
      type: "object", additionalProperties: false,
      properties: {
        evidenceId: { type: "string", minLength: 1, maxLength: 160 },
        presentation: { type: "string", enum: [...inTripPresentations] },
      },
      required: ["evidenceId", "presentation"],
    } },
  },
  required: ["evidence"],
};

function answerSchema(presentationRequired: boolean) {
  return {
    type: "object", additionalProperties: false,
    properties: {
      kind: { const: "answer" }, responseText: { type: "string", minLength: 1, maxLength: 12_000 },
      evidenceIds: { type: "array", items: { type: "string", minLength: 1, maxLength: 160 }, maxItems: 10 },
      presentation: structuredPresentationSchema,
      inTripAnswerPlan: inTripAnswerPlanSchema,
    },
    required: presentationRequired ? ["kind", "responseText", "presentation"] : ["kind", "responseText"],
  };
}

const askSchema = {
  type: "object", additionalProperties: false,
  properties: {
    kind: { const: "ask" }, responseText: { type: "string", minLength: 1, maxLength: 12_000 },
    missingRequirements: { type: "array", minItems: 1, maxItems: 4, items: missingRequirementSchema },
  },
  required: ["kind", "responseText", "missingRequirements"],
};

/** Final text has only two observable actions. Tool selection remains native toolUse. */
export const agentTurnOutputContract = outputContract(
  "agent_turn_result", "4", { anyOf: [answerSchema(false), askSchema] },
  "User-visible answer or an explicit user decision request",
);

export const agentTurnPresentationOutputContract = outputContract(
  "agent_turn_result", "4-presentation", { anyOf: [answerSchema(true), askSchema] },
  "User-visible answer with Evidence-bound presentation, or an explicit user decision request",
);

/** Destination research may answer with a source-bound itinerary or an explicit question.
 * Removing the source-explanation branch prevents a valid but incomplete consultation. */
export const agentTurnPlanningOutputContract = outputContract(
  "agent_turn_result", "5-planning", { anyOf: [{ ...answerSchema(true), properties: {
    ...answerSchema(true).properties, presentation: structuredPresentationSchema.anyOf[1],
  } }, askSchema] },
  "Evidence-bound travel itinerary or an explicit user decision request",
);

export type DecodedAgentTurnOutput =
  | { kind: "answer"; responseText: string; evidenceIds?: string[]; presentation?: Record<string, unknown>; inTripAnswerPlan?: InTripAnswerPlan }
  | { kind: "ask"; responseText: string; missingRequirements: MissingRequirement[] };

export function decodeAgentTurnOutput(value: unknown): DecodedAgentTurnOutput | undefined {
  if (!isRecord(value) || typeof value.responseText !== "string" || !value.responseText.trim() || value.responseText.length > 12_000) return undefined;
  if (value.kind === "ask") {
    if (!hasOnlyKeys(value, ["kind", "responseText", "missingRequirements"]) || !askRequirements(value.missingRequirements)) return undefined;
    return { kind: "ask", responseText: value.responseText, missingRequirements: value.missingRequirements };
  }
  if (value.kind !== "answer" || !hasOnlyKeys(value, ["kind", "responseText", "evidenceIds", "presentation", "inTripAnswerPlan"]) ||
      value.evidenceIds !== undefined && !evidenceIds(value.evidenceIds) ||
      value.inTripAnswerPlan !== undefined && !validInTripAnswerPlan(value.inTripAnswerPlan)) return undefined;
  const presentation = value.presentation;
  if (presentation !== undefined && (!isRecord(presentation) || !["source-explanation", "travel-plan"].includes(String(presentation.kind)))) return undefined;
  return { kind: "answer", responseText: value.responseText,
    ...(value.evidenceIds ? { evidenceIds: [...value.evidenceIds as string[]] } : {}), ...(presentation ? { presentation } : {}),
    ...(value.inTripAnswerPlan ? { inTripAnswerPlan: value.inTripAnswerPlan } : {}) };
}

function askRequirements(value: unknown): value is MissingRequirement[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 4 && value.every((item) => isRecord(item) &&
    hasOnlyKeys(item, ["action", "field", "targetRef", "resolution", "reason"]) && item.action === "ask" && identifier(item.field) &&
    (item.targetRef === undefined || typeof item.targetRef === "string" && item.targetRef.length <= 200) &&
    ["user_decision", "authorization"].includes(String(item.resolution)) && typeof item.reason === "string" && item.reason.trim() === item.reason && item.reason.length > 0 && item.reason.length <= 240);
}
function evidenceIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 10 && new Set(value).size === value.length &&
    value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 160 && id.trim() === id);
}
function identifier(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean { const allowed = new Set(keys); return Object.keys(value).every((key) => allowed.has(key)); }
