import { checklistCategories, type TripChecklistItem } from "@raiquora/trip/trip-checklist";
import type { ChecklistCommand } from "@raiquora/trip/checklist-edit";
import type { Trip } from "@raiquora/trip/trip";
import type { TripReadiness } from "@raiquora/trip/trip-readiness";
import type { ChecklistWorkspaceController } from "../../usecases/trip-plan/checklist-workspace-controller";
import { element, control, option } from "./trip-workspace-elements";

export const checklistCategoryLabels = { documents: "書類", connectivity: "通信", money: "お金", clothing: "衣類", packing: "持ち物", tickets: "チケット", health: "健康", other: "その他" };
export function renderTripChecklist(options: { controller: ChecklistWorkspaceController; trip: Trip; readiness: TripReadiness;
  newId(): string; focus(id: string): void; ask(prompt: string): void; report(text: string): void }): HTMLElement {
  const { controller, trip, readiness, report } = options, writable = controller.canWrite();
  const section = element("section", "trip-workspace-checklist"); section.setAttribute("aria-label", "旅行前の準備");
  section.append(element("h2", "", "旅行前の準備"), element("p", "", "旅程・予約とは別の準備リストです。すべて完了しても旅程の成立を保証しません。"));
  const run = (action: () => Promise<void>) => { void action().then(() => report("準備リストを更新しました。")).catch(() => report("準備リストを更新できませんでした。最新の状態を再読み込みし、内容を確認してください。")); };
  if (!writable) section.append(element("p", "", "準備リストの編集は現在利用できません。"));
  const items = controller.items();
  if (!items) { section.append(element("p", "", "準備リストは未取得です。未準備・完了とは判定できません。")); return section; }
  for (const count of readiness.preparation.categories) {
    if (count.open + count.done + count.notNeeded) section.append(element("p", "", `${checklistCategoryLabels[count.category]}: 完了 ${count.done}・不要 ${count.notNeeded}・未完了 ${count.open}`));
  }
  const warnings = { itinerary_link_missing: "関連する予定がなくなっています。項目は保持しています。", reservation_link_missing: "関連する予約が見つかりません。項目は保持しています。", reservation_link_unchecked: "関連する予約を取得できず、リンク先は未確認です。" };
  for (const item of items) {
    const row = element("article", "trip-workspace-checklist-item"); row.dataset.checklistId = item.id;
    const label = element("label"), checkbox = element("input"); checkbox.type = "checkbox"; checkbox.checked = item.status === "done";
    checkbox.disabled = !writable || item.archived;
    const update = (changes: Extract<ChecklistCommand, { operation: "update" }>["changes"]) => run(() => controller.write({ operation: "update", tripId: trip.id, id: item.id, baseRevision: item.revision, changes }));
    checkbox.addEventListener("change", () => update({ status: checkbox.checked ? "done" : "open" }));
    label.append(checkbox, document.createTextNode(`${item.title}（${{ open: "未完了", done: "完了", "not-needed": "不要" }[item.status]}${item.archived ? "・アーカイブ" : ""}）`)); row.append(label);
    if (item.dueDate) row.append(element("p", "", `期限: ${item.dueDate}`));
    for (const warning of readiness.preparation.warnings.filter((w) => w.checklistItemId === item.id)) row.append(element("p", "trip-workspace-notice", warnings[warning.code]));
    if (item.relatedItineraryItemId && trip.items.some((i) => i.id === item.relatedItineraryItemId)) row.append(control("関連する予定", () => options.focus(item.relatedItineraryItemId!)));
    const unnecessary = control(item.status === "not-needed" ? "未完了に戻す" : "不要にする", () => update({ status: item.status === "not-needed" ? "open" : "not-needed" }));
    unnecessary.disabled = !writable || item.archived;
    const archive = control(item.archived ? "アーカイブから戻す" : "アーカイブ", () => update({ archived: !item.archived })); archive.disabled = !writable;
    row.append(unnecessary, archive);
    const edit = element("details"); edit.append(element("summary", "", "名前・カテゴリ・期限・関連先を編集"));
    const form = detailForm(item, writable, trip, readiness);
    form.node.addEventListener("submit", (e) => { e.preventDefault(); update(form.value()); });
    edit.append(form.node); row.append(edit); section.append(row);
  }
  if (!items.length) section.append(element("p", "", "準備項目はまだありません。"));
  const add = detailForm(undefined, writable, trip, readiness);
  add.node.setAttribute("aria-label", "準備項目を追加");
  add.node.addEventListener("submit", (e) => {
    e.preventDefault(); const values = add.value();
    run(() => controller.write({ operation: "add", tripId: trip.id, id: options.newId(), details: {
      category: values.category, title: values.title, ...(values.dueDate ? { dueDate: values.dueDate } : {}),
      ...(values.relatedItineraryItemId ? { relatedItineraryItemId: values.relatedItineraryItemId } : {}),
      ...(values.relatedReservationId ? { relatedReservationId: values.relatedReservationId } : {}),
    } }));
  });
  const addDetails = element("details"); addDetails.append(element("summary", "", "準備項目を追加"), add.node);
  section.append(addDetails, control("準備することを相談", () => options.ask("この旅行に向けて準備することを相談したい。既存の準備リストも参考にして提案してください。")));
  const proposal = controller.proposal();
  if (proposal) {
    const preview = element("section", "trip-workspace-checklist-proposal"); preview.setAttribute("aria-label", "準備項目の追加案");
    preview.append(element("h3", "", "準備項目の追加案（まだ保存されていません）"));
    for (const s of proposal.suggestions) {
      preview.append(element("p", "", `${checklistCategoryLabels[s.category]}: ${s.title}${s.dueDate ? ` / 期限 ${s.dueDate}` : ""}`));
      if (s.relatedItineraryItemId) preview.append(element("p", "", `関連する予定: ${trip.items.find((i) => i.id === s.relatedItineraryItemId)?.title ?? "参照先未確認"}`));
      if (s.relatedReservationId) preview.append(element("p", "", `関連する予約: ${s.relatedReservationId}（予約状態は変更しません）`));
    }
    const confirm = control("確認して準備リストへ追加", () => run(() => controller.confirm())); confirm.disabled = !writable;
    preview.append(confirm, control("追加案を閉じる", controller.dismiss)); section.append(preview);
  }
  return section;
}

