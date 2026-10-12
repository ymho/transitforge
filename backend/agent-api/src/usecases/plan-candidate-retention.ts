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
import type { Trip, ItineraryItem } from "@raiquora/trip/trip";
import { effectiveTripConstraints } from "@raiquora/trip/trip-request";
import { bindRelativeSchedule, type ItinerarySchedule } from "@raiquora/trip/itinerary-schedule";
import { datedSearchSelectionTarget } from "@raiquora/trip/search-selection-target";

export interface CanonicalPlanCandidateDraft { selectionItems?: readonly ItineraryItem[]; variants: readonly PlanVariant[]; coverage: PlanCoverage }
export interface CandidateRetentionScope {
  principal: TripPrincipal;
  executionId: string;
  conversationId: string;
  userRequest: string;
  tripId: string;
  baseTripRevision: number;
  baseItemIds?: readonly string[];
  baseDayIds?: readonly string[];
  currentTrip?: Trip;
}
export const draftItineraryToolName = "draft_itinerary" as const;

/** Registers the canonical proposal Tool. Published output is attached only after the Runtime completes. */
export function registerPlanCandidateRetentionTool(tools: AgentToolRegistry, application: PlanCandidateRetentionApplication,
  scope: CandidateRetentionScope | (() => CandidateRetentionScope), publish: (value: RetainedCandidatePlan) => void, currentDayCount?: () => number | undefined): void {
  tools.register<unknown, unknown>({ name: draftItineraryToolName, effect: "proposal", requiredCapabilities: ["agent-v2-proposal"],
    description: "旅程の作成・反映を依頼された時に、既知の条件から日別の仮旅程を作る。宿泊施設だけの提案・比較依頼はsearch_accommodationsを使う。空のTripでは出発地などの条件受理の後にこのToolを使う。時刻・経路・宿が未選択でも往路・活動・宿泊・帰路の枠を作りunknownsへ残せる。variantsへlabel・dayCount・itemsを指定する。itemsは行程順にkind・title・day（1始まり）を書く。翌日まで続く宿泊等はendDayを指定する。内部ID・参照配列・表示payloadはServerが生成する。確定的な期間条件があればServerがその日数を使う（1泊は2日）。保存しない比較案はcomparisonOnly=trueと比較対象の日数を指定する。明示時刻はstartTime/endTime/timeQuoteへ渡し、予定名だけに書かない。選択済み宿の到着時刻はbaseItemIdとstartTimeで施設を保持して変更できる。未確認の移動時刻・料金・営業・宿泊を事実として補わない。成功したら最終回答で確認方法と不足条件を短く伝える。Tripへの採用・保存は利用者確認後の別操作で行う。既存旅程への追加は新しく追加する予定だけを指定し、採用済みの移動・宿・観光を再生成しない。変更する未選択の既存予定にはそのbaseItemIdを指定する。選択済みの経路・宿を変更するには検証済み検索候補を使う。",
    inputSchema: candidateProposalInputSchema,
    outputSchema: { type: "object", properties: { candidateSetId: { type: "string" }, revision: { type: "integer" }, presentationId: { type: "string" }, saved: { type: "boolean" }, confirmationRequired: { type: "boolean" }, scope: { type: "string", enum: ["unsaved_itinerary_only"] }, researchPerformed: { type: "boolean", enum: [false] }, tripItemsChanged: { type: "boolean", enum: [false] } },
      required: ["candidateSetId", "revision", "presentationId", "saved", "confirmationRequired", "scope", "researchPerformed", "tripItemsChanged"], additionalProperties: false },
    parseInput: value => validateAgentToolInput(candidateProposalInputSchema, value),
    async execute(input) {
      try {
        const value = input as ItineraryProposalInput;
        const currentScope = typeof scope === "function" ? scope() : scope;
        const draft = canonicalItineraryDraft(value, currentScope.baseItemIds ?? [], currentDayCount?.(), currentScope.baseDayIds ?? [], currentScope.currentTrip, currentScope.userRequest);
        const retained = await application.retain(currentScope, draft, value.unknowns); publish(retained);
        return successfulAgentToolResult({ candidateSetId: retained.candidateSet.id, revision: retained.candidateSet.revision,
          presentationId: retained.presentation.presentationId, saved: false, confirmationRequired: true,
          scope: "unsaved_itinerary_only", researchPerformed: false, tripItemsChanged: false });
      } catch (error) { return failedAgentToolResult({ code: error instanceof TripResourceError && error.code === "invalid-input" ? "invalid_input" : "unavailable", message: "候補案を保持できませんでした", retryable: false }); }
    },
  });
}

