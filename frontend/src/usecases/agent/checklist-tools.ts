import { checklistCategories, previewChecklistProposal, type ChecklistDetails, type ChecklistProposal, type TripChecklistItem } from "@raiquora/trip/trip-checklist";
import type { Trip } from "@raiquora/trip/trip";
import { AgentToolRegistry } from "./tool-registry";
import { validateAgentToolInput } from "./agent-tool-input-validator";
import { successfulAgentToolResult, failedAgentToolResult, type AgentToolDescriptor } from "./tool-contract";

export const checklistDescriptor: AgentToolDescriptor = {
  name: "propose_preparation_checklist",
  description: "現在の旅行の準備項目を追加提案する。既知の条件や取得済み情報、利用者の要望から必要なものを選べるが、固定の持ち物順はない。Trip/予約の未確定事項を完了にする能力ではなく、readyでも準備openはあり得る。categoryと短いtitle、必要なら実在する関連item/予約ID、dueDateを指定する。既存項目を正規化exact keyで除外し、完了/不要/アーカイブやユーザー項目を上書きしない。返すのは未保存のChecklistProposalでありEvidenceや購入/予約の証明ではない。ユーザーのプレビュー確認後だけ別Repositoryへ追加する。status/source/idやprivate予約情報は入力できない。チェックリスト未取得時は先に読み取り可能な状態にする必要がある。TripPatchには混ぜない。",
  inputSchema: { type: "object", properties: { suggestions: { type: "array", minItems: 1, maxItems: 12, items: {
    type: "object", properties: { category: { type: "string", enum: [...checklistCategories] }, title: { type: "string", minLength: 1, maxLength: 200 },
      relatedItineraryItemId: { type: "string", maxLength: 200 }, relatedReservationId: { type: "string", maxLength: 36 }, dueDate: { type: "string", maxLength: 10 } },
    required: ["category", "title"], additionalProperties: false } } }, required: ["suggestions"], additionalProperties: false },
};
export function registerChecklistTool(registry: AgentToolRegistry, trip: Trip | undefined, items: readonly TripChecklistItem[] | undefined,
  state: { proposal?: ChecklistProposal }, reservationIds?: readonly string[]) {
  if (!trip || !items) return;
  registry.register<Record<string, unknown>, unknown>({ ...checklistDescriptor,
    parseInput: (v) => validateAgentToolInput(checklistDescriptor.inputSchema, v),
    async execute(input) {
      try {
        const suggestion = { tripId: trip.id, suggestions: input.suggestions as ChecklistDetails[] };
        const result = previewChecklistProposal(suggestion, items);
        if (result.suggestions.some((s) => s.relatedItineraryItemId && !trip.items.some((i) => i.id === s.relatedItineraryItemId) ||
          s.relatedReservationId && !reservationIds?.includes(s.relatedReservationId))) throw new Error();
        // Merge only this turn's unconfirmed preview, never authoritative items.
        const previous = state.proposal?.suggestions ?? [];
        const merged = [...previous, ...result.suggestions].filter((s, i, all) => all.findIndex((a) => a.category === s.category && a.title === s.title) === i);
        if (merged.length) {
          const preview = previewChecklistProposal({ tripId: trip.id, suggestions: merged }, items);
          state.proposal = { tripId: trip.id, suggestions: preview.suggestions };
        }
        return successfulAgentToolResult({ preview: state.proposal ?? null, skipped: result.skipped, saved: false, confirmationRequired: true });
      } catch { return failedAgentToolResult({ code: "precondition_failed", message: "準備項目の内容・関連先・上限を確認してください。保存はしていません。", retryable: false }); }
    },
  });
}
