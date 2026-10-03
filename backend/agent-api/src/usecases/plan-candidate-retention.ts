import type { EffectiveIntent } from "@raiquora/agent/effective-intent";
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
  baseItemIds?: readonly string[];
}
export const draftItineraryToolName = "draft_itinerary" as const;

/** Registers the canonical proposal Tool. Published output is attached only after the Runtime completes. */
export function registerPlanCandidateRetentionTool(tools: AgentToolRegistry, application: PlanCandidateRetentionApplication,
  scope: CandidateRetentionScope, publish: (value: RetainedCandidatePlan) => void, currentDayCount?: () => number | undefined): void {
  tools.register<unknown, unknown>({ name: draftItineraryToolName, effect: "proposal", requiredCapabilities: ["agent-v2-proposal"],
    description: "現在のTripと会話で既知の条件から、1件以上の仮旅程をtyped candidateとして作る。variantsへ案のlabel・dayCount・itemsを指定する。itemsは行程順にkind・title・day（1始まり）を1回ずつ書く。宿泊等の翌日まで続く項目はendDayを指定する。内部ID・参照配列・表示payloadはServerが生成するため渡さない。確定的な期間条件があればServerがその日数を使う（1泊は2日）。未確認の移動時刻・料金・営業・宿泊を事実として補わずunknownsへ残す。候補ID・Trip/revision・期限はServerが発行し、Tripへの採用・保存は利用者確認後の別操作で行う。",
    inputSchema: candidateProposalInputSchema,
    outputSchema: { type: "object", properties: { candidateSetId: { type: "string" }, revision: { type: "integer" }, presentationId: { type: "string" }, saved: { type: "boolean" }, confirmationRequired: { type: "boolean" } },
      required: ["candidateSetId", "revision", "presentationId", "saved", "confirmationRequired"], additionalProperties: false },
    parseInput: value => validateAgentToolInput(candidateProposalInputSchema, value),
    async execute(input) {
      try {
        const value = input as ItineraryProposalInput;
        const draft = canonicalItineraryDraft(value, scope.baseItemIds ?? [], currentDayCount?.());
        const retained = await application.retain(scope, draft, value.unknowns); publish(retained);
        return successfulAgentToolResult({ candidateSetId: retained.candidateSet.id, revision: retained.candidateSet.revision,
          presentationId: retained.presentation.presentationId, saved: false, confirmationRequired: true });
      } catch (error) { return failedAgentToolResult({ code: error instanceof TripResourceError && error.code === "invalid-input" ? "invalid_input" : "unavailable", message: "候補案を保持できませんでした", retryable: false }); }
    },
  });
}

interface ItineraryProposalInput {
  variants: { label: string; dayCount: number; items: { kind: "transport" | "stay" | "activity"; title: string;
    day: number; endDay?: number; part?: "morning" | "afternoon" | "evening" | "overnight"; baseItemId?: string }[];
    removedBaseItemIds?: string[] }[];
  unknowns: string[];
}
const baseRef = { type: "string", minLength: 1, maxLength: 120 };
const dayNumber = { type: "integer", minimum: 1, maximum: 90 };
export const candidateProposalInputSchema: import("@raiquora/agent/tool-contract").AgentToolInputSchema = {
  type: "object", additionalProperties: false, properties: {
    variants: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, properties: {
      label: { type: "string", minLength: 1, maxLength: 200 }, dayCount: dayNumber,
      items: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, properties: {
        kind: { type: "string", enum: ["transport", "stay", "activity"] }, title: { type: "string", minLength: 1, maxLength: 300 },
        day: dayNumber, endDay: dayNumber, part: { type: "string", enum: ["morning", "afternoon", "evening", "overnight"] },
        baseItemId: { ...baseRef, description: "既存項目の置換を明示した時だけ、その実在ID。新規なら省略。" },
      }, required: ["kind", "title", "day"] } },
      removedBaseItemIds: { type: "array", maxItems: 100, items: baseRef, description: "削除を明示した既存項目だけ。通常は省略。" },
    }, required: ["label", "dayCount", "items"] } },
    unknowns: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 300 },
      description: "全案に共通する未確認事項。料金・移動時刻・宿泊等を推測で埋めない。" },
  }, required: ["variants", "unknowns"],
};