interface ItineraryProposalInput {
  variants: { label: string; dayCount: number; comparisonOnly?: boolean; items: { kind: "transport" | "stay" | "activity"; title: string;
    day: number; endDay?: number; part?: "morning" | "afternoon" | "evening" | "overnight"; baseItemId?: string; startTime?: string; endTime?: string; timeQuote?: string }[];
    removedBaseItemIds?: string[] }[];
  unknowns: string[];
}
const baseRef = { type: "string", minLength: 1, maxLength: 120 };
const dayNumber = { type: "integer", minimum: 1, maximum: 90 };
export const candidateProposalInputSchema: import("@raiquora/agent/tool-contract").AgentToolInputSchema = {
  type: "object", additionalProperties: false, properties: {
    variants: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, properties: {
      label: { type: "string", minLength: 1, maxLength: 200 }, dayCount: dayNumber,
      comparisonOnly: { type: "boolean", description: "保存しない比較案。実際の旅行期間と異なる日数を比較する場合true。" },
      items: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, properties: {
        kind: { type: "string", enum: ["transport", "stay", "activity"] }, title: { type: "string", minLength: 1, maxLength: 300 },
        day: dayNumber, endDay: dayNumber, part: { type: "string", enum: ["morning", "afternoon", "evening", "overnight"] },
        startTime: { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", description: "利用者が明示した開始/チェックイン時刻。予定名だけに書かず、この値に格納する。" },
        endTime: { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", description: "利用者が明示した終了/チェックアウト時刻。所要時間から推測しない。" },
        timeQuote: { type: "string", minLength: 1, maxLength: 300, description: "時刻の根拠となる今回の発言の完全な部分文字列。" },
        baseItemId: { ...baseRef, description: "既存項目の置換を明示した時だけ、その実在ID。新規なら省略。" },
      }, required: ["kind", "title", "day"] } },
      removedBaseItemIds: { type: "array", maxItems: 100, items: baseRef, description: "削除を明示した既存項目だけ。通常は省略。" },
    }, required: ["label", "dayCount", "items"] } },
    unknowns: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 300 },
      description: "全案に共通する未確認事項。料金・移動時刻・宿泊等を推測で埋めない。" },
  }, required: ["variants", "unknowns"],
};

