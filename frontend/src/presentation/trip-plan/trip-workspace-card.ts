import type { Trip, ItineraryItem } from "@raiquora/trip/trip";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { proposeTripItemChange } from "@raiquora/trip/trip-item-proposal";
import { nonRailTransportModes } from "@raiquora/trip/transport-detail";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";
import { itineraryItemCopy, itineraryScheduleLabel, itemAssumptions } from "./trip-workspace-projection";
import { element, control, option } from "./trip-workspace-elements";
import { reservationStatusLabels } from "../../usecases/trip-plan/reservation-reader";
import type { TripFeasibilityIssue } from "@raiquora/trip/trip-feasibility";
import { feasibilityIssueText } from "./trip-feasibility-view";
import { travelIcon } from "../shared/travel-icon";
import { researchDateLabel } from "../../usecases/trip-plan/research-date";

export function renderWorkspaceCard(trip: Trip, item: ItineraryItem, controller: TripWorkspaceController,
  options: { collapsed: boolean; collapse(value: boolean): void; chat(prompt: string): void; report(message: string): void;
    changeItemDecision?: (trip: Trip, item: ItineraryItem, action: "confirm" | "withdraw") => Promise<void> }, issues: TripFeasibilityIssue[] = []): HTMLElement {
  const card = element("article", "trip-workspace-card"); card.dataset.itemId = item.id;
  const header = element("header");
  const icon = element("span", "trip-workspace-item-icon");
  icon.innerHTML = travelIcon(item.type === "transport" ? "transport" : item.type === "stay" ? "stay" : "activity");
  icon.setAttribute("aria-hidden", "true");
  const focus = control(item.title, () => controller.focus(item.id));
  focus.className = "trip-workspace-item-focus";
  focus.setAttribute("aria-label", `${item.title}を相談対象にする`);
  const body = element("div", "trip-workspace-item-body");
  body.id = `trip-item-${encodeURIComponent(item.id)}`;
  body.hidden = options.collapsed;
  const expand = control(options.collapsed ? "開く" : "閉じる", () => {
    body.hidden = !body.hidden; expand.textContent = body.hidden ? "開く" : "閉じる";
    expand.setAttribute("aria-expanded", String(!body.hidden)); options.collapse(body.hidden);
  });
  expand.setAttribute("aria-expanded", String(!body.hidden)); expand.setAttribute("aria-controls", body.id);
  header.append(icon, focus, expand); card.append(header, element("p", "", itineraryScheduleLabel(item.schedule, true)));
  card.append(element("p", "trip-workspace-item-decision", item.decision?.needsReconfirmation ? "変更後の予定を再確認してください" :
    item.decision ? "確定した予定（予約・購入・情報の検証済みではありません）" : "仮の予定"));
  for (const issue of issues) card.append(element("p", "trip-workspace-feasibility-issue", `⚠ ${feasibilityIssueText(issue)}`));
  for (const r of controller.reservations()?.filter((r) => r.itineraryItemId === item.id) ?? []) {
    card.append(element("p", "trip-workspace-reservation", `予約記録: ${reservationStatusLabels[r.status]}`));
  }
  for (const a of itemAssumptions(trip, item.id)) card.append(element("p", "trip-workspace-assumption", `⚠ ${a.field}の仮置き: ${a.text}`));
  body.append(element("p", "trip-workspace-copy", itineraryItemCopy(item)));
  if (item.type === "activity" && item.research) {
    const source = element("a", "trip-workspace-research-source", `${researchDateLabel(item.research.observedAt)}に参照した資料を開く`);
    source.href = item.research.sourceUrl; source.target = "_blank"; source.rel = "noopener noreferrer";
    body.append(source);
  }
  const safe = (action: () => void) => { try { action(); } catch { options.report("この変更では条件・仮定との整合が取れません。会話で変更内容を相談してください。"); } };
  const actions = element("div", "trip-workspace-actions");
  if (options.changeItemDecision) {
    const action = item.decision && !item.decision.needsReconfirmation ? "withdraw" : "confirm";
    const decision = control(action === "withdraw" ? "この予定を仮に戻す" : "この予定を確定", () => {
      if (!document.defaultView?.confirm(action === "confirm" ? "この予定を確定しますか？予約・購入は行いません。" : "この予定を仮に戻しますか？")) return;
      decision.disabled = true;
      void options.changeItemDecision!(trip, item, action).catch(() => options.report("予定の状態を変更できませんでした。最新の旅程を確認してください。"))
        .finally(() => { decision.disabled = false; });
    });
    decision.disabled = item.type === "stay" && item.selection.status !== "selected" || item.type === "transport" && item.detail.status !== "selected" ||
      item.type === "activity" && !item.place && item.category !== "free-time";
    actions.append(decision);
  }
  const consult = control("相談する", () => { controller.focus(item.id); options.chat("この予定を相談したい"); });
  actions.append(control("名称を変更", () => { editor.hidden = !editor.hidden; if (!editor.hidden) title.focus(); }),
    control("削除案", () => safe(() => controller.preview(proposeTripItemChange(controller.current()!, { action: "remove", itemId: item.id })))));
  if (item.type === "activity") actions.append(control("天気を踏まえて相談", () => {
    controller.focus(item.id);
    options.chat("この予定の日付と地域の天気を確認し、必要なら近くの候補や予定の変更案を相談したい。確定済みの予定は確認するまで変更しないでください");
  }));
  const moveLabel = element("label", "", "並べ替え ");
  const after = element("select", "trip-workspace-move-target"); after.append(option("先頭", ""));
  for (const other of trip.items) if (other.id !== item.id) after.append(option(`${other.title}の後`, other.id));
  const index = trip.items.findIndex((i) => i.id === item.id); after.value = trip.items[index - 1]?.id ?? "";
  moveLabel.append(after);
  actions.append(moveLabel, control("移動案", () => safe(() => controller.preview(proposeTripItemChange(controller.current()!,
    { action: "move", itemId: item.id, ...(after.value ? { afterId: after.value } : {}) })))));
  const dayLabel = element("label", "", "移動先の日 "), day = element("select", "trip-workspace-day-target");
  day.append(option("移動先を選択", ""), option("日時未定", "unscheduled"));
  for (const view of projectDailyItinerary(trip, { limit: 90 }).days) day.append(option(view.localDate ?? view.dayKey, view.dayKey));
  dayLabel.append(day);
  actions.append(dayLabel, control("日付変更案", () => safe(() => controller.preview(proposeTripItemChange(controller.current()!,
    { action: "change-day", itemId: item.id, dayKey: day.value })))));
  if (item.type === "stay") actions.append(control("宿候補を相談", () => { controller.focus(item.id); options.chat("この宿泊予定の候補を比較したい"); }));
  if (item.type === "transport") actions.append(control("交通手段を選ぶ", () => { controller.focus(item.id); options.chat("この移動区間の交通手段を相談したい"); }));
  actions.append(control("＋ この後の予定を相談", () => { controller.focus(item.id); options.chat("この予定の後に追加する予定を相談したい"); }));
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
    const modeLabel = element("label", "", "手入力の交通手段 "), mode = element("select");
    for (const value of nonRailTransportModes) mode.append(option(({ bus: "バス", car: "車", walk: "徒歩", taxi: "タクシー" } as Record<string, string>)[value] ?? value, value));
    modeLabel.append(mode);
    const fromLabel = element("label", "", "出発地 "), from = element("input"); from.required = true; from.maxLength = 200; fromLabel.append(from);
    const toLabel = element("label", "", "到着地 "), to = element("input"); to.required = true; to.maxLength = 200; toLabel.append(to);
    const submit = element("button", "", "手入力の移動案を確認"); submit.type = "submit";
    form.append(modeLabel, fromLabel, toLabel, element("p", "trip-workspace-copy", "便・時刻・所要時間と予約は未確認です。"), submit);
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
  const editing = element("details", "trip-workspace-editing");
  editing.append(element("summary", "", "予定を編集"), actions, editor);
  if (manualActivityForm) editing.append(manualActivityForm);
  body.append(consult, editing); card.append(body); return card;
}

/** Refresh sibling references without replacing the card, editor or keyboard focus. */
export function refreshMoveTargets(card: HTMLElement, trip: Trip, itemId: string): void {
  const select = card.querySelector<HTMLSelectElement>(".trip-workspace-move-target");
  if (select) refreshOptions(select, [["", "先頭"], ...trip.items.filter((i) => i.id !== itemId).map((i) => [i.id, `${i.title}の後`])]);
  const day = card.querySelector<HTMLSelectElement>(".trip-workspace-day-target");
  if (day) refreshOptions(day, [["", "移動先を選択"], ["unscheduled", "日時未定"],
    ...projectDailyItinerary(trip, { limit: 90 }).days.map((view) => [view.dayKey, view.localDate ?? view.dayKey])]);
}
function refreshOptions(select: HTMLSelectElement, choices: string[][]): void {
  const key = JSON.stringify(choices);
  if (select.dataset.targets === key) return;
  const value = select.value;
  select.replaceChildren(...choices.map(([id, label]) => option(label!, id!)));
  select.value = choices.some(([id]) => id === value) ? value : "";
  select.dataset.targets = key;
}
