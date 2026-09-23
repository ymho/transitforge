import { createHash } from "node:crypto";
import { createItineraryCandidateSet, type ItineraryCandidateSet, type PlanCoverage, type PlanVariant } from "@raiquora/trip/itinerary-candidates";
import { bindPublicPlanTarget, parsePublicPlanPresentation, type PublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";
import { requireTripPrincipal, type TripPrincipal } from "../ports/trip-repository.js";
import type { ItineraryCandidateRepository } from "../ports/itinerary-candidate-repository.js";
import { TripResourceError } from "../contracts/trip-api.js";
import type { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { failedAgentToolResult, successfulAgentToolResult } from "@raiquora/agent/tool-contract";

export interface CanonicalPlanCandidateDraft { variants: readonly PlanVariant[]; coverage: PlanCoverage }
export interface CandidateRetentionScope {
  principal: TripPrincipal;
  executionId: string;
  conversationId: string;
  userRequest: string;
  tripId: string;
  baseTripRevision: number;
}

/** Registers the canonical proposal Tool. Published output is attached only after the Runtime completes. */
export function registerPlanCandidateRetentionTool(tools: AgentToolRegistry, application: PlanCandidateRetentionApplication,
  scope: CandidateRetentionScope, publish: (value: RetainedCandidatePlan) => void): void {
  tools.register<unknown, unknown>({ name: "propose_itinerary_candidate_set", effect: "proposal",
    description: "旅行全体の複数案をtyped candidateとして提示する。候補ID・Trip/revision・期限はServerが発行し、保存は利用者確認後に別経路で行う。",
    inputSchema: candidateProposalInputSchema,
    outputSchema: { type: "object", properties: { candidateSetId: { type: "string" }, revision: { type: "integer" }, presentationId: { type: "string" }, saved: { type: "boolean" }, confirmationRequired: { type: "boolean" } },
      required: ["candidateSetId", "revision", "presentationId", "saved", "confirmationRequired"], additionalProperties: false },
    parseInput(value) {
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["draft", "presentation"].includes(key)) || !("draft" in value) || !("presentation" in value)) {
        return { ok: false, error: { code: "invalid_input", message: "canonical candidate draft and presentation are required", retryable: false } };
      }
      return { ok: true, input: structuredClone(value) };
    },
    async execute(input) {
      try {
        const value = input as { draft: CanonicalPlanCandidateDraft; presentation: PublicPlanPresentation };
        const parsed = parsePublicPlanPresentation(value.presentation);
        // Until Tool Evidence can expose a validated ID set to this proposal Tool, factual refs are not admitted.
        if (parsed.evidenceRefs.length || parsed.photoRefs.length || parsed.statements.some(({ kind }) => kind === "fact") ||
            parsed.candidates.some((candidate) => candidate.items.some((item) => item.evidenceRefs.length || item.photoRefs.length)) ||
            value.draft.variants.some((variant) => variant.items.some((item) => item.evidenceRefs.length))) throw new Error("Unverified Evidence reference");
        const retained = await application.retain(scope, value.draft, parsed); publish(retained);
        return successfulAgentToolResult({ candidateSetId: retained.candidateSet.id, revision: retained.candidateSet.revision,
          presentationId: retained.presentation.presentationId, saved: false, confirmationRequired: true });
      } catch { return failedAgentToolResult({ code: "precondition_failed", message: "候補案の型、日順、Trip revisionを確認してください", retryable: false }); }
    },
  });
}

const ref = { type: "string", minLength: 1, maxLength: 300 } as const;
const stringArray = (maximum: number) => ({ type: "array", maxItems: maximum, items: ref });
const zonedInstantSchema = { type: "object", additionalProperties: false, properties: {
  at: { type: "string" }, timeZone: { type: "string" },
}, required: ["at", "timeZone"] } as const;
const durationRangeSchema = { type: "object", additionalProperties: false, properties: {
  minimum: { type: "integer", minimum: 0 }, maximum: { type: "integer", minimum: 0 },
}, required: ["minimum", "maximum"] } as const;
const scheduleSchema = { type: "object", additionalProperties: false, properties: {
  type: { type: "string", enum: ["fixed", "window", "day", "relative", "unscheduled"] }, startAt: zonedInstantSchema, endAt: zonedInstantSchema,
  earliestStart: zonedInstantSchema, latestEnd: zonedInstantSchema, durationMinutes: { anyOf: [{ type: "integer", minimum: 0 }, durationRangeSchema] },
  date: { type: "string" }, endDate: { type: "string" }, timeZone: { type: "string" },
  dayId: ref, part: { type: "string", enum: ["morning", "afternoon", "evening", "overnight"] }, endDayId: ref,
}, required: ["type"] } as const;
const publicItemSchema = { type: "object", additionalProperties: false, properties: { itemRef: ref, sourceRef: ref, title: { type: "string", minLength: 1, maxLength: 300 },
  kind: { type: "string", enum: ["transport", "stay", "activity", "free-time"] }, timing: { type: "string", enum: ["fixed", "window", "day", "unscheduled"] },
  evidenceRefs: stringArray(0), photoRefs: stringArray(0) },
  required: ["itemRef", "sourceRef", "title", "kind", "timing", "evidenceRefs", "photoRefs"] } as const;
