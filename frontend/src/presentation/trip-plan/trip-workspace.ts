import { renderTripCosts } from "./trip-cost-view";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import type { ContextViewKind } from "../../domain/context-workspace";
import { proposeDayActivity } from "../../usecases/trip-plan/propose-day-activity";
import { proposeTripItemChange } from "@raiquora/trip/trip-item-proposal";
import { tripWorkspaceProjection, itemAssumptions } from "./trip-workspace-projection";
import { renderWorkspaceCard, refreshMoveTargets } from "./trip-workspace-card";
import { renderWorkspaceCandidates } from "./trip-workspace-candidates";
import { renderWorkspaceProposal } from "./trip-workspace-proposal";
import { element, control, option } from "./trip-workspace-elements";
import { renderTripFeasibility } from "./trip-feasibility-view";
import { renderTripReadiness } from "./trip-readiness-view";
import { renderTripChecklist } from "./trip-checklist-view";
import { travelIcon } from "../shared/travel-icon";
import { renderTripMap, tripDetailTabs, tripOverviewCopy, type TripDetailTab } from "./trip-detail-view";
import { renderTripTravelMode } from "./trip-travel-mode";
import type { InTripContextSnapshot } from "@raiquora/trip/in-trip-context";
import type { Trip } from "@raiquora/trip/trip";
import { canConfirmTrip } from "@raiquora/trip/trip-adoption";