/** The model supplies proposal content; Application owns canonical identities and links. */
function canonicalItineraryDraft(input: ItineraryProposalInput, baseItemIds: readonly string[], knownDays?: number): CanonicalPlanCandidateDraft {
  const variants: PlanVariant[] = input.variants.map((variant, variantIndex) => {
    const id = `plan-${variantIndex + 1}`, removed = variant.removedBaseItemIds ?? [];
    const dayCount = knownDays ?? variant.dayCount;
    if (!Number.isSafeInteger(dayCount) || dayCount < 1 || dayCount > 90) throw new TripResourceError("invalid-input");
    const replacements = variant.items.flatMap(item => item.baseItemId ? [item.baseItemId] : []);
    if (new Set([...removed, ...replacements]).size !== removed.length + replacements.length ||
        [...removed, ...replacements].some(ref => !baseItemIds.includes(ref))) throw new TripResourceError("invalid-input");
    let anchor = baseItemIds.filter(ref => !removed.includes(ref)).at(-1);
    const items = variant.items.map((item, itemIndex) => {
      if (item.day > dayCount || item.endDay !== undefined && (item.endDay < item.day || item.endDay > dayCount)) throw new TripResourceError("invalid-input");
      const componentId = `${id}-item-${itemIndex + 1}`;
      const value = { componentId, kind: item.kind, title: item.title,
        schedule: { type: "relative" as const, dayId: `day-${item.day}`, ...(item.endDay ? { endDayId: `day-${item.endDay}` } : {}), ...(item.part ? { part: item.part } : {}) },
        evidenceRefs: [], ...(item.baseItemId ? { baseItemId: item.baseItemId } : { placement: anchor ? { afterRef: anchor } : { atBeginning: true as const } }) };
      anchor = componentId;
      return value;
    });
    return { id, label: variant.label, timeline: { dayOrder: Array.from({ length: dayCount }, (_, index) => `day-${index + 1}`), itemOrder: items.map(item => item.componentId) },
      items, assumptionRefs: [], assessmentRefs: [], changedComponentIds: items.map(item => item.componentId), removedBaseItemIds: removed,
      retainedBaseItemIds: baseItemIds.filter(ref => !removed.includes(ref) && !replacements.includes(ref)) };
  });
  return { variants, coverage: { coveredScopes: ["日別の仮旅程"], omittedScopes: [...input.unknowns], complete: input.unknowns.length === 0 } };
}
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

/** Only exact, active trip-wide user conditions define the display horizon.
 * A range, hypothetical condition, profile hint or ambiguity remains a proposal choice. */
export function knownItineraryDayCount(intent: EffectiveIntent | undefined): number | undefined {
  if (!intent) return undefined;
  const whole = (scope: { type: string }) => scope.type === "conversation" || scope.type === "trip";
  const facts = intent.actualConversationFacts.filter(fact => fact.target === "duration" && whole(fact.scope));
  if (facts.length) {
    const fact = facts.length === 1 ? facts[0]! : undefined;
    if (!fact || fact.precision !== "exact" || !["preferred", "required"].includes(fact.modality) || fact.value.kind !== "quantity" || fact.value.unit === "people") return undefined;
    return fact.value.amount + (fact.value.unit === "nights" ? 1 : 0);
  }
  const base = intent.activeBaseFacts.filter(fact => fact.target === "duration" && whole(fact.scope) && fact.authority === "persisted_user");
  const requirement = base.length === 1 ? base[0]!.requirement : undefined;
  return requirement?.type === "duration" && requirement.minimum === requirement.maximum && requirement.minimum !== undefined
    ? requirement.minimum + (requirement.unit === "nights" ? 1 : 0) : undefined;
}