const workloadSchema = { type: "object", additionalProperties: false, properties: {
  status: { type: "string", enum: ["known", "partial", "unknown"] }, travelMinutes: { type: "integer", minimum: 0 },
}, required: ["status"] } as const;
const costSchema = { type: "object", additionalProperties: false, properties: {
  status: { type: "string", enum: ["known", "partial", "unknown"] }, currency: { type: "string" }, amountMinor: { type: "integer", minimum: 0 },
}, required: ["status"] } as const;
const coverageSchema = { type: "object", additionalProperties: false, properties: {
  status: { type: "string", enum: ["complete", "partial"] }, coveredDayRefs: stringArray(1800), omittedDayRefs: stringArray(1800), omittedScopes: stringArray(100),
}, required: ["status", "coveredDayRefs", "omittedDayRefs", "omittedScopes"] } as const;
const statementSchema = { type: "object", additionalProperties: false, properties: {
  kind: { type: "string", enum: ["proposal", "assumption"] }, ref, evidenceRefs: stringArray(0),
}, required: ["kind", "ref", "evidenceRefs"] } as const;
const researchOutcomeSchema = { type: "object", additionalProperties: false, properties: {
  status: { type: "string", enum: ["complete", "partial", "failed"] }, requestedMode: { type: "string", enum: ["standard", "detailed"] },
  effectiveMode: { type: "string", enum: ["standard", "detailed"] }, budget: { type: "object", additionalProperties: false, properties: {
    modelCalls: { type: "integer", minimum: 0 }, toolCalls: { type: "integer", minimum: 0 }, wallClockMs: { type: "integer", minimum: 0 },
    estimatedCostMinor: { type: "integer", minimum: 0 }, currency: { type: "string" },
  }, required: ["modelCalls", "toolCalls", "wallClockMs"] }, coveredScopes: stringArray(100), remainingScopes: stringArray(100), continuation: ref,
}, required: ["status", "requestedMode", "effectiveMode", "budget", "coveredScopes", "remainingScopes"] } as const;
export const candidateProposalInputSchema: import("@raiquora/agent/tool-contract").AgentToolInputSchema = { type: "object", additionalProperties: false, properties: {
  draft: { type: "object", additionalProperties: false, properties: {
    coverage: { type: "object", additionalProperties: false, properties: { coveredScopes: stringArray(100), omittedScopes: stringArray(100), complete: { type: "boolean" } }, required: ["coveredScopes", "omittedScopes", "complete"] },
    variants: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, properties: {
      id: ref, label: { type: "string", minLength: 1, maxLength: 200 }, timeline: { type: "object", additionalProperties: false, properties: { dayOrder: stringArray(90), itemOrder: stringArray(500) }, required: ["dayOrder", "itemOrder"] },
      items: { type: "array", maxItems: 500, items: { type: "object", additionalProperties: false, properties: { componentId: ref,
        kind: { type: "string", enum: ["transport", "stay", "activity"] }, title: { type: "string", minLength: 1, maxLength: 300 }, schedule: scheduleSchema,
        logicalDayId: ref, sourceCandidateRef: ref, sourcePlaceRef: ref, evidenceRefs: { type: "array", maxItems: 0, items: ref }, exclusiveGroupRef: ref, baseItemId: ref,
        placement: { type: "object", additionalProperties: false, properties: { atBeginning: { type: "boolean" }, afterRef: ref } },
      }, required: ["componentId", "kind", "title", "schedule", "evidenceRefs"] } }, assumptionRefs: stringArray(100), assessmentRefs: stringArray(100),
      basedOnVariantId: ref, changedComponentIds: stringArray(500), removedBaseItemIds: stringArray(100), retainedBaseItemIds: stringArray(100),
      condition: { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["rain", "clear", "budget-change", "custom"] }, assumptionRef: ref }, required: ["kind", "assumptionRef"] }, discoveryRefs: stringArray(100),
    }, required: ["id", "label", "timeline", "items", "assumptionRefs", "assessmentRefs", "changedComponentIds", "removedBaseItemIds", "retainedBaseItemIds"] } },
  }, required: ["variants", "coverage"] },
  presentation: { type: "object", additionalProperties: false, properties: { version: { const: "public-plan-presentation-v1" }, presentationId: ref,
    candidateSetRef: { type: "object", additionalProperties: false, properties: { kind: { const: "unavailable" }, reason: { const: "not-retained" } }, required: ["kind", "reason"] },
    candidateOrder: stringArray(20), candidates: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, properties: { variantId: ref,
      label: { type: "string", minLength: 1, maxLength: 200 }, dayOrder: stringArray(90), days: { type: "array", maxItems: 90, items: { type: "object", additionalProperties: false, properties: { dayRef: ref, label: { type: "string" }, status: { type: "string", enum: ["planned", "free", "not-retrieved"] }, entries: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, properties: { entryRef: ref, itemRef: ref, role: { type: "string", enum: ["start", "continue", "end", "visit", "possible"] } }, required: ["entryRef", "itemRef", "role"] } } }, required: ["dayRef", "label", "status", "entries"] } },
      items: { type: "array", maxItems: 500, items: publicItemSchema }, unknowns: stringArray(100), workload: workloadSchema, cost: costSchema, comparisonAssessmentRefs: stringArray(100), scenarioRefs: stringArray(100),
    }, required: ["variantId", "label", "dayOrder", "days", "items", "unknowns", "comparisonAssessmentRefs", "scenarioRefs"] } },
    evidenceRefs: { type: "array", maxItems: 0, items: ref }, photoRefs: { type: "array", maxItems: 0, items: ref }, coverage: coverageSchema,
    statements: { type: "array", maxItems: 300, items: statementSchema }, comparisonAssessmentRefs: stringArray(100), scenarioRefs: stringArray(100), researchOutcome: researchOutcomeSchema,
  }, required: ["version", "presentationId", "candidateSetRef", "candidateOrder", "candidates", "evidenceRefs", "photoRefs", "coverage", "statements", "comparisonAssessmentRefs", "scenarioRefs", "researchOutcome"] },
}, required: ["draft", "presentation"] };
export interface RetainedCandidatePlan { candidateSet: ItineraryCandidateSet; presentation: PublicPlanPresentation }

