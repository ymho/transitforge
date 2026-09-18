import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";
import { applyTripProposal, TripRevisionConflict } from "@raiquora/trip/trip";
import { validateTripRequest, type TripRequest } from "@raiquora/trip/trip-request";
import { proposeCandidateSelection, type CandidateSelectionPort } from "../trip-plan/select-trip-candidate";
import { proposeTripRequestUpdate } from "../trip-plan/update-trip-request";
import { proposeManualActivity, proposeActivitySelection, type ActivitySelectionPort, type ActivityPlacement } from "../trip-plan/propose-trip-activity";
import { activityCategories, type ActivityCategory } from "@raiquora/trip/trip";
import type { ItinerarySchedule } from "@raiquora/trip/itinerary-schedule";
import { nonRailTransportModes, type NonRailTransportMode } from "@raiquora/trip/transport-detail";
import { proposeManualTransport, proposeTransportSelection, type TransportSelectionPort } from "../trip-plan/propose-trip-transport";
import { AgentToolRegistry } from "./tool-registry";
import { validateAgentToolInput } from "./agent-tool-input-validator";
import { successfulAgentToolResult, failedAgentToolResult, type AgentToolDescriptor } from "./tool-contract";
import { assertItineraryEditingAllowed, previewInTripReplan, type InTripReplanTargets } from "@raiquora/trip/in-trip-replan";
import type { ReservationFact } from "@raiquora/trip/reservation";
import type { TripFeasibilityFacts } from "@raiquora/trip/trip-feasibility";

export interface TripProgressDependencies {
  getCurrentTrip?: () => Trip | undefined;
  getReservationFacts?: () => readonly ReservationFact[] | undefined;
  getFeasibilityExternalFacts?: () => TripFeasibilityFacts["external"];
  getReplanTargets?: () => InTripReplanTargets | undefined;
  candidateSelection?: { taskId: string; port: CandidateSelectionPort };
  activitySelection?: { taskId: string; port: ActivitySelectionPort };
  transportSelection?: { taskId: string; port: TransportSelectionPort };
}
export interface TripProgressOutput {
  proposal?: TripUpdateProposal;
  /** Execution's base Trip changed. No proposal from this execution remains applicable. */
  revisionConflict?: true;
  /** Public recommendation with references resolved from pages read during this execution. */
  decision?: { text: string; findings: string[]; sources: Array<{ url: string; evidenceId: string }> };
}

const activityPlacementProperties = {
  itemId: { type: "string", minLength: 1, maxLength: 160 },
  operation: { type: "string", enum: ["add", "replace"] },
  afterId: { type: "string", minLength: 1, maxLength: 160 },
};
const zonedInstantSchema = { type: "object", properties: { at: { type: "string" }, timeZone: { type: "string" } }, required: ["at", "timeZone"], additionalProperties: false };
const activityScheduleSchema = { type: "object", description: "既存ItinerarySchedule。type=fixedはstartAt/endAt?、windowはearliestStart/latestEnd/durationMinutes?、dayはdate/timeZone?/endDate?、unscheduledはtypeのみ。atは秒とoffset付きISO、timeZoneはIANA。異なるvariantのfieldは拒否する。曖昧な日時を固定しない。",
  properties: { type: { type: "string", enum: ["fixed", "window", "day", "unscheduled"] }, startAt: zonedInstantSchema, endAt: zonedInstantSchema,
    earliestStart: zonedInstantSchema, latestEnd: zonedInstantSchema, durationMinutes: { type: "integer", minimum: 0 },
    date: { type: "string" }, endDate: { type: "string" }, timeZone: { type: "string" } }, required: ["type"], additionalProperties: false };
