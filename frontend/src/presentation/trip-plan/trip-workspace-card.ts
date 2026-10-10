import { bookedReservationChanges, reservationChangeKey } from "@raiquora/trip/reservation";
import { confirmAction } from "../shared/app-dialog";

import { renderTripWeather } from "./trip-weather-view";
import { tripWeatherTargets } from "@raiquora/trip/trip-weather";
import { renderStayDetails } from "./trip-stay-details";
import { renderItemCost } from "./trip-cost-view";
import { projectDailyItinerary, type DayEntry } from "@raiquora/trip/daily-itinerary";
import { renderTripTimeEditor } from "./trip-time-editor";
import { transportModeLabel } from "../../usecases/trip-plan/transport-preview";
import { renderTripRouteTimeline } from "./trip-route-timeline";
import type { Trip, ItineraryItem } from "@raiquora/trip/trip";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { proposeTripItemChange } from "@raiquora/trip/trip-item-proposal";
import { nonRailTransportModes } from "@raiquora/trip/transport-detail";
import { itemAssumptions } from "./trip-workspace-projection";
import { renderTripWarnings } from "./trip-warning-view";
import { element, control, option } from "./trip-workspace-elements";
import { reservationStatusLabels } from "../../usecases/trip-plan/reservation-reader";
import type { TripFeasibilityIssue } from "@raiquora/trip/trip-feasibility";
import { feasibilityIssueText } from "./trip-feasibility-view";
import { travelIcon } from "../shared/travel-icon";
import { researchDateLabel } from "../../usecases/trip-plan/research-date";