/** The model supplies proposal content; Application owns canonical identities and links. */
function canonicalItineraryDraft(input: ItineraryProposalInput, baseItemIds: readonly string[], knownDays?: number, baseDayIds: readonly string[] = [], trip?: Trip, userRequest = ""): CanonicalPlanCandidateDraft {
  const selectionItems: ItineraryItem[] = [];
  const variants: PlanVariant[] = input.variants.map((variant, variantIndex) => {
    const id = `plan-${variantIndex + 1}`, removed = variant.removedBaseItemIds ?? [];
    const draftTrip = variant.comparisonOnly ? undefined : trip;
    const adoptedIds = variant.comparisonOnly ? [] : baseItemIds;
    if (variant.comparisonOnly && (removed.length || variant.items.some(item => item.baseItemId))) throw new TripResourceError("invalid-input");
    const dayCount = variant.comparisonOnly ? variant.dayCount : knownDays ?? variant.dayCount;
    if (!Number.isSafeInteger(dayCount) || dayCount < 1 || dayCount > 90) throw new TripResourceError("invalid-input");
    const dayOrder = Array.from({ length: dayCount }, (_, index) => {
      if (baseDayIds[index]) return baseDayIds[index]!;
      let dayId = `day-${index + 1}`; while (baseDayIds.includes(dayId)) dayId += "-new";
      return dayId;
    });
    if (variant.items.some(item => item.day > dayCount || item.endDay !== undefined && (item.endDay < item.day || item.endDay > dayCount))) throw new TripResourceError("invalid-input");
    const replacements = variant.items.flatMap(item => item.baseItemId ? [item.baseItemId] : []);
    if (new Set([...removed, ...replacements]).size !== removed.length + replacements.length ||
        [...removed, ...replacements].some(ref => !baseItemIds.includes(ref))) throw new TripResourceError("invalid-input");
    let anchor = adoptedIds.filter(ref => !removed.includes(ref)).at(-1);
    let pendingAnchor: string | undefined;
    const placements = new Map<ItineraryProposalInput["variants"][number]["items"][number], string>();
    const additions = variant.items.filter(item => {
      if (!draftTrip) return true;
      const existing = item.baseItemId ? draftTrip.items.find(saved => saved.id === item.baseItemId) : undefined;
      // A generic draft cannot erase a proven route/hotel. Reselection uses retained search evidence.
      if (existing && !(existing.type === "stay" && (item.startTime || item.endTime)) && (existing.type === "transport" && existing.detail.status === "selected" || existing.type === "stay" && existing.selection.status === "selected")) throw new TripResourceError("invalid-input");
      if (item.baseItemId) { pendingAnchor = undefined; return true; }
      // This only retains an unchanged authored entry; it never uses a title to select a route/place.
      const repeats = draftTrip.items.filter(saved => !removed.includes(saved.id) && saved.type === item.kind && draftTitle(saved.title) === draftTitle(item.title) &&
        (saved.schedule.type === "relative" ? saved.schedule.dayId === dayOrder[item.day - 1] &&
          saved.schedule.endDayId === (item.endDay ? dayOrder[item.endDay - 1] : undefined) && saved.schedule.part === item.part
          : saved.logicalDayId === dayOrder[item.day - 1] || !!datedSearchSelectionTarget([saved], [{ ...saved, schedule: { type: "relative", dayId: dayOrder[item.day - 1]! } }], draftTrip)));
      if (repeats.length > 1) throw new TripResourceError("invalid-input");
      if (repeats.length === 1) pendingAnchor = repeats[0]!.id;
      else if (pendingAnchor) { placements.set(item, pendingAnchor); pendingAnchor = undefined; }
      return repeats.length === 0;
    });
    if (!additions.length) throw new TripResourceError("invalid-input");
    const items = additions.map((item, itemIndex) => {
      if (item.day > dayCount || item.endDay !== undefined && (item.endDay < item.day || item.endDay > dayCount)) throw new TripResourceError("invalid-input");
      const componentId = `${id}-item-${itemIndex + 1}`;
      const afterRef = placements.get(item) ?? anchor;
      const existing = item.baseItemId ? trip?.items.find(saved => saved.id === item.baseItemId) : undefined;
      const timing = plannedDraftTiming(item, dayOrder, trip, userRequest, existing);
      if (existing?.type === "stay" && existing.selection.status === "selected" && timing.plannedTiming &&
          !selectionItems.some(saved => saved.id === existing.id)) { const { logicalDayId: _day, decision: _decision, ...source } = existing; selectionItems.push(structuredClone(source)); }
      const value = { componentId, kind: item.kind, title: item.title,
        ...(existing?.type === "stay" && existing.selection.status === "selected" ? { sourceCandidateRef: existing.id } : {}),
        ...(timing.plannedTiming ? { plannedTiming: timing.plannedTiming } : {}),
        ...(timing.schedule ? { logicalDayId: existing?.logicalDayId ?? dayOrder[item.day - 1]! } : {}),
        schedule: timing.schedule ?? { type: "relative" as const, dayId: dayOrder[item.day - 1]!, ...(item.endDay ? { endDayId: dayOrder[item.endDay - 1]! } : {}), ...(item.part ? { part: item.part } : {}) },
        evidenceRefs: [], ...(item.baseItemId ? { baseItemId: item.baseItemId } : { placement: afterRef ? { afterRef } : { atBeginning: true as const } }) };
      anchor = componentId;
      return value;
    });
    return { id, label: variant.label, ...(variant.comparisonOnly ? { comparisonOnly: true as const } : {}), timeline: { dayOrder, itemOrder: items.map(item => item.componentId) },
      items, assumptionRefs: [], assessmentRefs: [], changedComponentIds: items.map(item => item.componentId), removedBaseItemIds: removed,
      retainedBaseItemIds: adoptedIds.filter(ref => !removed.includes(ref) && !replacements.includes(ref)) };
  });
  return { variants, ...(selectionItems.length ? { selectionItems } : {}), coverage: { coveredScopes: ["日別の仮旅程"], omittedScopes: [...input.unknowns], complete: input.unknowns.length === 0 } };
}

