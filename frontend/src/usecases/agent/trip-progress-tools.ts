import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";
import { applyTripProposal } from "@raiquora/trip/trip";
import { validateTripRequest, type TripRequest } from "@raiquora/trip/trip-request";
import { proposeCandidateSelection, type CandidateSelectionPort } from "../trip-plan/select-trip-candidate";
import { proposeTripRequestUpdate } from "../trip-plan/update-trip-request";
import { proposeManualActivity, proposeActivitySelection, type ActivitySelectionPort, type ActivityPlacement } from "../trip-plan/propose-trip-activity";
import { activityCategories, type ActivityCategory } from "@raiquora/trip/trip";
import type { ItinerarySchedule } from "@raiquora/trip/itinerary-schedule";
import { AgentToolRegistry } from "./tool-registry";
import { validateAgentToolInput } from "./agent-tool-input-validator";
import { successfulAgentToolResult, failedAgentToolResult, type AgentToolDescriptor } from "./tool-contract";

export interface TripProgressDependencies {
  getCurrentTrip?: () => Trip | undefined;
  candidateSelection?: { taskId: string; port: CandidateSelectionPort };
  activitySelection?: { taskId: string; port: ActivitySelectionPort };
}
export interface TripProgressOutput {
  proposal?: TripUpdateProposal;
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
    name: "propose_manual_activity",
    description: "手入力の食事・観光・自由時間等の予定を同じTripへadd/replaceする案を作る。未配置でも提案でき、質問と併用可能。categoryは予定の意味分類。Provider事実・施設・予約の証明には使わず、検索済み施設は候補採用能力を使う。place/Evidence/保持許諾を受け取らない。新規は新itemIdとadd、既存変更は同itemIdとreplace。afterIdはaddでのみ既存予定の直後を指定、省略時は末尾。仮定は既存propose_request_assumptionsでmodel/unconfirmedとして併記できる。Domainが日時とPatchを検証し、previewのみで保存しない。",
    inputSchema: { type: "object", properties: { ...activityPlacementProperties,
      title: { type: "string", minLength: 1, maxLength: 200 }, category: { type: "string", enum: [...activityCategories] }, schedule: activityScheduleSchema },
    required: ["itemId", "operation", "title", "category", "schedule"], additionalProperties: false },
  },
  {
    name: "propose_activity_selection",
    description: "提示済みのrestaurant/experience候補IDを解決してActivityとして採用する案を作る。検索結果本体やProvider ID、Evidence、保持許諾は入力しない。Applicationが同Trip/task/期限/同定/出所/保存権限を照合し、許可された名称・場所・日程だけをpreviewする。食事はfood、体験はexperience。価格・空席・予約・写真は保存しない。schedule省略時はrestaurantがunscheduled、体験は保持許可された提供日をdayにする。別候補へ変更するときは既存itemIdのreplace。未検証/期限切れ/保存許諾不明は拒否する。",
    inputSchema: { type: "object", properties: { ...activityPlacementProperties,
      candidateId: { type: "string", minLength: 1, maxLength: 160 }, schedule: activityScheduleSchema },
    required: ["itemId", "operation", "candidateId"], additionalProperties: false },
  },
  {
    name: "propose_candidate_selection",
    description: "提示済みcandidate IDを対象itemへ採用するTrip V2変更案を作る。採用済み1件とdraft化を提案し、保存はしない。候補本体・経路・Evidenceは入力しない。時刻や宿泊先の再質問ではなく既存候補を使える場合に適する。期限切れ/別task/未検証候補は拒否する。",
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
];

/** Application boundary: resolve identifiers, validate, expose previews. Never writes a Trip. */
export function registerTripProgressTools(registry: AgentToolRegistry, dependencies: TripProgressDependencies,
  state: TripProgressOutput, now: () => Date, sources: () => Array<{ url: string; evidenceId: string; text: string }>): void {
  for (const descriptor of tripProgressDescriptors) {
    if (descriptor.name !== "present_travel_progress" && !dependencies.getCurrentTrip?.()) continue;
    if (descriptor.name === "propose_candidate_selection" && !dependencies.candidateSelection) continue;
    if (descriptor.name === "propose_activity_selection" && !dependencies.activitySelection) continue;
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
          const originalTrip = dependencies.getCurrentTrip?.();
          if (!originalTrip) throw new Error("Current Trip is unavailable");
          // Later Tools in this execution can refer to earlier proposed additions/assumptions.
          // This is a validated preview, never another persistent Trip state.
          const trip = state.proposal ? applyTripProposal(originalTrip, state.proposal) : originalTrip;
          let proposal: TripUpdateProposal;
          if (descriptor.name === "propose_manual_activity" || descriptor.name === "propose_activity_selection") {
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
          state.proposal = proposal;
          return successfulAgentToolResult({ proposal, previewPlanningState: preview.planningState,
            assumptions: preview.request.assumptions.filter((a) => a.status === "unconfirmed") });
        } catch (error) {
          return failedAgentToolResult({ code: "precondition_failed", message: error instanceof Error ? error.message : "Invalid progress proposal", retryable: false });
        }
      },
    });
  }
}
