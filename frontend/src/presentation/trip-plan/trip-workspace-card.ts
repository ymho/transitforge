import { saveTripEdit } from "./save-trip-edit";
import { notifySaved } from "../shared/save-notification";
import { bookedReservationChanges, reservationChangeKey } from "@raiquora/trip/reservation";
import { confirmAction, requestText } from "../shared/app-dialog";

import { renderTripWeather } from "./trip-weather-view";
import { renderStayDetails } from "./trip-stay-details";
import { renderItemCost } from "./trip-cost-view";
import { projectDailyItinerary, type DayEntry } from "@raiquora/trip/daily-itinerary";
import { renderTripTimeEditor } from "./trip-time-editor";
import { transportModeLabel } from "../../usecases/trip-plan/transport-preview";
import { renderTripRouteTimeline } from "./trip-route-timeline";
import type { Trip, ItineraryItem, TripUpdateProposal } from "@raiquora/trip/trip";
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
import { researchTimestampLabel } from "../../usecases/trip-plan/research-date";

export function renderWorkspaceCard(trip: Trip, item: ItineraryItem, controller: TripWorkspaceController,
  options: { entry?: DayEntry; collapsed: boolean; collapse(value: boolean): void; chat(prompt: string): void; report(message: string): void;
    saveMetadata?: (build: (current: Trip) => TripUpdateProposal) => Promise<void>;
    memoDrafts?: Map<string, { value: string; base?: string }>;
    memoExpanded?: Map<string, boolean>;
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
  const placeName = item.type === "stay" ? item.selection.status === "selected" ? item.selection.accommodation.place.name : item.selection.place?.name : item.type === "activity" ? item.place?.name : undefined;

  const weather = renderTripWeather(trip, item, options.entry?.localDate);
  const decisionStatus = element("span", "trip-workspace-item-decision", item.decision?.needsReconfirmation ? "要再確認" : item.decision ? "確定" : "下書き");
  decisionStatus.dataset.itemStatus = item.decision?.needsReconfirmation ? "reconfirm" : item.decision ? "confirmed" : "draft";
  decisionStatus.title = "予定の状態です。予約・購入の確認ではありません。";
  const warning = renderTripWarnings([...issues.map(feasibilityIssueText), ...itemAssumptions(trip, item.id).map(a => a.text)]);
  if (warning) body.append(warning);
  const saveMetadata = options.saveMetadata ?? (async (build: (current: Trip) => TripUpdateProposal) => { const current = controller.current(); if (!current) throw new Error("Trip unavailable"); await controller.applyConfirmed(build(current)); });
  const draft = !item.decision || !!item.decision.needsReconfirmation;
  const booking = element("div", "trip-item-booking");
  booking.append(element("span", "trip-item-field-label", "予約状況"), element("span", "trip-item-booking-value", item.bookingStatus === "booked" || item.bookingStatus === "not-required" ? "済" : "未"));
  const bookingInput = element("select", "ds-control"); bookingInput.setAttribute("aria-label", `${item.title}の予約状態`);
  for (const [value, text] of [["", "未"], ["booked", "済"]]) {
    const option = element("option", "", text); option.value = value!; bookingInput.append(option);
  }
  bookingInput.value = item.bookingStatus === "booked" || item.bookingStatus === "not-required" ? "booked" : ""; bookingInput.disabled = !controller.canConfirm() || !draft;
  bookingInput.hidden = true;
  bookingInput.addEventListener("change", async () => {
    if (controller.current()?.id !== trip.id || controller.current()?.revision !== trip.revision || !controller.canConfirm() || !draft) { bookingInput.value = item.bookingStatus ?? ""; return; }
    const status = bookingInput.value as "booked" | "not-required" | "";
    bookingInput.disabled = true;
    try {
      await saveMetadata(current => {
        if (current.items.find(value => value.id === item.id)?.bookingStatus !== item.bookingStatus) throw new Error("予約状態が更新されました");
        return { tripId: current.id, baseRevision: current.revision, summary: "予約状態を変更",
          patches: [{ type: "item_booking", itemId: item.id, ...(status ? { status } : {}) }] };
      });
      options.report("予約状態を保存しました。");
    } catch { bookingInput.value = item.bookingStatus ?? ""; options.report("予約状態を保存できませんでした。最新の旅程を確認してください。"); }
    finally { bookingInput.disabled = !controller.canConfirm() || !draft; }
  });
  const bookingEdit = control("✎", () => { bookingInput.hidden = !bookingInput.hidden; bookingInput.hidden ? bookingEdit.focus() : bookingInput.focus(); });
  bookingEdit.className = "trip-field-pencil"; bookingEdit.setAttribute("aria-label", `${item.title}の予約状態を編集`);
  bookingEdit.hidden = !draft || !controller.canConfirm() || controller.source()?.getRole?.() === "viewer";
  booking.append(bookingEdit, bookingInput); body.append(booking);
  if (options.entry?.role !== "end" && options.entry?.role !== "continue") {
    const cost = renderItemCost(trip, item, controller, options.report); if (cost) body.append(cost);
  }

  const information = element("details", "trip-item-information"); information.append(element("summary", "", "予約情報"));
  for (const r of controller.reservations()?.filter(r => r.itineraryItemId === item.id) ?? []) information.append(element("p", "trip-workspace-reservation", `予約記録: ${reservationStatusLabels[r.status]}`));
  if (item.type === "transport" && item.detail.status === "selected") body.append(renderTripRouteTimeline(item));
  if (information.childElementCount > 1) body.append(information);
  if (item.type === "stay" && item.selection.status === "selected") {
    const detail = renderStayDetails(item.selection.accommodation); if (detail) body.append(detail);
  }
  if (item.type === "activity" && placeName) {
    const facts = element("dl", "trip-stay-facts trip-activity-facts");
    facts.append(element("dt", "", "施設名"), element("dd", "trip-facility-name", placeName)); body.append(facts);
  }
  if (item.type === "activity" && item.research) {
    const source = element("a", "trip-workspace-research-source", "施設の詳細 ↗");
    source.href = item.research.sourceUrl; source.target = "_blank"; source.rel = "noopener noreferrer";
    body.append(source, element("small", "trip-research-date", `検索時: ${researchTimestampLabel(item.research.observedAt)}`));
  }
  const memoSession = controller.sessionId(), memoSource = controller.source();
  const memoForm = element("form", "trip-item-memo");
  const memoLabel = element("label"), memoInput = element("textarea", "ds-control");
  memoInput.value = item.memo ?? ""; memoInput.rows = 3; memoInput.maxLength = 4000;
  memoInput.readOnly = controller.source()?.getRole?.() === "viewer";
  const memoKey = `${trip.id}:${item.id}`;
  const memoDisclosure = element("details", "trip-item-memo-disclosure"), memoSummary = element("summary", "", "メモ");
  memoInput.setAttribute("aria-label", `${item.title}のメモ`);
  memoDisclosure.open = options.memoExpanded?.get(memoKey) ?? false;
  memoSummary.addEventListener("click", () => {
    options.memoExpanded?.set(memoKey, !memoDisclosure.open);
    if (memoDisclosure.open) memoInput.blur();
  });
  memoDisclosure.addEventListener("toggle", () => {
    if (!memoDisclosure.isConnected) return;
    options.memoExpanded?.set(memoKey, memoDisclosure.open);
    if (!memoDisclosure.open) memoInput.blur();
  });
  memoDisclosure.append(memoSummary, memoForm);
  const memoDraft = options.memoDrafts?.get(memoKey);
  let memoBase = item.memo;
  if (memoDraft && (memoDraft.value === (item.memo ?? "") || !memoDraft.value.trim() && item.memo === undefined)) options.memoDrafts?.delete(memoKey);
  else if (memoDraft && !memoInput.readOnly) { memoInput.value = memoDraft.value; memoBase = memoDraft.base; }
  memoInput.addEventListener("input", () => {
    if (!memoInput.readOnly) options.memoDrafts?.set(memoKey, { value: memoInput.value, base: memoBase });
  });
  memoLabel.append(memoInput); memoForm.append(memoLabel);
  if (!memoInput.readOnly) {
    let memoSaving = false;
    memoForm.addEventListener("submit", event => event.preventDefault());
    memoInput.addEventListener("blur", async () => {
      if (memoSaving || memoInput.value === (item.memo ?? "")) return;
      const current = controller.current(), latestItem = current?.items.find(value => value.id === item.id);
      if (!current || !latestItem || controller.sessionId() !== memoSession || controller.source() !== memoSource || current.id !== trip.id ||
          latestItem.memo !== memoBase || controller.source()?.getRole?.() === "viewer") {
        options.report("旅程が更新されたか、編集できません。メモを確認して開き直してください。"); return;
      }
      const value = memoInput.value;
      options.memoDrafts?.set(memoKey, { value, base: memoBase });
      memoSaving = true; memoInput.readOnly = true;
      try { await saveMetadata(latest => {
        if (latest.items.find(value => value.id === item.id)?.memo !== memoBase) throw new Error("メモが更新されました");
        return proposeTripItemChange(latest, { action: "set-memo", itemId: item.id, memo: value });
      }); }
      catch { options.report("メモを保存できませんでした。入力内容を確認してください。"); }
      finally { memoSaving = false; memoInput.readOnly = controller.source()?.getRole?.() === "viewer"; }
    });
  }
  if (!memoInput.readOnly || item.memo) body.append(memoDisclosure);
  const actions = element("div", "trip-workspace-actions");
  if (options.changeItemDecision) {
    const action = item.decision && !item.decision.needsReconfirmation ? "withdraw" : "confirm";
    const decision = control(action === "withdraw" ? "下書きに戻す" : "この予定を確定", async () => {
      if (!await confirmAction(document, action === "confirm" ? "この予定を確定しますか？予約・購入は行いません。" : "この予定を下書きに戻しますか？")) return;
      if (controller.current()?.id !== trip.id || controller.current()?.revision !== trip.revision || controller.source()?.getRole?.() === "viewer") return;

      decision.disabled = true;
      void options.changeItemDecision!(trip, item, action).then(() => notifySaved(document, action === "confirm" ? "予定を確定しました。" : "予定を下書きに戻しました。")).catch(() => options.report("予定の状態を変更できませんでした。最新の旅程を確認してください。"))
        .finally(() => { decision.disabled = false; });
    });
    decision.disabled = item.type === "stay" && item.selection.status !== "selected" || item.type === "transport" && item.detail.status !== "selected" ||
      item.type === "activity" && !item.place && item.category !== "free-time";
    actions.append(decision);
  }
  const askAboutItem = (intent: string) => {
    controller.focus(item.id);
    const date = options.entry?.localDate ?? projectDailyItinerary(trip, { limit: 90 }).days.find(day => day.entries.some(entry => entry.sourceItemId === item.id))?.localDate;
    const position = trip.items.findIndex(value => value.id === item.id) + 1;
    options.chat(`相談対象：旅程「${trip.title}」の${position}番目の予定「${item.title}」${date ? `（${date}）` : ""}。\n${intent}`);
  };
  const consult = control("相談", () => askAboutItem("この予定を相談したい"));
  consult.className = "trip-item-consult";
  const renameSession = controller.sessionId();
  const rename = control("✎", async () => {
    if (!controller.canConfirm() || controller.source()?.getRole?.() === "viewer") return;
    const name = await requestText(document, "予定の名称", item.title);
    if (!name || name === item.title) return;
    if (controller.sessionId() !== renameSession || controller.current()?.id !== trip.id || controller.current()?.revision !== trip.revision || controller.source()?.getRole?.() === "viewer") { options.report("旅程が更新されました。最新の予定から編集し直してください。"); return; }
    rename.disabled = true;
    try { await controller.applyConfirmed(proposeTripItemChange(trip, { action: "rename", itemId: item.id, title: name })); }
    catch (error) { options.report(error instanceof Error ? error.message : "名称を変更できませんでした。"); }
    finally { rename.disabled = false; }
  });
  rename.className = "trip-item-rename"; rename.setAttribute("aria-label", `${displayTitle}の名称を変更`);
  rename.hidden = !draft || controller.source()?.getRole?.() === "viewer";
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
  if (item.type === "transport") actions.append(control(item.detail.status === "selected" ? "経路全体を選び直す" : "交通手段を選ぶ", () => {
    askAboutItem(item.detail.status === "selected"
      ? "この移動予定の経路全体を再検索して選び直したい。新しい経路を採用するまで元の経路を残し、変更をやめたら元の経路のままにしてください。ほかの予定は変更しないでください"
      : "この移動区間の交通手段を相談したい");
  }));

  if (item.type === "transport" && item.detail.status === "unresolved") {
    const form = element("form", "trip-workspace-manual-transport");
    const modeLabel = element("label", "", "交通手段"), mode = element("select");
    for (const value of nonRailTransportModes) mode.append(option(transportModeLabel(value), value));
    modeLabel.append(mode);
    const fromLabel = element("label", "", "出発地"), from = element("input"); from.required = true; from.maxLength = 200; fromLabel.append(from);
    const toLabel = element("label", "", "到着地"), to = element("input"); to.required = true; to.maxLength = 200; toLabel.append(to);
    const submit = element("button", "", "確定"); submit.type = "submit";
    const fields = element("div", "trip-manual-transport-fields"); fields.append(modeLabel, fromLabel, toLabel);
    form.append(fields, element("p", "trip-workspace-copy", "便・時刻・所要時間と予約は未確認です。"), submit);
    form.addEventListener("submit", async event => { event.preventDefault();
      const current = controller.current();
      if (!current || current.id !== trip.id || current.revision !== trip.revision) { options.report("旅程が更新されました。最新の予定から編集し直してください。"); return; }
      try { await saveTripEdit(form, submit, controller, proposeTripItemChange(current,
        { action: "select-manual-transport", itemId: item.id, title: item.title, mode: mode.value as typeof nonRailTransportModes[number], origin: from.value, destination: to.value }), options.report); }
      catch (error) { options.report(error instanceof Error ? error.message : "移動を保存できませんでした。"); }
    });
    const manual = element("details", "trip-manual-transport-disclosure");
    manual.append(element("summary", "", "手入力"), form); body.append(manual);
  }
  const editing = element("div", "trip-workspace-editing");
  if (weather) body.append(weather);
  editing.append(actions);
  const titleGroup = element("div", "trip-item-title-group"); focus.replaceWith(titleGroup);
  titleGroup.append(focus, rename); header.append(decisionStatus);
  if (!item.decision || item.decision.needsReconfirmation) header.append(consult); body.append(editing); content.append(body);
  return card;
}