export const tripProgressDescriptors: AgentToolDescriptor[] = [
  {
    name: "propose_manual_transport",
    description: "タクシー・徒歩・航空・フェリー等の手入力の移動予定を同じTripへadd/replaceする案。便未定や時刻未定でもmodeと両端の名称を保ち、day/window/unscheduledで質問と併用できる。Provider検索結果の採用や鉄道の検証には使わない。Provider ID・Evidence・保持許諾は入力不可。selectedは旅程へ採用する予定の意味で予約済みではない。仮定は既存propose_request_assumptionsで併記できる。scheduleが時刻の唯一の正本。新規itemIdはadd、既存ID変更はreplace、afterIdはaddのみ。previewだけで保存しない。",
    inputSchema: { type: "object", properties: { ...activityPlacementProperties, mode: { type: "string", enum: [...nonRailTransportModes] },
      title: { type: "string", minLength: 1, maxLength: 200 }, origin: { type: "string", minLength: 1, maxLength: 200 },
      destination: { type: "string", minLength: 1, maxLength: 200 }, schedule: activityScheduleSchema },
    required: ["itemId", "operation", "title", "mode", "origin", "destination", "schedule"], additionalProperties: false },
  },
  {
    name: "propose_transport_selection",
    description: "提示済みの非鉄道候補IDを解決して移動予定へ採用する案。モデルは候補IDと配置だけを指定し、便・Provider ID・Evidence・許諾・scheduleを供給しない。ApplicationがTrip/task/期限/同定/保存権限を検証し、採用可能な場所と計画日程だけをpreviewする。曖昧/未検証/保持不可候補は拒否する。価格・空席・予約URL・遅延は保存しない。採用は予約ではない。新規はadd、他候補への変更は同itemIdのreplace。",
    inputSchema: { type: "object", properties: { ...activityPlacementProperties, candidateId: { type: "string", minLength: 1, maxLength: 160 } },
      required: ["itemId", "operation", "candidateId"], additionalProperties: false },
  },
  {
    name: "propose_manual_activity",
    description: "手入力の食事・観光・自由時間等の予定を同じTripへadd/replaceする案を作る。未配置でも提案でき、質問と併用可能。categoryは予定の意味分類。Provider事実・施設・予約の証明には使わず、検索済み施設は候補採用能力を使う。place/Evidence/保持許諾を受け取らない。新規は新itemIdとadd、既存変更は同itemIdとreplace。afterIdはaddでのみ既存予定の直後を指定、省略時は末尾。仮定は既存propose_request_assumptionsでmodel/unconfirmedとして併記できる。Domainが日時とPatchを検証し、previewのみで保存しない。",
    inputSchema: { type: "object", properties: { ...activityPlacementProperties,
      title: { type: "string", minLength: 1, maxLength: 200 }, category: { type: "string", enum: [...activityCategories] }, schedule: activityScheduleSchema },
    required: ["itemId", "operation", "title", "category", "schedule"], additionalProperties: false },
  },
  {
    name: "propose_activity_selection",
    description: "提示済みの食事店・体験候補を採用・置換する未保存Proposal。",
    decisionSupport: {
      capability: "提示済みrestaurant/experience候補を採用する未保存TripUpdateProposal",
      suitableCases: ["既存予定を提示済み候補へ変更: candidateId=候補ID、itemId=既存予定ID、operation=replace", "新規予定として採用: operation=add"],
      unsuitableCases: ["候補のない手入力予定", "予定を取りやめるだけ、並び替えるだけ"],
      returnedEvidence: "候補解決・検証済みsnapshotを使ったProposal preview。まだ保存・予約しない",
      limitations: ["候補IDだけで施設を解決するので名称や場所の再入力不要", "scheduleは任意。省略時は保存許諾済み提供日またはunscheduledで、時刻を推測しない"],
      responsibilityBoundary: "ApplicationがTrip/task/期限/出所/保持許諾/scopeを検証。Provider raw・予約・価格・空席・画像は保存しない",
    },
    inputSchema: { type: "object", properties: { ...activityPlacementProperties,
      candidateId: { type: "string", minLength: 1, maxLength: 160 }, schedule: activityScheduleSchema },
    required: ["itemId", "operation", "candidateId"], additionalProperties: false },
  },
  {
    name: "propose_candidate_selection",
    description: "検証済み鉄道候補または宿泊候補をcandidateId/itemIdで採用する未保存のTrip変更案。現在Tripの鉄道区間を別列車候補に置き換えるときは、この能力で同じitemIdをreplaceする。Applicationが時刻表とprovenanceを検証しSelectedRailJourneyへ変換するため、モデルは列車・時刻を入力しない。独立した駅間代替をまだ探す必要があればsearch_direct_routes。提示済み候補の採用に再検索は不要。宿はopaque provider/providerItemIdで商品と施設を別々に解決し、出所・期限・保持許諾を検証する。selectedは計画への採用で、予約済み/空室確保ではない。許可された原通貨のobservedPriceのみ保持し、現在価格と混同せず暗黙換算しない。空室・画像・review・booking URLは保存しない。対象と希望候補が明確なら先にpreviewし、適用は別途利用者確認。過去・範囲外・期限切れ・別task・未検証候補は拒否。施設Activity候補はpropose_activity_selectionの責務。",
    inputSchema: { type: "object", properties: {
      candidateId: { type: "string", minLength: 1, maxLength: 160 }, itemId: { type: "string", minLength: 1, maxLength: 160 },
      accommodation: { type: "object", properties: { provider: { type: "string" }, providerItemId: { type: "string" } }, required: ["provider", "providerItemId"], additionalProperties: false },
    }, required: ["candidateId", "itemId"], additionalProperties: false },
  },
  {
    name: "propose_request_assumptions",
    description: "不足条件を変更可能な既存PlanAssumptionとして提案する。persistedTripRequestを丸ごと引き継ぎ、新規constraintはsource=assumptionでmodel/unconfirmedの仮定と相互参照する。例: constraintsへ {id:'pace-provisional',source:'assumption',strength:'soft',scope:{type:'trip'},requirement:{type:'pace',value:0.3},assumptionId:'pace-assumption'}、assumptionsへ {id:'pace-assumption',text:'ゆっくり巡ると仮置き',source:'model',status:'unconfirmed',affects:[{type:'constraint',constraintId:'pace-provisional'}]} を追加する。paceは0〜1。他のrequirementは既存TripRequest契約に従う。既知条件の変更・仮定の確認/却下・user事実への昇格・新しいProvider事実は禁止。単なる仮定列挙だけでなく具体案と組み合わせる。",
    inputSchema: { type: "object", properties: { request: { type: "object", properties: {
      goal: { type: "string" }, constraints: { type: "array", maxItems: 40, items: { type: "object" } },
      assumptions: { type: "array", maxItems: 40, items: { type: "object" } },
      party: { type: "object", description: "今回のTripParty。未知の子の年齢は省略。新規仮置きはsource=assumption、assumptionIdでmodel/unconfirmed/affects:[{type:'party'}]を参照。既知partyは書き換えず引き継ぐ。人数はcompositionから推定しない。",
        properties: { adults: { type: "integer", minimum: 0 }, children: { type: "array", items: { type: "object", properties: {
          age: { type: "integer", minimum: 0 }, ageGroup: { type: "string", enum: ["baby", "preschool", "elementary", "teen"] },
        }, additionalProperties: false } }, composition: { type: "array", items: { type: "string", enum: ["solo", "partner", "friends", "children", "family"] } },
        source: { type: "string", enum: ["user", "profile", "legacy", "assumption"] }, assumptionId: { type: "string" } },
        required: ["adults", "children", "source"], additionalProperties: false },
    }, required: ["constraints", "assumptions"], additionalProperties: false } }, required: ["request"], additionalProperties: false },
  },
  {
    name: "present_travel_progress",
    description: "読んだWebページを根拠に方向性候補・比較・具体判断を利用者へ提示する。地域や大まかな希望でも使える。summaryは推薦判断、findingsはread_web_pagesの本文から候補の性質が分かる短い原文引用。引用はコードで本文照合し情報源付きで表示する。単なる作業完了報告、未読URL、架空の引用には使わない。同じturnのask_follow_upと併用できる。",
    inputSchema: { type: "object", properties: { summary: { type: "string", minLength: 1, maxLength: 2000 },
      findings: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", properties: {
        sourceUrl: { type: "string", maxLength: 2000 }, quote: { type: "string", minLength: 10, maxLength: 100 },
      }, required: ["sourceUrl", "quote"], additionalProperties: false } } },
    required: ["summary", "findings"], additionalProperties: false },
  },
  // Append the new capability without changing the ordering of the existing selection contracts.
  {
    name: "propose_itinerary_removal_or_move",
    description: "既存予定の取りやめ・並び替えだけの未保存Proposal。",
    decisionSupport: {
      capability: "予定をなくす(remove)、並び順だけを変える(move)未保存Proposal",
      suitableCases: ["既存予定の取りやめ", "既存予定の並び替え"],
      unsuitableCases: ["別候補への置き換え: 施設はpropose_activity_selection、鉄道/宿はpropose_candidate_selection", "新規予定追加"],
      responsibilityBoundary: "Applicationが現在Tripの変更可能範囲を検証。保護対象にはhost明示targetが必要。予約取消・保存はしない",
    },
    inputSchema: { type: "object", properties: { summary: { type: "string", minLength: 1, maxLength: 500 },
      patches: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", properties: {
        type: { type: "string", enum: ["remove", "move"] }, itemId: { type: "string", minLength: 1, maxLength: 160 },
        afterId: { type: "string", minLength: 1, maxLength: 160 },
      }, required: ["type", "itemId"], additionalProperties: false } } }, required: ["summary", "patches"], additionalProperties: false },
  },
];

