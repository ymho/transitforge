import { createHash } from "node:crypto";
import { createItineraryCandidateSet, type ItineraryCandidateSet, type PlanCoverage, type PlanVariant } from "@raiquora/trip/itinerary-candidates";
import { bindPublicPlanTarget, type PublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";
import { requireTripPrincipal, type TripPrincipal } from "../ports/trip-repository.js";
import type { ItineraryCandidateRepository } from "../ports/itinerary-candidate-repository.js";
import { projectCandidatePresentation } from "./plan-candidate-presentation.js";
import { TripResourceError } from "../contracts/trip-api.js";
import { validateAgentToolInput } from "@raiquora/agent/agent-tool-input-validator";
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
export const draftItineraryToolName = "draft_itinerary" as const;

/** Registers the canonical proposal Tool. Published output is attached only after the Runtime completes. */
export function registerPlanCandidateRetentionTool(tools: AgentToolRegistry, application: PlanCandidateRetentionApplication,
  scope: CandidateRetentionScope, publish: (value: RetainedCandidatePlan) => void): void {
  tools.register<unknown, unknown>({ name: draftItineraryToolName, effect: "proposal", requiredCapabilities: ["agent-v2-proposal"],
    description: "現在のTripと会話で既知の条件から、1件以上の仮旅程をtyped candidateとして作る。draftへ旅程本体を1回だけ指定する。表示用データはServerが作る。未確認の移動時刻・料金・営業・宿泊を事実として補わずunknownsへ残す。日別の案はschedule.type=relativeとdayIdをtimeline.dayOrderへ一致させる。候補ID・Trip/revision・期限はServerが発行し、Tripへの採用・保存は利用者確認後の別操作で行う。",
    inputSchema: candidateProposalInputSchema,
    outputSchema: { type: "object", properties: { candidateSetId: { type: "string" }, revision: { type: "integer" }, presentationId: { type: "string" }, saved: { type: "boolean" }, confirmationRequired: { type: "boolean" } },
      required: ["candidateSetId", "revision", "presentationId", "saved", "confirmationRequired"], additionalProperties: false },
    parseInput: value => validateAgentToolInput(candidateProposalInputSchema, value),
    async execute(input) {
      try {
        const value = input as { draft: CanonicalPlanCandidateDraft; unknowns: string[] };
        const retained = await application.retain(scope, value.draft, value.unknowns); publish(retained);
        return successfulAgentToolResult({ candidateSetId: retained.candidateSet.id, revision: retained.candidateSet.revision,
          presentationId: retained.presentation.presentationId, saved: false, confirmationRequired: true });
      } catch (error) { return failedAgentToolResult({ code: error instanceof TripResourceError && error.code === "invalid-input" ? "invalid_input" : "unavailable", message: "候補案を保持できませんでした", retryable: false }); }
    },
  });
}

const ref = { type: "string", minLength: 1, maxLength: 120, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" } as const;
const stringArray = (maximum: number) => ({ type: "array", maxItems: maximum, uniqueItems: true, items: ref });
const scopeArray = { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 300 } };
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
  dayId: { ...ref, maxLength: 80 }, part: { type: "string", enum: ["morning", "afternoon", "evening", "overnight"] }, endDayId: { ...ref, maxLength: 80 },
}, required: ["type"] } as const;
export const candidateProposalInputSchema: import("@raiquora/agent/tool-contract").AgentToolInputSchema = { type: "object", additionalProperties: false, properties: {
  draft: { type: "object", additionalProperties: false, properties: {
    coverage: { type: "object", additionalProperties: false, properties: { coveredScopes: scopeArray, omittedScopes: scopeArray, complete: { type: "boolean" } }, required: ["coveredScopes", "omittedScopes", "complete"] },
    variants: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, properties: {
      id: ref, label: { type: "string", minLength: 1, maxLength: 200 }, timeline: { type: "object", additionalProperties: false, properties: { dayOrder: stringArray(90), itemOrder: stringArray(500) }, required: ["dayOrder", "itemOrder"] },
      items: { type: "array", maxItems: 500, items: { type: "object", additionalProperties: false, properties: { componentId: ref,
        kind: { type: "string", enum: ["transport", "stay", "activity"] }, title: { type: "string", minLength: 1, maxLength: 300 }, schedule: scheduleSchema,
        logicalDayId: { ...ref, maxLength: 80 }, evidenceRefs: { type: "array", maxItems: 0, items: ref }, exclusiveGroupRef: ref, baseItemId: ref,
        placement: { type: "object", additionalProperties: false, properties: { atBeginning: { type: "boolean" }, afterRef: ref } },
      }, required: ["componentId", "kind", "title", "schedule", "evidenceRefs"] } }, assumptionRefs: stringArray(100), assessmentRefs: stringArray(0),
      basedOnVariantId: ref, changedComponentIds: stringArray(500), removedBaseItemIds: stringArray(100), retainedBaseItemIds: stringArray(100),
      condition: { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["rain", "clear", "budget-change", "custom"] }, assumptionRef: ref }, required: ["kind", "assumptionRef"] }, discoveryRefs: stringArray(0),
    }, required: ["id", "label", "timeline", "items", "assumptionRefs", "assessmentRefs", "changedComponentIds", "removedBaseItemIds", "retainedBaseItemIds"] } },
  }, required: ["variants", "coverage"] },
  unknowns: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 300 },
    description: "全案に共通する未確認事項。料金・移動時刻・宿泊等を推測で埋めない。" },
}, required: ["draft", "unknowns"] };
export interface RetainedCandidatePlan { candidateSet: ItineraryCandidateSet; presentation: PublicPlanPresentation }

/** Trusted output boundary used by the candidate-generation Tool. IDs/context are server-issued, never copied from model input. */
export class PlanCandidateRetentionApplication {
  constructor(private readonly repository: ItineraryCandidateRepository, private readonly now: () => Date = () => new Date()) {}
  async retain(scope: CandidateRetentionScope, draft: CanonicalPlanCandidateDraft, unknowns: readonly string[]): Promise<RetainedCandidatePlan> {
    requireTripPrincipal(scope.principal);
    if (!scope.conversationId || !scope.executionId || !scope.userRequest.trim() || !scope.tripId || !Number.isSafeInteger(scope.baseTripRevision) || scope.baseTripRevision < 0) throw new TripResourceError("invalid-input");
    const now = this.now(); if (!Number.isFinite(now.getTime())) throw new TripResourceError("unavailable");
    let candidateSet: ItineraryCandidateSet, presentation: PublicPlanPresentation;
    try {
      candidateSet = createItineraryCandidateSet({ id: scope.executionId, revision: 0,
      contextRef: { conversationId: scope.conversationId, requestFingerprint: createHash("sha256").update(scope.userRequest).digest("hex"),
        tripId: scope.tripId, baseTripRevision: scope.baseTripRevision }, variants: structuredClone(draft.variants), coverage: structuredClone(draft.coverage),
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() });
      // Validate the derived read model before the immutable candidate write.
      presentation = bindPublicPlanTarget(projectCandidatePresentation(candidateSet, unknowns),
      { tripId: scope.tripId, baseTripRevision: scope.baseTripRevision });
    } catch { throw new TripResourceError("invalid-input"); }
    await this.repository.put(scope.principal, candidateSet);
    return { candidateSet, presentation };
  }
}