/** DOM and navigation only. The supplied source owns the current server Trip. */
export function configureTripWorkspace(options: {
  app: HTMLElement; chat: HTMLElement; messages: HTMLElement; input: HTMLInputElement;
  controller: TripWorkspaceController;
  showContext(view: ContextViewKind): void; returnToConversation(): void; showMap(itemId?: string): void;
  loadInTripContext?(tripId: string): Promise<InTripContextSnapshot | undefined>;
  ask(prompt: string): void; nextItemId(): string;
  onViewChange?(view: "chat" | "trip"): void;
  changeAdoption?(trip: Trip, action: "confirm" | "withdraw"): Promise<void>;
  changeItemDecision?(trip: Trip, item: Trip["items"][number], action: "confirm" | "withdraw"): Promise<void>;
  branchTrip?(trip: Trip, title: string): Promise<void>;
}) {
  const { controller, app } = options;
  const panel = element("section", "trip-workspace"); panel.id = "trip-workspace"; panel.hidden = true;
  panel.setAttribute("aria-label", "Trip V2の旅程"); panel.tabIndex = -1;
  const nav = element("nav", "trip-workspace-navigation"); nav.setAttribute("aria-label", "会話と旅程の切替"); nav.hidden = true;
  const status = element("p", "trip-workspace-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const report = (text: string) => { status.textContent = text; };
  const heading = element("header", "trip-workspace-heading"); const title = element("h1"); const summary = element("p", "trip-workspace-copy");
  const openTravelMode = control("旅行モードを開く", () => { void showTravelMode(); });
  const emblem = element("span", "trip-workspace-emblem"); emblem.innerHTML = travelIcon("trip"); emblem.setAttribute("aria-hidden", "true");
  const notice = element("p", "trip-workspace-notice");
  const openConsultation = control("この旅について相談", () => show("chat"));
  openConsultation.dataset.tripConsultation = "";
  let adoptionBusy = false, branchBusy = false;
  const adoption = control("この旅程で行く", () => {
    const trip = controller.current(); if (!trip || !options.changeAdoption) return;
    const action = trip.adoption && !trip.adoption.needsReconfirmation ? "withdraw" : "confirm";
    const message = action === "confirm" ? "この旅程を確定しますか？" : "確定を取り消して計画へ戻しますか？";
    if (!document.defaultView?.confirm(message)) return;
    adoptionBusy = true; adoption.disabled = true;
    void options.changeAdoption(trip, action).then(() => report(action === "confirm" ? "旅程を確定しました。" : "計画中へ戻しました。"))
      .catch(() => report("旅程の状態を変更できませんでした。最新の旅程を確認してください。")).finally(() => { adoptionBusy = false; adoption.disabled = false; });
  });
  const branch = control("この旅程を分岐", () => {
    const trip = controller.current(); if (!trip || !options.branchTrip) return;
    const value = document.defaultView?.prompt("分岐した旅程の名前", `${trip.title}（分岐）`)?.trim();
    if (!value) return;
    branchBusy = true; branch.disabled = true;
    void options.branchTrip(trip, value).catch(() => report("旅程を分岐できませんでした。最新の旅程を確認してください。"))
      .finally(() => { branchBusy = false; branch.disabled = false; });
  });
  heading.append(emblem, title, notice, summary, openConsultation, adoption, branch, openTravelMode);
  const retry = control("旅程を再読み込み", () => { void controller.source()?.retry?.(); });
  const assumptions = element("section", "trip-workspace-assumptions");
  const feasibility = element("div");
  const readiness = element("div"), checklist = element("div");
  let checklistKey = "";
  const costs = element("div"); let costKey = "", costTripId: string | undefined, costSessionVersion: number | undefined;
  const dayTabs = element("div", "trip-day-tabs"); dayTabs.setAttribute("role", "tablist"); dayTabs.setAttribute("aria-label", "旅程の日付");
  const days = element("div", "trip-workspace-days"), proposal = element("div"), candidates = element("div");
  const selectedDays = new Map<string, string>();
  const overview = element("section", "trip-detail-panel"), itinerary = element("section", "trip-detail-panel"), costPanel = element("section", "trip-detail-panel"), mapPanel = element("section", "trip-detail-panel");
  const tablist = element("div", "trip-detail-tabs"); tablist.setAttribute("role", "tablist"); tablist.setAttribute("aria-label", "旅程詳細");
  const detailPanels: Record<TripDetailTab, HTMLElement> = { overview, itinerary, costs: costPanel, map: mapPanel };
  const selectedTabs = new Map<string, TripDetailTab>();
  let activeTab: TripDetailTab = "overview", mapKey = "";
  for (const [id, target] of Object.entries(detailPanels) as [TripDetailTab, HTMLElement][]) { target.id = `trip-detail-${id}`; target.setAttribute("role", "tabpanel"); }
  const selectTab = (selected: TripDetailTab, focus = false) => {
    activeTab = selected; selectedTabs.set(controller.sessionId(), selected);
    for (const entry of tripDetailTabs) {
      const button = tablist.querySelector<HTMLButtonElement>(`[data-tab="${entry.id}"]`)!;
      const chosen = entry.id === selected; button.setAttribute("aria-selected", String(chosen)); button.tabIndex = chosen ? 0 : -1;
      detailPanels[entry.id].hidden = !chosen;
    }
    if (focus) tablist.querySelector<HTMLButtonElement>(`[data-tab="${selected}"]`)?.focus();
  };
  tripDetailTabs.forEach((entry, index) => {
    const button = control(entry.label, () => selectTab(entry.id)); button.setAttribute("role", "tab"); button.dataset.tab = entry.id;
    button.setAttribute("aria-controls", detailPanels[entry.id].id); button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? tripDetailTabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tripDetailTabs.length) % tripDetailTabs.length;
      selectTab(tripDetailTabs[next]!.id, true);
    }); tablist.append(button);
  });
  const add = element("form", "trip-workspace-add"); const addLabel = element("label", "", "追加する予定 "); const addTitle = element("input");
  addTitle.required = true; addTitle.maxLength = 200; addLabel.append(addTitle);
  const categoryLabel = element("label", "", "種類 "); const addCategory = element("select");
  for (const [value, label] of [["sightseeing", "観光"], ["food", "食事"], ["experience", "体験"], ["event", "イベント"], ["free-time", "自由時間"]] as const) {
    addCategory.append(option(label, value));
  }
  categoryLabel.append(addCategory);
  const placeLabel = element("label", "", "場所名（任意・手入力） "); const addPlace = element("input"); addPlace.maxLength = 200; placeLabel.append(addPlace);
  const dayLabel = element("label", "", "追加する日 "); const addDay = element("select"); addDay.append(option("日時未定", "unscheduled")); dayLabel.append(addDay);
  const kindLabel = element("label", "", "予定の種類 "), addKind = element("select");
  for (const [value, label] of [["activity", "立ち寄り・食事"], ["transport", "未選択の移動"], ["stay", "未選択の宿泊"]] as const) addKind.append(option(label, value));
  kindLabel.append(addKind);
  const submit = element("button", "", "追加案を確認"); submit.type = "submit";
  add.append(addLabel, categoryLabel, placeLabel, dayLabel, kindLabel, element("p", "trip-workspace-copy", "場所名は立ち寄り・食事の手入力にだけ使います。移動・宿泊は未選択の枠を作り、時刻・営業・予約は確認しません。"), submit);
  addKind.addEventListener("change", () => { categoryLabel.hidden = placeLabel.hidden = addKind.value !== "activity"; });
  add.addEventListener("submit", (event) => {
    event.preventDefault(); const trip = controller.current(); if (!trip) return;
    try {
      const focusedId = controller.uiFocus()?.itemId;
      const target = { itemId: options.nextItemId(), title: addTitle.value, dayKey: addDay.value,
        ...(focusedId && addDay.value !== "unscheduled" && tripWorkspaceProjection(trip).dayEntries
          .find(([key]) => key === addDay.value)?.[1].some(({ sourceItemId }) => sourceItemId === focusedId) ? { afterId: focusedId } : {}) };
      controller.preview(addKind.value === "activity" ? proposeDayActivity(trip, { ...target,
        category: addCategory.value as "sightseeing" | "food" | "experience" | "event" | "free-time",
        ...(addPlace.value.trim() ? { placeName: addPlace.value } : {}) })
        : proposeTripItemChange(trip, { ...target, action: addKind.value === "transport" ? "add-transport" : "add-stay" }));
      report("追加案を表示しました。現在の旅程はまだ変更していません。");
    } catch { report("追加する予定の名称と対象を確認してください。"); }
  });
  const consult = control("＋ 予定を相談して追加", () => chat("旅程に追加する予定を相談したい"));
  overview.append(feasibility, readiness, checklist, assumptions);
  itinerary.append(dayTabs, days, add, consult, candidates);
  costPanel.append(costs);
  const detail = element("div", "trip-detail-view"); detail.append(heading, status, retry, tablist, overview, itinerary, costPanel, mapPanel, proposal);
  const travelMode = element("div"); travelMode.hidden = true;
  panel.append(detail, travelMode);
  selectTab(activeTab);
  app.append(panel, nav);
  const views = new Map<string, { scroll: number; chatScroll: number; view: "chat" | "trip"; focus?: HTMLElement }>();
  const collapsed = new Map<string, boolean>();
  const cards = new Map<string, { node: HTMLElement; key: string }>();
  const groups = new Map<string, HTMLElement>();
  let activeSession = controller.sessionId(), previousTripId: string | undefined, proposalKey = "", candidateKey = "";
  let travelGeneration = 0, detailScroll = 0, travelTripKey = "";
  const viewState = () => {
    if (!views.has(activeSession)) views.set(activeSession, { scroll: 0, chatScroll: 0, view: "chat" });
    return views.get(activeSession)!;
  };
  const show = (view: "chat" | "trip") => {
    const state = viewState();
    if (state.view === "trip") state.scroll = panel.scrollTop;
    if (view === "trip" && state.view !== "trip") {
      state.chatScroll = options.messages.scrollTop;
      state.focus = options.chat.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
    }
    state.view = view; options.returnToConversation(); options.showContext(view === "trip" ? "trip-plan" : "map");
    app.dataset.tripWorkspaceView = view;
    options.onViewChange?.(view);
    for (const button of [chatButton, tripButton]) button.setAttribute("aria-pressed", String(button === (view === "trip" ? tripButton : chatButton)));
    panel.scrollTop = state.scroll;
    if (view === "chat") { options.messages.scrollTop = state.chatScroll; (state.focus?.isConnected ? state.focus : options.input).focus({ preventScroll: true }); }
    else panel.focus({ preventScroll: true });
  };
  const chat = (prompt: string) => { show("chat"); options.ask(prompt); };
  const chatButton = control("会話", () => show("chat")), tripButton = control("旅程", () => show("trip"));
  chatButton.setAttribute("aria-controls", options.chat.id); tripButton.setAttribute("aria-controls", panel.id);
  nav.append(chatButton, tripButton, control("地図", options.showMap));

  async function showTravelMode() {
    const trip = controller.current(); if (!trip) return;
    const generation = ++travelGeneration, session = controller.sessionId(), revision = trip.revision;
    detailScroll = panel.scrollTop; travelTripKey = `${trip.id}:${trip.revision}`; detail.hidden = true; travelMode.hidden = false;
    travelMode.replaceChildren(element("p", "", "旅行中の情報を確認しています。")); panel.scrollTop = 0;
    let snapshot: InTripContextSnapshot | undefined, unavailable = false;
    if (trip.lifecycleState === "in_trip" && options.loadInTripContext) {
      try { snapshot = await options.loadInTripContext(trip.id); } catch { unavailable = true; }
    }
    const latest = controller.current();
    if (generation !== travelGeneration || controller.sessionId() !== session || !latest || latest.id !== trip.id || latest.revision !== revision) return;
    travelMode.replaceChildren(renderTripTravelMode({ trip: latest, now: new Date(), snapshot, unavailable,
      back: () => { travelGeneration++; travelTripKey = ""; travelMode.hidden = true; detail.hidden = false; panel.scrollTop = detailScroll; },
      ask: chat, focus: (itemId) => { controller.focus(itemId); options.showMap(itemId); } }));
  }

  const render = () => {
    if (activeSession !== controller.sessionId()) {
      viewState().scroll = panel.scrollTop; viewState().chatScroll = options.messages.scrollTop;
      activeSession = controller.sessionId(); previousTripId = undefined; report("");
      travelGeneration++; travelTripKey = ""; travelMode.hidden = true; detail.hidden = false;
      costs.replaceChildren(); costKey = ""; costTripId = undefined;
      activeTab = selectedTabs.get(activeSession) ?? "overview"; selectTab(activeTab); mapKey = "";
    }
    const nextCostSession = controller.source()?.sessionVersion?.();
    if (nextCostSession !== costSessionVersion) { costs.replaceChildren(); costKey = ""; costTripId = undefined; costSessionVersion = nextCostSession; }
    const trip = controller.current();
    if (trip && travelTripKey && travelTripKey !== `${trip.id}:${trip.revision}`) { travelGeneration++; travelTripKey = ""; travelMode.hidden = true; detail.hidden = false; }
    panel.hidden = nav.hidden = !controller.blocksLegacy();
    if (!controller.blocksLegacy()) { delete app.dataset.tripWorkspace; delete app.dataset.tripWorkspaceView; return; }
    app.dataset.tripWorkspace = "v2"; app.dataset.tripWorkspaceView = viewState().view;
    chatButton.setAttribute("aria-pressed", String(viewState().view === "chat"));
    tripButton.setAttribute("aria-pressed", String(viewState().view === "trip"));
    const server = true;
    notice.textContent = controller.source()?.getRole?.() === "viewer" ? "共有された旅程です（閲覧専用）。会話履歴・予約の個人情報は共有されません。"
      : controller.source()?.confirmationPersistence === "server" ? "変更案を確認するとサーバに保存します。競合した場合は最新の旅程で確認し直してください。"
      : "サーバの旅程を参照しています。変更案は確認用プレビューで、まだ保存できません。";
    retry.hidden = !controller.source()?.retry;
    retry.disabled = controller.loadState() === "loading";
    add.hidden = consult.hidden = !trip;
    openTravelMode.hidden = openConsultation.hidden = adoption.hidden = branch.hidden = !trip;
    if (!trip) {
      title.textContent = "旅程"; summary.textContent = "";
      report(controller.loadState() === "loading" ? "サーバから旅程を読み込んでいます。" : "旅程を取得できません。認証と接続、参照先の状態を確認して再試行してください。端末の旧旅程へは切り替えていません。");
      const costEditor = costs.querySelector(".trip-cost-editor");
      costs.replaceChildren(...(costEditor ? [costEditor] : [])); costKey = "";
      feasibility.replaceChildren(); assumptions.replaceChildren(); days.replaceChildren(); proposal.replaceChildren(); candidates.replaceChildren();
      dayTabs.replaceChildren();
      mapPanel.replaceChildren(); mapKey = "";
      readiness.replaceChildren(); checklist.replaceChildren(); checklistKey = "";
      cards.clear(); groups.clear(); previousTripId = undefined; proposalKey = candidateKey = "";
      return;
    }
    if (server) report("");
    if (previousTripId !== trip.id) {
      cards.clear(); groups.clear(); days.replaceChildren(); proposalKey = candidateKey = "";
      previousTripId = trip.id; panel.scrollTop = viewState().scroll;
    }
    const view = tripWorkspaceProjection(trip), scroll = panel.scrollTop;
    const chosenDay = addDay.value;
    addDay.replaceChildren(option("日時未定", "unscheduled"), ...view.dayEntries.filter(([key]) => key !== "unscheduled")
      .map(([key, , label]) => option(label, key)));
    addDay.value = [...addDay.options].some((entry) => entry.value === chosenDay) ? chosenDay : "unscheduled";
    const evaluation = controller.feasibility()!;
    feasibility.replaceChildren(renderTripFeasibility(evaluation));
    const prepared = controller.readiness()!;
    readiness.replaceChildren(renderTripReadiness(prepared, trip, controller.focus));
    const nextChecklistKey = JSON.stringify([controller.sessionId(), trip, prepared.reservations, prepared.preparation, controller.checklist.items(), controller.checklist.proposal(), controller.checklist.canWrite()]);
    if (checklistKey !== nextChecklistKey) {
      checklistKey = nextChecklistKey;
      checklist.replaceChildren(renderTripChecklist({ controller: controller.checklist, trip, readiness: prepared, newId: () => crypto.randomUUID(), focus: controller.focus, ask: chat, report }));
    }
    const nextCostKey = JSON.stringify([trip.id, trip.revision, trip.costs, controller.canConfirm()]);
    if (costKey !== nextCostKey) {
      const editor = costTripId === trip.id ? costs.querySelector(".trip-cost-editor") : null;
      costKey = nextCostKey; costTripId = trip.id; costs.replaceChildren(renderTripCosts(trip, controller, chat, report));
      if (editor) { costs.append(editor); report("旅程が更新されました。費用の入力は残しています。取消後、最新の費用から編集し直してください。"); }
    }
    title.textContent = view.title;
    const role = controller.source()?.getRole?.(), personalOwner = role === undefined || role === "owner";
    adoption.hidden = !options.changeAdoption || !personalOwner || ["cancelled", "completed"].includes(trip.lifecycleState);
    adoption.textContent = trip.adoption && !trip.adoption.needsReconfirmation ? "計画へ戻す"
      : trip.adoption?.needsReconfirmation ? "変更後の旅程を再確認" : "この旅程で行く";
    adoption.disabled = adoptionBusy || (!trip.adoption || trip.adoption.needsReconfirmation ? !canConfirmTrip(trip) : false);
    branch.hidden = !options.branchTrip || !personalOwner;
    branch.disabled = branchBusy;
    const partyLabel = view.party.startsWith("今回の人数") ? view.party : `今回の人数: ${view.party}`;
    summary.textContent = `${view.state}\n${partyLabel}\n${view.places}`;
    const oldSummary = overview.querySelector(".trip-detail-overview-copy"); oldSummary?.remove();
    const overviewCopy = element("div", "trip-detail-overview-copy");
    overviewCopy.append(element("h2", "", "旅程の概要"), ...tripOverviewCopy(trip).map((line) => element("p", "trip-workspace-copy", line)));
    overview.prepend(overviewCopy);
    const nextMapKey = JSON.stringify([trip.id, trip.revision, trip.items]);
    if (mapKey !== nextMapKey) { mapKey = nextMapKey; mapPanel.replaceChildren(renderTripMap(trip, options.showMap, controller.focus)); }
    assumptions.replaceChildren(...view.assumptions.map((a) => element("p", "trip-workspace-assumption", `⚠ 仮置き（${a.target}）: ${a.text}`)));
    const ids = new Set<string>(), dates = new Set<string>();
    const dayLabels = new Map<string, string>();
    for (const [date, entries, label] of view.dayEntries) {
      dates.add(date); dayLabels.set(date, label);
      let group = groups.get(date);
      if (!group) { group = element("section", "trip-workspace-day"); group.append(element("h2", "", label)); groups.set(date, group); }
      if (days.children[[...dates].length - 1] !== group) days.insertBefore(group, days.children[[...dates].length - 1] ?? null);
      entries.forEach(({ item, entryKey }, index) => {
        ids.add(entryKey);
        const key = JSON.stringify([item, itemAssumptions(trip, item.id), controller.reservations()?.filter((r) => r.itineraryItemId === item.id),
          evaluation.issues.filter((i) => i.itemIds.includes(item.id)), personalOwner && !!options.changeItemDecision]);
        const collapseKey = `${activeSession}:${trip.id}:${entryKey}`;
        let card = cards.get(entryKey);
        if (card?.key !== key) {
          const node = renderWorkspaceCard(trip, item, controller, { collapsed: collapsed.get(collapseKey) ?? false,
            collapse: (value) => collapsed.set(collapseKey, value), chat, report,
            ...(personalOwner && options.changeItemDecision ? { changeItemDecision: options.changeItemDecision } : {}) }, evaluation.issues.filter((i) => i.itemIds.includes(item.id)));
          if (card) card.node.replaceWith(node);
          card = { node, key }; cards.set(entryKey, card);
        }
        card.node.classList.toggle("is-focused", controller.uiFocus()?.itemId === item.id);
        refreshMoveTargets(card.node, trip, item.id);
        card.node.querySelector(".trip-workspace-item-focus")?.setAttribute("aria-pressed", String(controller.uiFocus()?.itemId === item.id));
        if (group!.children[index + 1] !== card.node) group!.insertBefore(card.node, group!.children[index + 1] ?? null);
      });
    }
    for (const [id, card] of cards) if (!ids.has(id)) { card.node.remove(); cards.delete(id); }
    for (const [date, group] of groups) if (!dates.has(date)) { group.remove(); groups.delete(date); }
    const availableDays = [...dates];
    let selectedDay = selectedDays.get(trip.id);
    if (!selectedDay || !dates.has(selectedDay)) { selectedDay = availableDays[0]; if (selectedDay) selectedDays.set(trip.id, selectedDay); }
    const applySelectedDay = (next: string, focus = false) => {
      selectedDays.set(trip.id, next);
      for (const [date, group] of groups) group.hidden = date !== next;
      for (const button of dayTabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
        const chosen = button.dataset.day === next; button.setAttribute("aria-selected", String(chosen)); button.tabIndex = chosen ? 0 : -1;
      }
      if (focus) dayTabs.querySelector<HTMLButtonElement>(`[data-day="${CSS.escape(next)}"]`)?.focus();
    };
    dayTabs.hidden = availableDays.length < 2; dayTabs.replaceChildren();
    availableDays.forEach((date, index) => {
      const button = control(dayLabels.get(date) ?? date, () => applySelectedDay(date)); button.setAttribute("role", "tab"); button.dataset.day = date;
      button.setAttribute("aria-controls", `trip-day-${index}`); groups.get(date)!.id = `trip-day-${index}`; groups.get(date)!.setAttribute("role", "tabpanel");
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault(); applySelectedDay(availableDays[(index + (event.key === "ArrowRight" ? 1 : -1) + availableDays.length) % availableDays.length]!, true);
      }); dayTabs.append(button);
    });
    if (selectedDay) applySelectedDay(selectedDay);
    const shown = controller.proposal(), nextKey = JSON.stringify([trip, shown, controller.reservations(), evaluation.issues]);
    if (proposalKey !== nextKey) {
      proposalKey = nextKey; proposal.replaceChildren();
      if (shown) {
        try { proposal.append(renderWorkspaceProposal(trip, shown, controller, report)); report("変更案を表示しました。現在の旅程と比較してください。"); }
        catch { report("変更案と現在の旅程が一致しません。提案を確認し直してください。"); }
      }
    }
    const nextCandidates = JSON.stringify([controller.candidates(), trip.items.map((i) => [i.id, i.title]), controller.uiFocus()]);
    if (candidateKey !== nextCandidates) { candidateKey = nextCandidates; candidates.replaceChildren(renderWorkspaceCandidates(controller, report)); }
    panel.scrollTop = scroll;
  };
  const canLeave = () => {
    const editor = costs.querySelector(".trip-cost-editor");
    if (!editor || document.defaultView?.confirm("編集中の費用を破棄して移動しますか？")) { editor?.remove(); return true; }
    return false;
  };
  const beforeUnload = (event: BeforeUnloadEvent) => { if (costs.querySelector(".trip-cost-editor")) { event.preventDefault(); event.returnValue = ""; } };
  document.defaultView?.addEventListener("beforeunload", beforeUnload);
  const unsubscribe = controller.subscribe(render); render();
  return { panel, nav, render, show, report, canLeave, openTravelMode: showTravelMode,
    destroy() { document.defaultView?.removeEventListener("beforeunload", beforeUnload); unsubscribe(); panel.remove(); nav.remove(); delete app.dataset.tripWorkspace; delete app.dataset.tripWorkspaceView; } };
}