export function renderWorkspaceCard(trip: Trip, item: ItineraryItem, controller: TripWorkspaceController,
  options: { entry?: DayEntry; collapsed: boolean; collapse(value: boolean): void; chat(prompt: string): void; report(message: string): void;
    refreshWeather?: (trip: Trip, itemId: string) => Promise<void>;
    changeItemDecision?: (trip: Trip, item: ItineraryItem, action: "confirm" | "withdraw") => Promise<void> }, issues: TripFeasibilityIssue[] = []): HTMLElement {
  const card = element("article", "trip-workspace-card"); card.dataset.itemId = item.id; card.dataset.itemType = item.type;
  const header = element("header");
  const icon = element("span", "trip-workspace-item-icon");
  icon.innerHTML = travelIcon(item.type === "transport" ? "transport" : item.type === "stay" ? "stay" : "activity");
  icon.setAttribute("aria-hidden", "true");
  const displayTitle = item.type === "transport" ? item.title.replace(/^経路\s*[0-9０-９]+\s*[:：]\s*/u, "").replace(/\s*[（(]経路\s*[0-9０-９]+[）)]\s*$/u, "") || item.title : item.title;
  const focus = control(displayTitle, () => { controller.focus(item.id); body.hidden = false; updateDisclosure(); options.collapse(false); });
  focus.className = "trip-workspace-item-focus";
  focus.setAttribute("aria-label", `${displayTitle}を相談対象にする`);
  const body = element("div", "trip-workspace-item-body");
  body.id = `trip-item-${encodeURIComponent(options.entry?.entryKey ?? item.id)}`;
  body.hidden = options.collapsed;
  const expand = control("", () => {
    body.hidden = !body.hidden; updateDisclosure(); options.collapse(body.hidden);
  });
  expand.className = "trip-item-toggle";
  const updateDisclosure = () => {
    expand.setAttribute("aria-expanded", String(!body.hidden));
    expand.setAttribute("aria-label", `${displayTitle}の詳細を${body.hidden ? "開く" : "たたむ"}`);
  };
  expand.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>';
  updateDisclosure(); expand.setAttribute("aria-controls", body.id);
  header.append(expand, focus);
  const content = element("div", "trip-timeline-content"), rail = element("span", "trip-timeline-rail"); rail.setAttribute("aria-hidden", "true");
  rail.append(icon);
  content.append(header); card.append(renderTripTimeEditor(trip, item, options.entry, controller, options.report), rail, content);
  const stayRole = item.type === "stay" ? options.entry?.role === "end" ? "チェックアウト" : options.entry?.role === "continue" ? "連泊" : "チェックイン" : undefined;
  const placeName = item.type === "stay" ? item.selection.status === "selected" ? item.selection.accommodation.place.name : item.selection.place?.name : item.type === "activity" ? item.place?.name : undefined;
  if (placeName && placeName !== item.title) body.append(element("p", "trip-item-meta", placeName));
  if (stayRole) body.append(element("p", "trip-item-meta", stayRole));
  const weather = renderTripWeather(trip, item, options.entry?.localDate); if (weather) body.append(weather);
  const decisionStatus = element("span", "trip-workspace-item-decision", item.decision?.needsReconfirmation ? "要再確認" : item.decision ? "確定" : "未確定");
  decisionStatus.title = "予定の状態です。予約・購入の確認ではありません。";
  if (options.entry?.role !== "end" && options.entry?.role !== "continue") {
    const cost = renderItemCost(trip, item, controller, options.report); if (cost) body.append(cost);
  }
  const warning = renderTripWarnings([...issues.map(feasibilityIssueText), ...itemAssumptions(trip, item.id).map(a => a.text)]);
  if (warning) body.append(warning);
  const booking = element("label", "trip-item-booking", "予約 ");
  const bookingInput = element("select"); bookingInput.setAttribute("aria-label", `${item.title}の予約状態`);
  for (const [value, text] of [["", "未確認"], ["booked", "予約済"], ["not-required", "予約不要"]]) {
    const option = element("option", "", text); option.value = value!; bookingInput.append(option);
  }
  bookingInput.value = item.bookingStatus ?? ""; bookingInput.disabled = !controller.canConfirm();
  bookingInput.addEventListener("change", async () => {
    if (controller.current()?.id !== trip.id || controller.current()?.revision !== trip.revision || !controller.canConfirm()) { bookingInput.value = item.bookingStatus ?? ""; return; }
    const status = bookingInput.value as "booked" | "not-required" | "";
    bookingInput.disabled = true;
    try {
      await controller.applyConfirmed({ tripId: trip.id, baseRevision: trip.revision, summary: "予約状態を変更",
        patches: [{ type: "item_booking", itemId: item.id, ...(status ? { status } : {}) }] });
      options.report("予約状態を保存しました。");
    } catch { bookingInput.value = item.bookingStatus ?? ""; options.report("予約状態を保存できませんでした。最新の旅程を確認してください。"); }
    finally { bookingInput.disabled = !controller.canConfirm(); }
  });
  booking.append(bookingInput); body.append(booking);
  const information = element("details", "trip-item-information"); information.append(element("summary", "", "予約情報"));
  for (const r of controller.reservations()?.filter(r => r.itineraryItemId === item.id) ?? []) information.append(element("p", "trip-workspace-reservation", `予約記録: ${reservationStatusLabels[r.status]}`));
  if (item.type === "transport" && item.detail.status === "selected") body.append(renderTripRouteTimeline(item));
  if (information.childElementCount > 1) body.append(information);
  if (item.type === "stay" && item.selection.status === "selected") {
    const detail = renderStayDetails(item.selection.accommodation); if (detail) body.append(detail);
  }
  if (item.type === "activity" && item.research) {
    const source = element("a", "trip-workspace-research-source", `${researchDateLabel(item.research.observedAt)}に参照した資料を開く`);
    source.href = item.research.sourceUrl; source.target = "_blank"; source.rel = "noopener noreferrer";
    body.append(source);
  }
  const safe = (action: () => void) => { try { if (controller.current()?.id !== trip.id || controller.source()?.getRole?.() === "viewer") throw new Error("Stale or readonly Trip"); action(); } catch { options.report("この変更では条件・仮定との整合が取れません。会話で変更内容を相談してください。"); } };
  const actions = element("div", "trip-workspace-actions");
  if (options.changeItemDecision) {
    const action = item.decision && !item.decision.needsReconfirmation ? "withdraw" : "confirm";
    const decision = control(action === "withdraw" ? "下書きに戻す" : "この予定を確定", async () => {
      if (!await confirmAction(document, action === "confirm" ? "この予定を確定しますか？予約・購入は行いません。" : "この予定を下書きに戻しますか？")) return;
      if (controller.current()?.id !== trip.id || controller.current()?.revision !== trip.revision || controller.source()?.getRole?.() === "viewer") return;

      decision.disabled = true;
      void options.changeItemDecision!(trip, item, action).catch(() => options.report("予定の状態を変更できませんでした。最新の旅程を確認してください。"))
        .finally(() => { decision.disabled = false; });
    });
    decision.disabled = item.type === "stay" && item.selection.status !== "selected" || item.type === "transport" && item.detail.status !== "selected" ||
      item.type === "activity" && !item.place && item.category !== "free-time";
    actions.append(decision);
  }
  if (options.refreshWeather && tripWeatherTargets(trip, item).length) {
    const updateWeather = control("天気を更新", () => {
      updateWeather.disabled = true;
      void options.refreshWeather!(trip, item.id).catch(() => options.report("天気を更新できませんでした。旅程を再読み込みしてお試しください。"))
        .finally(() => { updateWeather.disabled = false; });
    });
    updateWeather.classList.add("trip-weather-update");
    if (weather) weather.append(updateWeather); else body.append(updateWeather);
  }
  const askAboutItem = (intent: string) => {
    controller.focus(item.id);
    const date = options.entry?.localDate ?? projectDailyItinerary(trip, { limit: 90 }).days.find(day => day.entries.some(entry => entry.sourceItemId === item.id))?.localDate;
    const position = trip.items.findIndex(value => value.id === item.id) + 1;
    options.chat(`相談対象：旅程「${trip.title}」の${position}番目の予定「${item.title}」${date ? `（${date}）` : ""}。\n${intent}`);
  };
  const consult = control("相談", () => askAboutItem("この予定を相談したい"));
  consult.className = "trip-item-consult";
  const rename = control("✎", () => { body.hidden = false; updateDisclosure(); options.collapse(false); editor.hidden = !editor.hidden; if (!editor.hidden) title.focus(); });
  rename.className = "trip-item-rename"; rename.setAttribute("aria-label", `${displayTitle}の名称を変更`);
  rename.hidden = controller.source()?.getRole?.() === "viewer";
  const remove = control("削除", async () => {
    const current = controller.current();
    if (!current || current.id !== trip.id || current.revision !== trip.revision || !controller.canConfirm()) { options.report("旅程が更新されたか、編集できません。開き直してください。"); return; }
    if (!await confirmAction(document, `「${item.title}」を削除しますがよろしいですか？\n予約自体は取り消されません。`)) return;
    if (controller.current()?.id !== current.id || controller.current()?.revision !== current.revision || controller.source()?.getRole?.() === "viewer") return;
    try {
      const proposal = proposeTripItemChange(current, { action: "remove", itemId: item.id });
      const facts = controller.reservations();
      const confirmation = facts && bookedReservationChanges(proposal, facts).length ? { reservationChangeKey: reservationChangeKey(proposal, facts) } : undefined;
      remove.disabled = true;
      void controller.applyConfirmed(proposal, confirmation).catch(error => options.report(error instanceof Error ? error.message : "削除できませんでした"))
        .finally(() => { remove.disabled = false; });
    } catch { options.report("この予定は削除できません。関連する条件を確認してください。"); }
  });
  actions.append(remove);
  if (item.type === "activity") actions.append(control("天気を踏まえて相談", () => {
    askAboutItem("この予定の日付と地域の天気を確認し、必要なら近くの候補や予定の変更案を相談したい。確定済みの予定は確認するまで変更しないでください");
  }));
  if (item.type === "transport") actions.append(control(item.detail.status === "selected" ? "経路全体を選び直す" : "交通手段を選ぶ", () => {
    askAboutItem(item.detail.status === "selected"
      ? "この移動予定の経路全体を再検索して選び直したい。新しい経路を採用するまで元の経路を残し、変更をやめたら元の経路のままにしてください。ほかの予定は変更しないでください"
      : "この移動区間の交通手段を相談したい");
  }));

  const editor = element("form", "trip-workspace-editor"); editor.hidden = true;
  const label = element("label", "", "予定の名称 "); const title = element("input"); title.value = item.title; title.required = true; title.maxLength = 200;
  label.append(title); const submit = element("button", "", "変更案を確認"); submit.type = "submit";
  editor.append(label, submit);
  editor.addEventListener("submit", (event) => {
    event.preventDefault(); safe(() => controller.preview(proposeTripItemChange(controller.current()!, { action: "rename", itemId: item.id, title: title.value })));
  });
  let manualActivityForm: HTMLElement | undefined;
  if (item.type === "activity") {
    const form = element("form", "trip-workspace-manual-activity"), label = element("label", "", "場所名（手入力） ");
    const place = element("input"); place.required = true; place.maxLength = 200; place.value = item.place?.name ?? ""; label.append(place);
    const submit = element("button", "", "場所の変更案を確認"); submit.type = "submit";
    form.append(label, element("p", "trip-workspace-copy", "手入力した場所名として記録します。検索候補の検証や予約は行いません。"), submit);
    form.addEventListener("submit", event => { event.preventDefault(); safe(() => controller.preview(proposeTripItemChange(controller.current()!,
      { action: "set-manual-activity-place", itemId: item.id, placeName: place.value }))); });
    manualActivityForm = form;
  }
  if (item.type === "transport" && item.detail.status === "unresolved") {
    const form = element("form", "trip-workspace-manual-transport");
    const modeLabel = element("label", "", "交通手段"), mode = element("select");
    for (const value of nonRailTransportModes) mode.append(option(transportModeLabel(value), value));
    modeLabel.append(mode);
    const fromLabel = element("label", "", "出発地"), from = element("input"); from.required = true; from.maxLength = 200; fromLabel.append(from);
    const toLabel = element("label", "", "到着地"), to = element("input"); to.required = true; to.maxLength = 200; toLabel.append(to);
    const submit = element("button", "", "手入力の移動案を確認"); submit.type = "submit";
    const fields = element("div", "trip-manual-transport-fields"); fields.append(modeLabel, fromLabel, toLabel);
    form.append(element("h3", "trip-manual-transport-title", "手入力"), fields, element("p", "trip-workspace-copy", "便・時刻・所要時間と予約は未確認です。"), submit);
    form.addEventListener("submit", event => { event.preventDefault(); safe(() => controller.preview(proposeTripItemChange(controller.current()!,
      { action: "select-manual-transport", itemId: item.id, title: item.title, mode: mode.value as typeof nonRailTransportModes[number], origin: from.value, destination: to.value }))); });
    body.append(form);
  }
  if (item.type === "stay" && item.selection.status === "unselected") {
    const form = element("form", "trip-workspace-manual-stay"), label = element("label", "", "宿泊地の名前（手入力） ");
    const name = element("input"); name.required = true; name.maxLength = 200; label.append(name);
    const submit = element("button", "", "宿泊地の案を確認"); submit.type = "submit";
    form.append(label, element("p", "trip-workspace-copy", "宿泊商品や空室を選択したことにはなりません。"), submit);
    form.addEventListener("submit", event => { event.preventDefault(); safe(() => controller.preview(proposeTripItemChange(controller.current()!,
      { action: "set-manual-stay-place", itemId: item.id, placeName: name.value }))); });
    body.append(form);
  }
  const editing = element("div", "trip-workspace-editing");
  editing.append(actions, editor);
  if (manualActivityForm) editing.append(manualActivityForm);
  const titleGroup = element("div", "trip-item-title-group"); focus.replaceWith(titleGroup);
  titleGroup.append(focus, rename); header.append(decisionStatus);
  if (!item.decision || item.decision.needsReconfirmation) header.append(consult); body.append(editing); content.append(body);
  return card;
}