/** Trusted output boundary used by the candidate-generation Tool. IDs/context are server-issued, never copied from model input. */
export class PlanCandidateRetentionApplication {
  constructor(private readonly repository: ItineraryCandidateRepository, private readonly now: () => Date = () => new Date()) {}
  async retain(scope: CandidateRetentionScope, draft: CanonicalPlanCandidateDraft, inputPresentation: PublicPlanPresentation): Promise<RetainedCandidatePlan> {
    requireTripPrincipal(scope.principal);
    if (!scope.conversationId || !scope.executionId || !scope.userRequest.trim() || !scope.tripId || !Number.isSafeInteger(scope.baseTripRevision) || scope.baseTripRevision < 0) throw new TripResourceError("invalid-input");
    const now = this.now(); if (!Number.isFinite(now.getTime())) throw new TripResourceError("unavailable");
    const candidateSet = createItineraryCandidateSet({ id: scope.executionId, revision: 0,
      contextRef: { conversationId: scope.conversationId, requestFingerprint: createHash("sha256").update(scope.userRequest).digest("hex"),
        tripId: scope.tripId, baseTripRevision: scope.baseTripRevision }, variants: structuredClone(draft.variants), coverage: structuredClone(draft.coverage),
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() });
    const parsed = parsePublicPlanPresentation(inputPresentation);
    if (parsed.candidateSetRef.kind !== "unavailable" || parsed.candidateOrder.length !== candidateSet.variants.length ||
        parsed.candidateOrder.some((id, index) => id !== candidateSet.variants[index]!.id)) throw new TripResourceError("invalid-input");
    await this.repository.put(scope.principal, candidateSet);
    const presentation = bindPublicPlanTarget(parsePublicPlanPresentation({ ...parsed, candidateSetRef: { kind: "candidate-set-ref", candidateSetId: candidateSet.id,
      revision: candidateSet.revision, baseTripRevision: scope.baseTripRevision } }), { tripId: scope.tripId, baseTripRevision: scope.baseTripRevision });
    return { candidateSet, presentation };
  }
}