function plannedDraftTiming(item: ItineraryProposalInput["variants"][number]["items"][number], days: string[], trip: Trip | undefined,
  userRequest: string, existing?: ItineraryItem): { schedule?: ItinerarySchedule; plannedTiming?: Extract<ItineraryItem, { type: "stay" }>["plannedTiming"] } {
  if (!item.startTime && !item.endTime) return {};
  if (!item.timeQuote || !userRequest.includes(item.timeQuote)) throw new TripResourceError("invalid-input");
  const clocks = [...item.timeQuote.normalize("NFKC").matchAll(/(?:^|[^0-9])(\d{1,2})(?::(\d{2})|時(?:(\d{1,2})分|(半))?)/gu)]
    .map(match => `${match[1]!.padStart(2, "0")}:${(match[2] ?? match[3] ?? (match[4] ? "30" : "00")).padStart(2, "0")}`);
  if ([item.startTime, item.endTime].some(time => time && !clocks.includes(time))) throw new TripResourceError("invalid-input");
  const dateFor = (index: number) => {
    const binding = trip?.timeline?.calendarBindings.find(b => b.logicalDayId === days[index - 1]);
    if (binding) return binding.date;
    const dates = trip && effectiveTripConstraints(trip.request).filter(c => c.source === "user" && c.scope.type === "trip" && !c.scope.participantIds?.length)
      .map(c => c.requirement).filter(r => r.type === "dates" && r.start.earliest === r.start.latest);
    return dates?.length === 1 && dates[0]!.type === "dates" ? new Date(Date.parse(dates[0]!.start.earliest) + (index - 1) * 86_400_000).toISOString().slice(0, 10) : undefined;
  };
  const bound = existing?.schedule.type === "relative" && trip?.timeline ? bindRelativeSchedule(existing.schedule, trip.timeline) : undefined;
  const startDate = existing?.schedule.type === "day" ? existing.schedule.date : bound?.date ?? dateFor(item.day);
  const endDate = existing?.schedule.type === "day" ? existing.schedule.endDate ?? existing.schedule.date : bound?.endDate ?? dateFor(item.endDay ?? item.day);
  if (!startDate || item.endTime && !endDate) throw new TripResourceError("invalid-input");
  // This service only plans domestic Japan travel; host policy owns its zone.
  const instant = (date: string, time: string) => ({ at: `${date}T${time}:00+09:00`, timeZone: "Asia/Tokyo" });
  if (item.kind === "stay") return { schedule: existing?.schedule ?? { type: "day", date: startDate, ...(endDate ? { endDate } : {}), timeZone: "Asia/Tokyo" },
    plannedTiming: { ...(existing?.type === "stay" ? existing.plannedTiming : {}),
      ...(item.startTime ? { checkIn: instant(startDate, item.startTime) } : {}), ...(item.endTime ? { checkOut: instant(endDate!, item.endTime) } : {}) } };
  if (!item.startTime) throw new TripResourceError("invalid-input");
  return { schedule: { type: "fixed", startAt: instant(startDate, item.startTime), ...(item.endTime ? { endAt: instant(endDate!, item.endTime) } : {}) } };
}

function draftTitle(title: string): string { return title.normalize("NFKC").trim().replace(/\s*→\s*/gu, "→").replace(/\s+/gu, " "); }
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
      ...(draft.selectionItems ? { selectionItems: structuredClone(draft.selectionItems) } : {}),
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
