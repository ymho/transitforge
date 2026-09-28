import { randomUUID } from "node:crypto";
import type { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { failedAgentToolResult, invalidAgentToolInput, successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";
import { proposeTripItemChange, type TripItemChange } from "@raiquora/trip/trip-item-proposal";
import { parsePublicTripProposal } from "@raiquora/trip/public-trip-proposal";

/** Publishes a revision-bound preview. Only the authenticated Trip snapshot is used. */
export function registerTripItemProposalTool(tools: AgentToolRegistry, trip: Trip, publish: (proposal: TripUpdateProposal) => void): void {
  const snapshot = structuredClone(trip);
  tools.register({
    name: "propose_trip_item_change", effect: "proposal", prerequisite: ["trusted_trip_scope"], requiredCapabilities: ["trip.read"],
    description: "Tripの予定を追加・変更・削除・移動する未保存の変更案。利用者が明示した操作にだけ使う。dayKey/itemId/afterIdは現在のTripから選ぶ。観光・食事・イベントはadd-activityで分類し、placeNameは利用者が入力した未検証の名称だけ。交通・宿泊はまず未選択の枠を作り、手入力の交通は列車・時刻表・予約を選択済みにしない。候補検索結果や店名を勝手に採用せず、確認後に画面から反映する。Trip ID/予約/購入/検証済み状態は入力できない。",
    inputSchema: { type: "object", additionalProperties: false, required: ["action"], properties: {
      action: { type: "string", enum: ["add-activity", "add-transport", "add-stay", "rename", "remove", "move", "change-day", "select-manual-transport", "set-manual-activity-place", "set-manual-stay-place"] },
      expectedRevision: { type: "integer", minimum: 0 }, itemId: { type: "string", minLength: 1, maxLength: 200 },
      dayKey: { type: "string", minLength: 1, maxLength: 200 }, afterId: { type: "string", minLength: 1, maxLength: 200 },
      title: { type: "string", minLength: 1, maxLength: 200 }, category: { type: "string", enum: ["sightseeing", "food", "experience", "event", "shopping", "relaxation", "free-time", "other"] },
      placeName: { type: "string", minLength: 1, maxLength: 200 }, mode: { type: "string", enum: ["air", "bus", "ferry", "car", "rental-car", "taxi", "ride-hail", "walk", "bicycle", "other"] },
      origin: { type: "string", minLength: 1, maxLength: 200 }, destination: { type: "string", minLength: 1, maxLength: 200 },
    } },
    parseInput(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return invalidAgentToolInput("Invalid Trip item change");
      const input = value as Record<string, unknown>;
      if (Object.keys(input).some(key => !["action", "expectedRevision", "itemId", "dayKey", "afterId", "title", "category", "placeName", "mode", "origin", "destination"].includes(key)) ||
          typeof input.action !== "string" || input.expectedRevision !== undefined && (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0))
        return invalidAgentToolInput("Invalid Trip item change");
      return validAgentToolInput(input);
    },
    async execute(input) {
      if (input.expectedRevision !== undefined && input.expectedRevision !== snapshot.revision)
        return failedAgentToolResult({ code: "stale_revision", message: "Trip revision changed; reload before proposing", retryable: false });
      try {
        const { expectedRevision: _expectedRevision, ...fields } = input;
        const action = fields.action;
        const change = { ...fields, ...((action === "add-activity" || action === "add-transport" || action === "add-stay") && fields.itemId === undefined
          ? { itemId: randomUUID() } : {}) } as TripItemChange;
        const proposal = parsePublicTripProposal(proposeTripItemChange(snapshot, change));
        publish(proposal);
        return successfulAgentToolResult({ proposed: true, saved: false, confirmationRequired: true, summary: proposal.summary,
          tripId: snapshot.id, baseRevision: snapshot.revision, targetItemId: change.itemId });
      } catch {
        return failedAgentToolResult({ code: "precondition_failed", message: "現在のTripの予定ID・日付キー・値を確認してください。候補や予約はこの案で自動採用できません。", retryable: false });
      }
    },
  });
}