function detailForm(item: TripChecklistItem | undefined, writable: boolean, trip: Trip, readiness: TripReadiness) {
  const node = element("form", "trip-workspace-checklist-form");
  const title = element("input"); title.required = true; title.maxLength = 200; title.value = item?.title ?? "";
  const category = element("select"); category.append(...checklistCategories.map((c) => option(checklistCategoryLabels[c], c))); category.value = item?.category ?? "other";
  const due = element("input"); due.type = "date"; due.value = item?.dueDate ?? "";
  const link = element("select"); link.append(option("関連なし（解除）", ""), ...trip.items.map((i) => option(i.title, i.id)));
  if (item?.relatedItineraryItemId && !trip.items.some((i) => i.id === item.relatedItineraryItemId)) link.append(option("参照先なし（保持）", item.relatedItineraryItemId)); link.value = item?.relatedItineraryItemId ?? "";
  const booking = element("select"); booking.append(option("予約の関連なし（解除）", ""), ...readiness.reservations.records.map((r) => option(`${trip.items.find((i) => i.id === r.itineraryItemId)?.title ?? "旅行の予約"} / ${r.status} / ${r.reservationId.slice(-6)}`, r.reservationId)));
  if (item?.relatedReservationId && !readiness.reservations.records.some((r) => r.reservationId === item.relatedReservationId)) booking.append(option("予約の参照先未確認（保持）", item.relatedReservationId)); booking.value = item?.relatedReservationId ?? "";
  for (const [text, input] of [["準備項目", title], ["カテゴリ", category], ["期限（任意）", due], ["関連する予定", link], ["関連する予約", booking]] as const) {
    const label = element("label", "", text); input.disabled = !writable; label.append(input); node.append(label);
  }
  const submit = element("button", "", item ? "準備項目を更新" : "準備項目を追加"); submit.type = "submit"; submit.disabled = !writable; node.append(submit);
  return { node, value: () => ({ title: title.value, category: category.value as TripChecklistItem["category"], dueDate: due.value || null,
    relatedItineraryItemId: link.value || null, relatedReservationId: booking.value || null }) };
}
