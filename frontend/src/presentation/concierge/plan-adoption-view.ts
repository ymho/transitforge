import type { AiGuidePanelElements } from "./ai-guide-panel";

/** Same preview/confirm flow in chat and itinerary. Rendering never writes a Trip. */
export function previewPlanAdoption(event: Event, options: {
  conversationId: string; isCurrent(): boolean; adopt: NonNullable<AiGuidePanelElements["onPlanAdoption"]>;
}): void {
  const detail = (event as CustomEvent<{ candidateSetId?: string; candidateSetRevision?: number; variantId?: string; tripId?: string; baseTripRevision?: number }>).detail;
  if (!detail?.candidateSetId || detail.candidateSetRevision === undefined || !detail.variantId || !detail.tripId || detail.baseTripRevision === undefined) return;
  const host = (event.target as Element | null)?.closest<HTMLElement>(".public-plan-candidate");
  if (!host || host.querySelector(".public-plan-change-preview")) return;
  const status = document.createElement("aside"); status.className = "public-plan-change-preview"; status.textContent = "変更内容を確認しています…"; host.append(status);
  const target = { conversationId: options.conversationId, candidateSetId: detail.candidateSetId, candidateSetRevision: detail.candidateSetRevision,
    variantId: detail.variantId, tripId: detail.tripId, baseTripRevision: detail.baseTripRevision, mutationId: crypto.randomUUID() };
  void options.adopt(target).then(result => {
    if (!options.isCurrent() || !status.isConnected) return;
    const summary = document.createElement("p"); summary.textContent = `変更プレビュー: 追加${result.changes.added}件・差替${result.changes.replaced}件・削除${result.changes.removed}件`;
    const confirm = document.createElement("button"); confirm.type = "button"; confirm.textContent = "この変更を確認して保存";
    confirm.addEventListener("click", () => {
      if (!options.isCurrent()) { status.textContent = "対象が変わりました。最新の旅程で確認し直してください。"; return; }
      confirm.disabled = true;
      void result.confirm().then(() => { status.textContent = "旅程へ保存し、最新状態を再読込しました。"; })
        .catch(() => { confirm.disabled = false; status.textContent = "保存できませんでした。最新の旅程で案を作り直してください。"; });
    });
    status.replaceChildren(summary, confirm);
  }).catch(() => { status.textContent = "変更プレビューを作成できませんでした。最新の旅程で案を作り直してください。"; });
}
