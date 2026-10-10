import { itemCostCopy } from "./trip-cost-view";
import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { tripProposalProjection } from "./trip-workspace-projection";
import { element, control } from "./trip-workspace-elements";
import { reservationChangeKey } from "@raiquora/trip/reservation";
import { applyTripProposal } from "@raiquora/trip/trip";
import { requestsReady, hasReadyBlockers, TripNotFeasible } from "@raiquora/trip/trip-ready";
import { renderTripFeasibility } from "./trip-feasibility-view";
import { renderTripWarnings } from "./trip-warning-view";

export function renderWorkspaceProposal(trip: Trip, proposal: TripUpdateProposal, controller: TripWorkspaceController,
  report: (text: string) => void): HTMLElement {
  const view = tripProposalProjection(trip, proposal);
  const section = element("section", "trip-workspace-proposal");
  section.setAttribute("aria-label", "未確認の変更案");
  section.append(element("h2", "", "変更内容を確認"));
  const compare = (before: string, after: string) => {
    const row = element("div", "trip-workspace-diff");
    for (const [label, text] of [["現在", before], ["変更後", after]]) {
      const column = element("div"); column.append(element("h3", "", label), element("p", "trip-workspace-copy", text)); row.append(column);
    }
    section.append(row);
  };
  const afterTrip = applyTripProposal(trip, proposal);
  const moveOnly = proposal.patches.every(p => p.type === "move");
  if (moveOnly) {
    const list = element("ol", "trip-order-preview");
    for (const item of afterTrip.items) list.append(element("li", "", item.title));
    section.append(element("p", "", "この順番に変更します。"), list);
  } else for (const change of view.changes) {
    const oldItem = trip.items.find(item => item.id === change.id), nextItem = afterTrip.items.find(item => item.id === change.id);
    if (change.before === change.after) continue;
    section.append(element("h3", "", nextItem?.title ?? oldItem?.title ?? "予定"));
    const before = [...new Set(change.before.split("\n"))].filter(line => !line.startsWith("行程順:") && line !== oldItem?.title);
    const after = [...new Set(change.after.split("\n"))].filter(line => !line.startsWith("行程順:") && line !== nextItem?.title);
    const beforeChanged = before.filter(line => !after.includes(line)), afterChanged = after.filter(line => !before.includes(line));
    if (oldItem?.title !== nextItem?.title && oldItem && nextItem) compare(oldItem.title, nextItem.title);
    if (beforeChanged.length || afterChanged.length) compare(beforeChanged.join("\n") || "—", afterChanged.join("\n") || "—");
    if (proposal.patches.some(p => p.type === "move" && p.itemId === change.id)) {
      const index = afterTrip.items.findIndex(item => item.id === change.id);
      section.append(element("p", "", index > 0 ? `「${afterTrip.items[index - 1]!.title}」の後に移動` : "先頭に移動"));
    }
  }
  if (view.requestChanged) {
    compare(view.beforeConditions, view.afterConditions);
    if (proposal.patches.every(p => p.type === "request")) section.append(element("p", "", "旅行条件だけの変更案です。採用済みの予定や予約は変更しません。仮置きの値は、保存後も確認・修正できます。"));
  }
  if (proposal.patches.some(p => p.type === "cost_lines")) {
    const after = applyTripProposal(trip, proposal);
    for (const item of trip.items) {
      const beforeCost = itemCostCopy(trip, item), afterCost = itemCostCopy(after, item);
      if (beforeCost !== afterCost) compare(`${item.title}\n概算費用: ${beforeCost}`, `${item.title}\n概算費用: ${afterCost}`);
    }
  }
  const warnings = controller.reservationWarnings();
  const replan = controller.replan();
  if (replan) {
    section.append(element("p", "", `変更しない予定: ${replan.keptItemIds.map((id) => trip.items.find((i) => i.id === id)?.title).join("、") || "なし"}`));
    for (const change of replan.protectedChanges) section.append(element("p", "", `${trip.items.find((i) => i.id === change.itemId)?.title}: ${change.codes.map((code) => ({ booked: "予約済み", fixed: "固定時刻", "hard-constraint": "必須条件", past: "予定上の過去", "outside-scope": "対象外", "reservation-unconfirmed": "予約未確認" })[code]).join("・")}`));
  }
  const feasibility = controller.feasibility(applyTripProposal(trip, proposal));
  const readyBlocked = requestsReady(proposal) && (!feasibility || hasReadyBlockers(feasibility));
  if ((requestsReady(proposal) || replan) && feasibility) {
    section.append(renderTripFeasibility(feasibility));
    if (readyBlocked) section.append(element("p", "", "準備完了を阻害する未確認事項または不成立の条件があるため、準備完了にはできません。変更案や下書きは引き続き相談できます。"));
    else if (requestsReady(proposal) && feasibility.status === "unknown") section.append(element("p", "", "準備完了にできますが、表示された未確認事項は残ります。すべて確認済みという意味ではありません。"));
    else if (replan && feasibility.status !== "feasible") section.append(element("p", "", "この変更案には不成立または未確認の事項があります。下書きの保存は成立・安全の保証ではありません。"));
  }
  const consent = element("input"); consent.type = "checkbox";
  const key = reservationChangeKey(proposal, controller.reservations() ?? []);
  const needsConsent = warnings.length > 0 || !!replan?.confirmationKey;
  const caution = renderTripWarnings(warnings.length ? ["予約済みの予定が変わります。"] : [], "変更の影響を確認し、下のチェック欄にチェックしてください。予約の変更・取消が必要な場合は、予約先で手続きしてください。");
  if (caution) section.append(caution);
  if (needsConsent) {
    const label = element("label", "trip-workspace-assumption");
    label.append(consent, document.createTextNode("予約・固定時刻・必須条件への変更の影響を確認しました。予約の変更・取消は別操作であり、この操作では行いません。"));
    section.append(label);
  }
  if (controller.canConfirm()) {
    const server = controller.source()?.confirmationPersistence === "server";
    const confirm = control(server ? "確認して旅程を保存" : "確認して、この画面内に反映", () => {
      confirm.disabled = true;
      void controller.confirm(needsConsent && consent.checked ? { reservationChangeKey: key, replanConfirmationKey: replan?.confirmationKey } : undefined).then(() => report(server ? controller.loadState() === "loaded" ? "旅程を保存しました。" : "保存後の最新旅程を取得できません。再読み込みしてください。" : "この画面内に反映しました。永続保存はしていません。"))
        .catch((error: unknown) => { confirm.disabled = false; report(error instanceof TripNotFeasible ? "最新情報では旅程が不成立または未確認です。成立性の表示と変更案を確認し直してください。" : error instanceof Error ? error.message : "変更案を確認できませんでした"); });
    });
    confirm.classList.add("trip-primary-action");
    confirm.disabled = readyBlocked || needsConsent;
    consent.addEventListener("change", () => { confirm.disabled = readyBlocked || !consent.checked; });
    section.append(confirm);
  } else section.append(element("p", "", "確認用プレビューです。保存機能はまだ有効ではありません。"));
  section.append(control("変更案を閉じる", () => controller.dismiss()));
  return section;
}