/** Application boundary: resolve identifiers, validate, expose previews. Never writes a Trip. */
export function registerTripProgressTools(registry: AgentToolRegistry, dependencies: TripProgressDependencies,
  state: TripProgressOutput, now: () => Date, sources: () => Array<{ url: string; evidenceId: string; text: string }>): void {
  const executionTrip = dependencies.getCurrentTrip?.();
  const requireSameTrip = () => {
    const latest = dependencies.getCurrentTrip?.();
    if (!latest || latest.id !== executionTrip?.id || latest.revision !== executionTrip.revision) throw new TripRevisionConflict();
    return latest;
  };
  for (const descriptor of tripProgressDescriptors) {
    if (descriptor.name === "propose_itinerary_removal_or_move" && dependencies.getCurrentTrip?.()?.lifecycleState !== "in_trip") continue;
    if (descriptor.name !== "present_travel_progress" && !dependencies.getCurrentTrip?.()) continue;
    if (descriptor.name === "propose_candidate_selection" && !dependencies.candidateSelection) continue;
    if (descriptor.name === "propose_activity_selection" && !dependencies.activitySelection) continue;
    if (descriptor.name === "propose_transport_selection" && !dependencies.transportSelection) continue;
    registry.register<Record<string, unknown>, unknown>({ ...descriptor,
      parseInput: (value) => validateAgentToolInput(descriptor.inputSchema, value),
      async execute(input) {
        try {
          if (descriptor.name === "present_travel_progress") {
            const findings = input.findings as Array<{ sourceUrl: string; quote: string }>;
            const resolved = findings.map((finding) => sources().find((source) => source.url === finding.sourceUrl && source.text.includes(finding.quote)));
            if (resolved.some((source) => !source)) throw new Error("提示する根拠の本文と短い引用を確認してください");
            // Keep excerpts bounded per source, as well as per finding.
            if (findings.some((f) => findings.filter((other) => other.sourceUrl === f.sourceUrl).reduce((n, other) => n + other.quote.length, 0) > 100)) {
              throw new Error("同じ情報源の引用を短くしてください");
            }
            state.decision = { text: input.summary as string, findings: findings.map((f) => f.quote),
              sources: resolved.map((source) => ({ url: source!.url, evidenceId: source!.evidenceId })) };
            return successfulAgentToolResult({ presented: state.decision });
          }
          const originalTrip = requireSameTrip();
          if (!originalTrip) throw new Error("Current Trip is unavailable");
          // Later Tools in this execution can refer to earlier proposed additions/assumptions.
          // This is a validated preview, never another persistent Trip state.
          const trip = state.proposal ? applyTripProposal(originalTrip, state.proposal) : originalTrip;
          let proposal: TripUpdateProposal;
          if (descriptor.name === "propose_itinerary_removal_or_move") {
            proposal = { tripId: trip.id, baseRevision: trip.revision, summary: input.summary as string,
              patches: [...input.patches as Extract<import("@raiquora/trip/trip").TripPatch, { type: "remove" | "move" }>[], { type: "planning", state: "itinerary_draft" }] };
          } else if (descriptor.name === "propose_manual_transport" || descriptor.name === "propose_transport_selection") {
            const placement: ActivityPlacement = { itemId: input.itemId as string, operation: input.operation as ActivityPlacement["operation"],
              ...(input.afterId !== undefined ? { afterId: input.afterId as string } : {}) };
            if (descriptor.name === "propose_manual_transport") proposal = proposeManualTransport(trip, placement,
              { title: input.title as string, mode: input.mode as NonRailTransportMode, origin: input.origin as string,
                destination: input.destination as string, schedule: input.schedule as ItinerarySchedule });
            else proposal = await proposeTransportSelection(trip, placement, { candidateId: input.candidateId as string,
              taskId: dependencies.transportSelection!.taskId }, dependencies.transportSelection!.port, now().toISOString());
          } else if (descriptor.name === "propose_manual_activity" || descriptor.name === "propose_activity_selection") {
            const placement: ActivityPlacement = { itemId: input.itemId as string, operation: input.operation as ActivityPlacement["operation"],
              ...(input.afterId !== undefined ? { afterId: input.afterId as string } : {}) };
            if (descriptor.name === "propose_manual_activity") proposal = proposeManualActivity(trip, placement,
              { title: input.title as string, category: input.category as ActivityCategory, schedule: input.schedule as ItinerarySchedule });
            else proposal = await proposeActivitySelection(trip, placement, { candidateId: input.candidateId as string,
              taskId: dependencies.activitySelection!.taskId, ...(input.schedule !== undefined ? { schedule: input.schedule as ItinerarySchedule } : {}) },
            dependencies.activitySelection!.port, now().toISOString());
          } else if (descriptor.name === "propose_candidate_selection") {
            const selection = dependencies.candidateSelection!;
            proposal = await proposeCandidateSelection(trip, {
              candidateId: input.candidateId as string, itemId: input.itemId as string, taskId: selection.taskId,
              ...(input.accommodation ? { accommodation: input.accommodation as { provider: string; providerItemId: string } } : {}),
            }, selection.port, now().toISOString());
          } else {
            validateTripRequest(input.request as TripRequest, trip.items);
            proposal = proposeTripRequestUpdate(trip, input.request as TripRequest, "model");
          }
          if (state.proposal) proposal = { ...proposal, patches: [...state.proposal.patches, ...proposal.patches] };
          const preview = applyTripProposal(originalTrip, proposal);
          assertItineraryEditingAllowed(originalTrip, proposal);
          requireSameTrip(); // Includes async candidate/evidence lookup races; never silently rebase.
          const replan = originalTrip.lifecycleState === "in_trip" ? previewInTripReplan(originalTrip, proposal, {
            now: now(), reservations: dependencies.getReservationFacts?.(), targets: dependencies.getReplanTargets?.(),
            external: dependencies.getFeasibilityExternalFacts?.(),
          }) : undefined;
          state.proposal = proposal;
          return successfulAgentToolResult({ proposal, previewPlanningState: preview.planningState,
            ...(replan ? { replan: { keptItemIds: replan.keptItemIds, changedItemIds: replan.changedItemIds,
              protectedChanges: replan.protectedChanges, feasibility: { status: replan.feasibility.status,
                issues: replan.feasibility.issues.slice(0, 16).map((i) => ({ code: i.code, status: i.status, itemIds: i.itemIds })) },
              confirmationRequired: !!replan.confirmationKey, reservationChanged: false } } : {}),
            assumptions: preview.request.assumptions.filter((a) => a.status === "unconfirmed") });
        } catch (error) {
          if (error instanceof TripRevisionConflict) {
            delete state.proposal;
            state.revisionConflict = true;
          }
          return failedAgentToolResult({ code: "precondition_failed", message: error instanceof Error ? error.message : "Invalid progress proposal", retryable: false });
        }
      },
    });
  }
}
